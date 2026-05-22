import type { AuthFileItem } from '@/types';
import {
  normalizeStringValue,
  parseIdTokenPayload,
  resolveCodexChatgptAccountId,
} from '@/utils/quota';

const CODEX_REMOTE_CLOUD_CONNECT_ACCOUNT_CLAIM = 'https://api.openai.com/auth';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const normalized = normalizeStringValue(value);
    if (normalized) return normalized;
  }
  return null;
};

const resolveNestedRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const extractCodexRemoteCloudConnectAccountId = (token: unknown): string | null => {
  const payload = parseIdTokenPayload(token);
  if (!payload) return null;

  const authClaim = resolveNestedRecord(payload[CODEX_REMOTE_CLOUD_CONNECT_ACCOUNT_CLAIM]);
  return firstString(
    authClaim?.chatgpt_account_id,
    authClaim?.chatgptAccountId,
    payload.chatgpt_account_id,
    payload.chatgptAccountId
  );
};

export const resolveCodexRemoteCloudConnectAccountId = (file: AuthFileItem): string | null => {
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
    const accountId = extractCodexRemoteCloudConnectAccountId(candidate);
    if (accountId) return accountId;
  }

  return resolveCodexChatgptAccountId(file);
};
