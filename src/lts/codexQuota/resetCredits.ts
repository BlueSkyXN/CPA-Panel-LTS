import type { CodexRateLimitResetCredit, CodexRateLimitResetCredits } from '@/types';
import { normalizeNumberValue, normalizeStringValue } from '@/utils/quota';

export type CodexRateLimitResetCreditsInfo = {
  availableCount: number | null;
  expiresAt: string | number | null;
  credits: CodexRateLimitResetCredit[];
};

export const getCodexRateLimitResetCreditsAvailableCount = (
  payload?: CodexRateLimitResetCredits | null
): number | null =>
  normalizeNumberValue(payload?.available_count ?? payload?.availableCount);

export const getCodexResetCreditValue = (
  credit: CodexRateLimitResetCredit,
  snakeKey: keyof CodexRateLimitResetCredit,
  camelKey: keyof CodexRateLimitResetCredit
): unknown => credit[snakeKey] ?? credit[camelKey];

export const getCodexResetCreditStatus = (credit: CodexRateLimitResetCredit): string =>
  normalizeStringValue(credit.status)?.toLowerCase() ?? 'available';

export const isCodexResetCreditAvailable = (credit: CodexRateLimitResetCredit): boolean =>
  getCodexResetCreditStatus(credit) === 'available';

export const getCodexResetCreditExpiryMs = (value: unknown): number | null => {
  const numeric = normalizeNumberValue(value);
  if (numeric !== null) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  const stringValue = normalizeStringValue(value);
  if (!stringValue) return null;
  const ms = Date.parse(stringValue);
  return Number.isFinite(ms) ? ms : null;
};

export const getEarliestCodexResetCreditExpiry = (
  credits: CodexRateLimitResetCredit[]
): string | number | null => {
  const candidates = credits
    .filter(isCodexResetCreditAvailable)
    .map((credit) => getCodexResetCreditValue(credit, 'expires_at', 'expiresAt'))
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => ({ value, ms: getCodexResetCreditExpiryMs(value) }))
    .filter((item): item is { value: string | number; ms: number } => item.ms !== null)
    .sort((left, right) => left.ms - right.ms);

  return candidates[0]?.value ?? null;
};

export const sortCodexResetCredits = (
  credits: CodexRateLimitResetCredit[]
): CodexRateLimitResetCredit[] =>
  credits.slice().sort((left, right) => {
    const leftAvailable = isCodexResetCreditAvailable(left);
    const rightAvailable = isCodexResetCreditAvailable(right);
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;

    const leftExpiry =
      getCodexResetCreditExpiryMs(getCodexResetCreditValue(left, 'expires_at', 'expiresAt')) ??
      Number.MAX_SAFE_INTEGER;
    const rightExpiry =
      getCodexResetCreditExpiryMs(getCodexResetCreditValue(right, 'expires_at', 'expiresAt')) ??
      Number.MAX_SAFE_INTEGER;
    if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;

    const leftGranted =
      getCodexResetCreditExpiryMs(getCodexResetCreditValue(left, 'granted_at', 'grantedAt')) ??
      Number.MAX_SAFE_INTEGER;
    const rightGranted =
      getCodexResetCreditExpiryMs(getCodexResetCreditValue(right, 'granted_at', 'grantedAt')) ??
      Number.MAX_SAFE_INTEGER;
    return leftGranted - rightGranted;
  });

export const getCodexRateLimitResetCreditExpiresAt = (
  payload?: CodexRateLimitResetCredits | null
): string | number | null =>
  getEarliestCodexResetCreditExpiry(Array.isArray(payload?.credits) ? payload.credits : []);

export const getCodexRateLimitResetCreditsInfo = (
  payload?: CodexRateLimitResetCredits | null
): CodexRateLimitResetCreditsInfo => ({
  availableCount: getCodexRateLimitResetCreditsAvailableCount(payload),
  expiresAt: getCodexRateLimitResetCreditExpiresAt(payload),
  credits: Array.isArray(payload?.credits) ? payload.credits : [],
});
