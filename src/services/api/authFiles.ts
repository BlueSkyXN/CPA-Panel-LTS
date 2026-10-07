import { normalizeAuthFileCooldowns, normalizeCooldownTimestamp } from './authFileCooldowns';
/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient, ltsExtensionClient } from './client';
import {
  getConfigValue,
  guardConfigConnection,
  putConfigValue,
  readConfigSnapshot,
} from './configValue';
import { isRecord } from '@/utils/helpers';
import type { AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelAliasEntry } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import {
  normalizeRecentRequestAuthIndex,
  normalizeRecentRequestBuckets,
  normalizeUsageTotal,
} from '@/utils/recentRequests';
import { parseTimestampMs } from '@/utils/timestamp';
import { readCredentialWeight } from '@/utils/credentialWeight';

type AuthFileStatusResponse = { status: string; disabled: boolean };
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileFieldsPatch = {
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  weight?: number | null;
  websockets?: boolean;
  using_api?: boolean;
  note?: string;
};
type AuthFileBatchFailure = { name: string; error: string };
type AuthFileBatchUploadResponse = {
  status?: string;
  uploaded?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchDeleteResponse = {
  status?: string;
  deleted?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};
type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

export const AUTH_FILE_INVALID_JSON_OBJECT_ERROR = 'AUTH_FILE_INVALID_JSON_OBJECT';

const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeBatchFileNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return normalizeRequestedAuthFileNames(value.map((item) => String(item ?? '')));
};

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileBatchFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';

    if (!name && !error) return result;
    result.push({ name, error: error || 'Unknown error' });
    return result;
  }, []);
};

const normalizeBatchUploadResponse = (
  payload: AuthFileBatchUploadResponse | undefined,
  requestedNames: string[]
): AuthFileBatchUploadResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-file success path returns only {status:"ok"} (auth_files.go:680).
  // Derive count + names from the request when no failures and counts are absent.
  const inferFromRequest = payload?.uploaded === undefined && failed.length === 0;
  return {
    status: payload?.status ?? (failed.length > 0 ? 'partial' : 'ok'),
    uploaded: payload?.uploaded ?? (inferFromRequest ? requestedNames.length : 0),
    files: filesFromPayload.length ? filesFromPayload : inferFromRequest ? [...requestedNames] : [],
    failed,
  };
};

const normalizeBatchDeleteResponse = (
  payload: AuthFileBatchDeleteResponse | undefined,
  requestedNames: string[]
): AuthFileBatchDeleteResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const filesFromPayload = normalizeBatchFileNames(payload?.files);
  // Backend single-name delete returns only {status:"ok"} (auth_files.go:794).
  const inferFromRequest = payload?.deleted === undefined && failed.length === 0;
  return {
    status: payload?.status ?? (failed.length > 0 ? 'partial' : 'ok'),
    deleted: payload?.deleted ?? (inferFromRequest ? requestedNames.length : 0),
    files: filesFromPayload.length ? filesFromPayload : inferFromRequest ? [...requestedNames] : [],
    failed,
  };
};

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => {
  const raw = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
};

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      if (key === 'cooldowns' && Object.prototype.hasOwnProperty.call(merged, key)) return;
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

const readIntegerField = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

