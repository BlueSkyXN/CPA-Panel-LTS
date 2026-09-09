import { obfuscatedStorage } from './secureStorage';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { normalizeApiBase } from '@/utils/connection';
import { generateId, isRecord } from '@/utils/helpers';

export const PROFILES_KEY = 'cpa-connection-profiles-v1';
export const TAB_SESSION_KEY = 'cpa-tab-session-v1';
const HANDOFF_KEY = 'cpa-connection-handoff-v1';

export interface ConnectionProfile {
  id: string;
  name: string;
  apiBase: string;
  environment: string;
  rememberPassword: boolean;
  managementKey?: string;
  lastUsedAt?: number;
}

export function validateConnectionBase(value: string): string {
  const normalized = normalizeApiBase(value);
  const url = new URL(normalized);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid connection URL');
  }
  return normalized;
}

export function readProfiles(): ConnectionProfile[] {
  const raw = obfuscatedStorage.getItem(PROFILES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): ConnectionProfile[] => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.apiBase !== 'string'
    )
      return [];
    try {
      return [
        {
          id: value.id,
          name: value.name,
          apiBase: validateConnectionBase(value.apiBase),
          environment: typeof value.environment === 'string' ? value.environment : '',
          rememberPassword: value.rememberPassword === true,
          ...(value.rememberPassword === true && typeof value.managementKey === 'string'
            ? { managementKey: value.managementKey }
            : {}),
          ...(typeof value.lastUsedAt === 'number' ? { lastUsedAt: value.lastUsedAt } : {}),
        },
      ];
    } catch {
      return [];
    }
  });
}

export function saveProfile(profile: ConnectionProfile): void {
  const profiles = readProfiles();
  const next = { ...profile, apiBase: validateConnectionBase(profile.apiBase) };
  if (!next.rememberPassword) delete next.managementKey;
  obfuscatedStorage.setItem(PROFILES_KEY, [
    ...profiles.filter((item) => item.id !== next.id),
    next,
  ]);
}

export function deleteProfile(id: string): void {
  obfuscatedStorage.setItem(
    PROFILES_KEY,
    readProfiles().filter((item) => item.id !== id)
  );
}

/** 先成功写入档案，再清理旧认证存储；不把一个标签页的选择广播给其他标签页。 */
export function migrateLegacyConnection(): void {
  if (localStorage.getItem(PROFILES_KEY) !== null) return;
  const raw = obfuscatedStorage.getItem(STORAGE_KEY_AUTH);
  const state = isRecord(raw) && isRecord(raw.state) ? raw.state : {};
  const legacyBase = obfuscatedStorage.getItem('apiBase') || obfuscatedStorage.getItem('apiUrl');
  const legacyKey = obfuscatedStorage.getItem('managementKey');
  const base = typeof state.apiBase === 'string' ? state.apiBase : legacyBase;
  if (typeof base !== 'string' || !base) return;
  try {
    validateConnectionBase(base);
  } catch {
    return;
  }
  const key =
    typeof state.managementKey === 'string'
      ? state.managementKey
      : typeof legacyKey === 'string'
        ? legacyKey
        : '';
  const remember =
    state.rememberPassword === true || (!('rememberPassword' in state) && Boolean(key));
  const profile: ConnectionProfile = {
    id: generateId(),
    name: base,
    apiBase: validateConnectionBase(base),
    environment: '',
    rememberPassword: remember,
    ...(remember ? { managementKey: key } : {}),
  };
  saveProfile(profile);
  if (!sessionStorage.getItem(TAB_SESSION_KEY)) {
    sessionStorage.setItem(
      TAB_SESSION_KEY,
      JSON.stringify({
        state: { profileId: profile.id, apiBase: profile.apiBase, rememberPassword: remember },
        version: 1,
      })
    );
    if (localStorage.getItem('isLoggedIn') === 'true') sessionStorage.setItem('isLoggedIn', 'true');
  }
  [STORAGE_KEY_AUTH, 'apiBase', 'apiUrl', 'managementKey', 'isLoggedIn'].forEach((key) =>
    localStorage.removeItem(key)
  );
}

// 未记住的密钥只用于跨文档交接。目标启动即消费删除，并设置短有效期。
export function prepareHandoff(
  profile: ConnectionProfile,
  managementKey: string,
  path: string,
  previousId?: string
): void {
  const keys = [
    HANDOFF_KEY,
    TAB_SESSION_KEY,
    'isLoggedIn',
    'cpa-session-path',
    'cpa-previous-profile',
  ];
  const before = keys.map((key) => sessionStorage.getItem(key));
  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        profileId: profile.id,
        apiBase: profile.apiBase,
        managementKey,
        expiresAt: Date.now() + 30_000,
      })
    );
    sessionStorage.setItem(
      TAB_SESSION_KEY,
      JSON.stringify({
        state: {
          profileId: profile.id,
          apiBase: profile.apiBase,
          rememberPassword: profile.rememberPassword,
        },
        version: 1,
      })
    );
    sessionStorage.setItem('isLoggedIn', 'true');
    sessionStorage.setItem('cpa-session-path', path);
    if (previousId) sessionStorage.setItem('cpa-previous-profile', previousId);
  } catch (error) {
    keys.forEach((key, index) => {
      if (before[index] === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, before[index]);
    });
    throw error;
  }
}

export const tabAuthStorage = {
  getItem: () => {
    if (typeof sessionStorage === 'undefined') return null;
    migrateLegacyConnection();
    const raw = sessionStorage.getItem(TAB_SESSION_KEY);
    const transfer = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    try {
      const data: unknown = JSON.parse(raw);
      if (!isRecord(data) || !isRecord(data.state)) return null;
      const profileId = data.state.profileId;
      const profile = readProfiles().find((item) => item.id === profileId);
      const state: Record<string, unknown> = {
        ...data.state,
        managementKey:
          profile && profile.apiBase === data.state.apiBase ? profile.managementKey || '' : '',
      };
      if (transfer) {
        const handoff: unknown = JSON.parse(transfer);
        if (
          isRecord(handoff) &&
          handoff.profileId === state.profileId &&
          handoff.apiBase === state.apiBase &&
          typeof handoff.expiresAt === 'number' &&
          handoff.expiresAt > Date.now() &&
          typeof handoff.managementKey === 'string'
        )
          state.managementKey = handoff.managementKey;
      }
      return JSON.stringify({ ...data, state });
    } catch {
      return null;
    }
  },
  setItem: (_name: string, value: string) => {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(TAB_SESSION_KEY, value);
  },
  removeItem: () => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(TAB_SESSION_KEY);
      sessionStorage.removeItem(HANDOFF_KEY);
    }
  },
};
