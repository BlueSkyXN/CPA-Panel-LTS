import { apiCallApi, getApiCallErrorMessage } from './apiCall';
import {
  ANTIGRAVITY_CODE_ASSIST_URL,
  ANTIGRAVITY_REQUEST_HEADERS,
  createStatusError,
  normalizeStringValue,
  parseAntigravityPayload,
} from '@/utils/quota';

export type AntigravitySubscriptionPlan = 'free' | 'pro' | 'ultra' | 'ultra-lite' | 'unknown';

export type AntigravitySubscriptionSummary = {
  plan: AntigravitySubscriptionPlan;
  tierId: string | null;
  tierName: string | null;
};

const CODE_ASSIST_REQUEST_BODY = JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } });
const PLAN_BY_TIER_ID = new Map<string, AntigravitySubscriptionPlan>([
  ['free-tier', 'free'],
  ['g1-pro-tier', 'pro'],
  ['g1-ultra-tier', 'ultra'],
  ['g1-ultra-lite-tier', 'ultra-lite'],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeTier = (value: unknown): { id: string | null; name: string | null } | null => {
  if (!isRecord(value)) return null;
  return {
    id: normalizeStringValue(value.id),
    name: normalizeStringValue(value.name),
  };
};

export const parseAntigravitySubscriptionSummary = (
  payload: unknown
): AntigravitySubscriptionSummary | null => {
  const parsed = parseAntigravityPayload(payload);
  if (!parsed) return null;

  const currentTier = normalizeTier(parsed.currentTier ?? parsed.current_tier);
  const paidTier = normalizeTier(parsed.paidTier ?? parsed.paid_tier);
  const effectiveTier = paidTier?.id ? paidTier : currentTier;
  if (!effectiveTier?.id && !effectiveTier?.name) return null;

  return {
    plan: effectiveTier.id ? (PLAN_BY_TIER_ID.get(effectiveTier.id) ?? 'unknown') : 'unknown',
    tierId: effectiveTier.id,
    tierName: effectiveTier.name,
  };
};

export const antigravitySubscriptionApi = {
  async get(authIndex: string): Promise<AntigravitySubscriptionSummary | null> {
    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: ANTIGRAVITY_CODE_ASSIST_URL,
      header: { ...ANTIGRAVITY_REQUEST_HEADERS },
      data: CODE_ASSIST_REQUEST_BODY,
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
    }

    return parseAntigravitySubscriptionSummary(result.body ?? result.bodyText);
  },
};