/** Preserve raw provider fields while exposing stable camelCase fields to the UI. */
const normalizeAuthFileEntry = (
  entry: AuthFileEntry,
  observedAt: string | undefined,
  receivedAtMs: number
): AuthFileEntry => {
  const declaredStatusMessage =
    typeof entry.statusMessage === 'string' ? entry.statusMessage.trim() : '';
  const statusMessage = readTextField(entry, 'status_message') || declaredStatusMessage;
  const note = readTextField(entry, 'note');
  const modified = readDateField(entry);
  const priority = readIntegerField(entry['priority']);
  const weight = readCredentialWeight(entry['weight']);

  return {
    ...entry,
    cooldownSnapshot: normalizeAuthFileCooldowns(entry.cooldowns, observedAt, receivedAtMs),
    runtimeOnly: isRuntimeOnlyEntry(entry),
    authIndex: normalizeRecentRequestAuthIndex(entry['auth_index'] ?? entry.authIndex),
    recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
    successCount: normalizeUsageTotal(entry.success),
    failureCount: normalizeUsageTotal(entry.failed),
    ...(statusMessage ? { statusMessage } : {}),
    ...(modified > 0 ? { modified } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(note ? { note } : {}),
  };
};

export const normalizeAuthFilesResponse = (
  payload: AuthFilesResponse,
  receivedAtMs = Date.now()
): AuthFilesResponse => {
  const observedAt = normalizeCooldownTimestamp(payload?.observed_at);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const key = name || JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map((entries) =>
    normalizeAuthFileEntry(mergeAuthFileEntries(entries), observedAt, receivedAtMs)
  );
  normalizedFiles.sort((left, right) =>
    readTextField(left, 'name').localeCompare(readTextField(right, 'name'), undefined, {
      sensitivity: 'accent',
    })
  );

  return {
    ...payload,
    observedAt,
    files: normalizedFiles,
    total: normalizedFiles.length,
  };
};

const parseAuthFileJsonObject = (rawText: string): Record<string, unknown> => {
  const trimmed = rawText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  return { ...(parsed as Record<string, unknown>) };
};

const saveAuthFileText = async (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  await authFilesApi.upload(file);
};

export const isAuthFileInvalidJsonObjectError = (err: unknown): boolean =>
  err instanceof Error && err.message === AUTH_FILE_INVALID_JSON_OBJECT_ERROR;

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = normalizeOAuthProviderKey(String(provider ?? ''));
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const normalized = result[key] ?? [];
    const seen = new Set(normalized.map((item) => item.toLowerCase()));
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

export const normalizeOauthModelAlias = (
  payload: unknown
): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-model-alias'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!key) return;
    if (!Array.isArray(mappings)) return;

    const normalized = result[key] ?? [];
    const seenAlias = new Set(normalized.map((entry) => entry.alias.toLowerCase()));
    mappings
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const fork = entry.fork === true;
        const forceMappingValue = entry['force-mapping'] ?? entry.forceMapping;
        const normalizedEntry: OAuthModelAliasEntry = { name, alias };
        if (fork) normalizedEntry.fork = true;
        if (typeof forceMappingValue === 'boolean') {
          normalizedEntry.forceMapping = forceMappingValue;
        }
        return normalizedEntry;
      })
      .filter(Boolean)
      .forEach((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const aliasKey = aliasEntry.alias.toLowerCase();
        if (seenAlias.has(aliasKey)) return;
        seenAlias.add(aliasKey);
        normalized.push(aliasEntry);
      });

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

export const serializeOauthModelAliases = (
  aliases: OAuthModelAliasEntry[]
): Array<Record<string, unknown>> =>
  aliases.map((entry) => {
    const payload: Record<string, unknown> = {
      name: entry.name,
      alias: entry.alias,
    };
    if (entry.fork) payload.fork = true;
    if (typeof entry.forceMapping === 'boolean') {
      payload['force-mapping'] = entry.forceMapping;
    }
    return payload;
  });

const OAUTH_MODEL_ALIAS_ENDPOINT = '/config/oauth/model-alias';
const OAUTH_EXCLUDED_MODELS_ENDPOINT = '/config/oauth/excluded-models';

const oauthMapWrites = new Map<string, Promise<void>>();

// v8 replaces a whole provider map. Serialize local read/modify/write operations
// so a batch cannot overwrite another provider's changes with an older snapshot.
function queueOauthMapWrite(path: string, write: () => Promise<void>): Promise<void> {
  const assertConnection = guardConfigConnection();
  const queueKey = `${apiClient.getConnectionRevision()}:${path}`;
  const previous = oauthMapWrites.get(queueKey) ?? Promise.resolve();
  const pending = previous.then(async () => {
    assertConnection();
    await write();
  });
  const settled = pending.then(
    () => undefined,
    () => undefined
  );
  oauthMapWrites.set(queueKey, settled);
  void settled.then(() => {
    if (oauthMapWrites.get(queueKey) === settled) oauthMapWrites.delete(queueKey);
  });
  return pending;
}

