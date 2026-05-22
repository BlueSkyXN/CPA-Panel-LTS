import type { AuthFileItem } from '@/types';
import {
  createStatusError,
  normalizeStringValue,
  parseIdTokenPayload,
  resolveCodexChatgptAccountId,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';
import { apiCallApi, getApiCallErrorMessage, type ApiCallResult } from './apiCall';

const CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_URL =
  'https://chatgpt.com/backend-api/codex/remote/control/environments';
const CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_LIMIT = 100;
const CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_MAX_PAGES = 10;
const CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_ACCOUNT_CLAIM = 'https://api.openai.com/auth';
const CODEX_DESKTOP_USER_AGENT = 'Codex Desktop/26.513.20950 (Macintosh; arm64)';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const normalized = normalizeStringValue(value);
    if (normalized) return normalized;
  }
  return null;
};

const normalizeBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
};

const resolveNestedRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const extractCodexRemoteCloudConnectEnvironmentAccountId = (token: unknown): string | null => {
  const payload = parseIdTokenPayload(token);
  if (!payload) return null;

  const authClaim = resolveNestedRecord(
    payload[CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_ACCOUNT_CLAIM]
  );
  return firstString(
    authClaim?.chatgpt_account_id,
    authClaim?.chatgptAccountId,
    payload.chatgpt_account_id,
    payload.chatgptAccountId
  );
};

const resolveCodexRemoteCloudConnectEnvironmentAccountId = (file: AuthFileItem): string | null => {
  const metadata = resolveNestedRecord(file.metadata);
  const attributes = resolveNestedRecord(file.attributes);
  const tokens = resolveNestedRecord(file.tokens);
  const metadataTokens = resolveNestedRecord(metadata?.tokens);
  const attributeTokens = resolveNestedRecord(attributes?.tokens);

  const candidates = [
    tokens?.access_token,
    tokens?.accessToken,
    file.access_token,
    file.accessToken,
    metadataTokens?.access_token,
    metadataTokens?.accessToken,
    metadata?.access_token,
    metadata?.accessToken,
    attributeTokens?.access_token,
    attributeTokens?.accessToken,
    attributes?.access_token,
    attributes?.accessToken,
  ];

  for (const candidate of candidates) {
    const accountId = extractCodexRemoteCloudConnectEnvironmentAccountId(candidate);
    if (accountId) return accountId;
  }

  return resolveCodexChatgptAccountId(file);
};

const resolvePageItems = (payload: unknown): Record<string, unknown>[] => {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw createStatusError('Invalid Codex remote cloud connect environments response', 502);
  }
  return payload.items.filter(isRecord);
};

const resolveNextCursor = (payload: unknown): string | null => {
  if (!isRecord(payload)) return null;
  return normalizeStringValue(payload.cursor);
};

const buildCodexRemoteCloudConnectEnvironmentHeaders = (
  accountId: string | null
): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: 'Bearer $TOKEN$',
    originator: 'Codex Desktop',
    'User-Agent': CODEX_DESKTOP_USER_AGENT,
    'OAI-Language': 'en',
  };

  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  return headers;
};

const buildCodexRemoteCloudConnectEnvironmentUrl = (cursor: string | null): string => {
  const query = new URLSearchParams({
    limit: String(CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_LIMIT),
  });

  if (cursor) {
    query.set('cursor', cursor);
  }

  return `${CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_URL}?${query.toString()}`;
};

const buildCodexRemoteCloudConnectEnvironmentDeleteUrl = (envId: string): string =>
  `${CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_URL}/${encodeURIComponent(envId)}`;

const getCodexRemoteCloudConnectEnvironmentErrorMessage = (result: ApiCallResult): string => {
  if (isRecord(result.body) && typeof result.body.detail === 'string') {
    return result.statusCode
      ? `${result.statusCode} ${result.body.detail}`.trim()
      : result.body.detail;
  }
  return getApiCallErrorMessage(result);
};

export interface CodexRemoteCloudConnectEnvironment {
  id: string;
  envId: string;
  kind: string | null;
  name: string;
  displayName: string | null;
  hostName: string | null;
  online: boolean | null;
  busy: boolean | null;
  os: string | null;
  osVersion: string | null;
  arch: string | null;
  appServerVersion: string | null;
  installationId: string | null;
  clientType: string | null;
  originator: string | null;
  terminal: string | null;
  clientName: string | null;
  clientVersion: string | null;
  lastSeenAt: string | null;
  isLikelyStale: boolean;
  raw: Record<string, unknown>;
}

export interface CodexRemoteCloudConnectEnvironmentsResult {
  environments: CodexRemoteCloudConnectEnvironment[];
  rawPages: unknown[];
  nextCursor: string | null;
  fetchedPages: number;
  truncated: boolean;
}

export const normalizeCodexRemoteCloudConnectEnvironment = (
  raw: Record<string, unknown>,
  index: number
): CodexRemoteCloudConnectEnvironment => {
  const envId = firstString(raw.env_id, raw.envId);
  if (!envId) {
    throw createStatusError(
      `Invalid Codex remote cloud connect environment item at index ${index + 1}`,
      502
    );
  }
  const displayName = firstString(raw.display_name, raw.displayName);
  const hostName = firstString(raw.host_name, raw.hostName);
  const name = firstString(displayName, raw.name, hostName, envId) ?? envId;
  const online = normalizeBooleanValue(raw.online);
  const lastSeenAt = firstString(raw.last_seen_at, raw.lastSeenAt);
  const appServerVersion = firstString(raw.app_server_version, raw.appServerVersion);
  const installationId = firstString(raw.installation_id, raw.installationId);
  const originator = firstString(raw.originator);
  const clientName = firstString(raw.client_name, raw.clientName);
  const clientVersion = firstString(raw.client_version, raw.clientVersion);
  const osVersion = firstString(raw.os_version, raw.osVersion);
  const missingIdentityFields =
    !installationId && !originator && !clientName && !clientVersion && !osVersion;
  const isLikelyStale = online === false && !lastSeenAt && missingIdentityFields;

  return {
    id: envId,
    envId,
    kind: firstString(raw.kind),
    name,
    displayName,
    hostName,
    online,
    busy: normalizeBooleanValue(raw.busy),
    os: firstString(raw.os),
    osVersion,
    arch: firstString(raw.arch),
    appServerVersion,
    installationId,
    clientType: firstString(raw.client_type, raw.clientType),
    originator,
    terminal: firstString(raw.terminal),
    clientName,
    clientVersion,
    lastSeenAt,
    isLikelyStale,
    raw,
  };
};

export const codexRemoteCloudConnectEnvironmentsApi = {
  list: async (file: AuthFileItem): Promise<CodexRemoteCloudConnectEnvironmentsResult> => {
    const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!authIndex) {
      throw createStatusError('Auth file missing auth_index', 400);
    }

    const accountId = resolveCodexRemoteCloudConnectEnvironmentAccountId(file);
    const header = buildCodexRemoteCloudConnectEnvironmentHeaders(accountId);
    const environments: CodexRemoteCloudConnectEnvironment[] = [];
    const rawPages: unknown[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let nextCursor: string | null = null;
    let truncated = false;

    for (let page = 0; page < CODEX_REMOTE_CLOUD_CONNECT_ENVIRONMENTS_MAX_PAGES; page += 1) {
      const result = await apiCallApi.request({
        authIndex,
        method: 'GET',
        url: buildCodexRemoteCloudConnectEnvironmentUrl(cursor),
        header,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw createStatusError(
          getCodexRemoteCloudConnectEnvironmentErrorMessage(result),
          result.statusCode
        );
      }

      const raw = result.body ?? result.bodyText;
      rawPages.push(raw);
      const baseIndex = environments.length;
      environments.push(
        ...resolvePageItems(raw).map((record, index) =>
          normalizeCodexRemoteCloudConnectEnvironment(record, baseIndex + index)
        )
      );

      nextCursor = resolveNextCursor(raw);
      if (!nextCursor) {
        return {
          environments,
          rawPages,
          nextCursor: null,
          fetchedPages: rawPages.length,
          truncated: false,
        };
      }

      if (seenCursors.has(nextCursor)) {
        truncated = true;
        break;
      }

      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    if (nextCursor) {
      truncated = true;
    }

    return {
      environments,
      rawPages,
      nextCursor,
      fetchedPages: rawPages.length,
      truncated,
    };
  },

  remove: async (file: AuthFileItem, envId: string): Promise<void> => {
    const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
    if (!authIndex) {
      throw createStatusError('Auth file missing auth_index', 400);
    }

    const normalizedEnvId = normalizeStringValue(envId);
    if (!normalizedEnvId) {
      throw createStatusError('Codex remote cloud connect environment id is required', 400);
    }

    const accountId = resolveCodexRemoteCloudConnectEnvironmentAccountId(file);
    const result = await apiCallApi.request({
      authIndex,
      method: 'DELETE',
      url: buildCodexRemoteCloudConnectEnvironmentDeleteUrl(normalizedEnvId),
      header: buildCodexRemoteCloudConnectEnvironmentHeaders(accountId),
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw createStatusError(
        getCodexRemoteCloudConnectEnvironmentErrorMessage(result),
        result.statusCode
      );
    }
  },
};