/** Each map write is derived from one read and sent with that read's revision (If-Match). */
async function updateOauthProviderMap(path: string, provider: string, value?: unknown) {
  const key = normalizeOAuthProviderKey(provider);
  if (!key) throw new Error('Invalid OAuth provider');
  return queueOauthMapWrite(path, async () => {
    const assertConnection = guardConfigConnection();
    const { value: current, revision } = await readConfigSnapshot<unknown>(path, {});
    assertConnection();
    if (current != null && !isRecord(current)) throw new Error('Invalid OAuth configuration map');
    // v8 reads preserve YAML key spelling. The UI groups normalized providers, so
    // remove every spelling of this provider, preserving unrelated entries verbatim.
    const next = Object.fromEntries(
      Object.entries(current ?? {}).filter(([name]) => normalizeOAuthProviderKey(name) !== key)
    );
    if (value !== undefined) {
      Object.defineProperty(next, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    await putConfigValue(path, next, revision);
  });
}

export const authFilesApi = {
  list: async () =>
    normalizeAuthFilesResponse(await apiClient.get<AuthFilesResponse>('/credentials')),

  setStatus: (name: string, disabled: boolean, authIndex?: string) =>
    apiClient.patch<AuthFileStatusResponse>('/credentials/status', {
      name,
      disabled,
      ...(authIndex ? { auth_index: authIndex } : {}),
    }),

  patchFields: (name: string, fields: AuthFileFieldsPatch) =>
    apiClient.patch('/credentials/fields', { name, ...fields }),

  uploadFiles: async (files: File[]): Promise<AuthFileBatchUploadResult> => {
    const requestedNames = files.map((file) => file.name);
    if (requestedNames.length === 0) {
      return { status: 'ok', uploaded: 0, files: [], failed: [] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('file', file, file.name);
    });
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/credentials', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  upload: (file: File) => authFilesApi.uploadFiles([file]),

  deleteFiles: async (names: string[]): Promise<AuthFileBatchDeleteResult> => {
    const requestedNames = normalizeRequestedAuthFileNames(names);
    if (requestedNames.length === 0) {
      return { status: 'ok', deleted: 0, files: [], failed: [] };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/credentials', {
      data: { names: requestedNames },
    });
    return normalizeBatchDeleteResponse(payload, requestedNames);
  },

  deleteFile: (name: string) => authFilesApi.deleteFiles([name]),

  deleteAll: () => apiClient.delete('/credentials', { params: { all: true } }),

  download: async (name: string): Promise<Blob> => {
    const response = await apiClient.getRaw(
      `/credentials/download?name=${encodeURIComponent(name)}`,
      {
        responseType: 'blob',
      }
    );
    return response.data as Blob;
  },

  downloadText: async (name: string): Promise<string> => {
    const blob = await authFilesApi.download(name);
    return blob.text();
  },

  async downloadJsonObject(name: string): Promise<Record<string, unknown>> {
    const rawText = await authFilesApi.downloadText(name);
    return parseAuthFileJsonObject(rawText);
  },

  saveText: (name: string, text: string) => saveAuthFileText(name, text),

  saveJsonObject: (name: string, json: Record<string, unknown>) =>
    saveAuthFileText(name, JSON.stringify(json)),

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await getConfigValue(OAUTH_EXCLUDED_MODELS_ENDPOINT, {});
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    updateOauthProviderMap(OAUTH_EXCLUDED_MODELS_ENDPOINT, provider, models),

  deleteOauthExcludedEntry: (provider: string) =>
    updateOauthProviderMap(OAUTH_EXCLUDED_MODELS_ENDPOINT, provider),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    queueOauthMapWrite(OAUTH_EXCLUDED_MODELS_ENDPOINT, async () => {
      // Whole-map replacement is an explicit user intent; bind it to the current revision.
      await putConfigValue(OAUTH_EXCLUDED_MODELS_ENDPOINT, normalizeOauthExcludedModels(map));
    }),

  // OAuth 模型别名
  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await getConfigValue(OAUTH_MODEL_ALIAS_ENDPOINT, {});
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    const normalizedAliases =
      normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await updateOauthProviderMap(
      OAUTH_MODEL_ALIAS_ENDPOINT,
      normalizedChannel,
      serializeOauthModelAliases(normalizedAliases)
    );
  },

  deleteOauthModelAlias: async (channel: string) => {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    await updateOauthProviderMap(OAUTH_MODEL_ALIAS_ENDPOINT, normalizedChannel);
  },

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(
    name: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/credentials/models?name=${encodeURIComponent(name)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 重新发现单个凭证的模型，并让 Core 同步更新 registry 与 scheduler。
  async refreshModelsForAuthFile(
    name: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    // LTS extension: Core has no v8 equivalent for per-credential model rediscovery.
    const data = await ltsExtensionClient.post<{ models?: unknown }>(
      `/auth-files/models/refresh?name=${encodeURIComponent(name)}`,
      undefined,
      { timeout: 45_000 }
    );
    return Array.isArray(data.models)
      ? (data.models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 获取指定 channel 的模型定义
  async getModelDefinitions(
    channel: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = normalizeOAuthProviderKey(String(channel ?? ''));
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/routing/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },
};
