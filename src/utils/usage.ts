/**
 * 使用统计相关工具
 * 迁移自基线 modules/usage.js 的纯逻辑部分
 */

import type { ScriptableContext } from 'chart.js';
import type { LatencyAccumulator, LatencyStats } from './usage/latency';
import {
  addLatencySample,
  calculateLatencyStatsFromDetails,
  createLatencyAccumulator,
  extractLatencyMs,
  finalizeLatencyStats,
} from './usage/latency';
import {
  getUsageCacheTokenCounts,
  resolveUsageTotalTokens,
  toTokenCount,
  type UsageTokenFields,
} from './usage/cacheTokens';
import {
  aggregateCostEstimateCoverage,
  createDefaultPriceProfileV3,
  resolvePriceProfile,
  type CostEstimate,
  type CostEstimateWarning,
  type PriceProfileV3,
  type PricingCoverage,
  type PricingCoverageInput,
  type ResolvedPrice,
} from './usage/pricing';
import { estimateUsageDetailCost, pricedAmountOrZero } from './usage/pricing/usagePricing';
import { normalizeReasoningEffort } from './usage/reasoningEffort';
import { normalizeServiceTier } from './usage/serviceTier';
import {
  extractTTFBMs,
  extractTTFTMs,
  extractTTFAMs,
  extractTimingVersion,
  normalizeSemanticTimingMs,
} from './usage/performance';
import { maskApiKey } from './format';
import { parseTimestampMs } from './timestamp';

export type { DurationFormatOptions, LatencyStats } from './usage/latency';
export {
  LATENCY_SOURCE_FIELD,
  LATENCY_SOURCE_UNIT,
  calculateLatencyStatsFromDetails,
  extractLatencyMs,
  formatDurationMs,
} from './usage/latency';
export {
  calculateAverageTps,
  calculateDecodeDurationMs,
  calculateOutputTps,
  calculateReasoningRatio,
  calculateVisibleAverageTps,
  extractTTFBMs,
  extractTTFTMs,
  extractTTFAMs,
  extractTimingVersion,
  formatPerSecondValue,
  normalizeSemanticTimingMs,
  summarizeUsagePerformance,
  SEMANTIC_TIMING_VERSION,
  TIMING_VERSION_SOURCE_FIELD,
  TTFB_SOURCE_FIELD,
  TTFB_SOURCE_UNIT,
  TTFA_SOURCE_FIELD,
  TTFT_SOURCE_FIELD,
} from './usage/performance';

export interface KeyStatBucket {
  success: number;
  failure: number;
}

export interface KeyStats {
  bySource: Record<string, KeyStatBucket>;
  byAuthIndex: Record<string, KeyStatBucket>;
}

export interface TokenBreakdown {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export interface RateStats {
  rpm: number;
  tpm: number;
  windowMinutes: number;
  requestCount: number;
  tokenCount: number;
}

export type {
  ContextBand,
  CostEstimate,
  CostEstimateStatus,
  CostEstimateWarning,
  FastOverride,
  ApiFastPolicyDisplay,
  LocalEstimateCoverageDisplay,
  LongContextPricing,
  ModelMatch,
  PriceCatalogEntry,
  PriceOverride,
  PriceProfileV3,
  PricingCoverage,
  PresetOverrideRecovery,
  ResolvedPrice,
  StandardPricing,
  TokenRates,
} from './usage/pricing';
export {
  OPENAI_CATALOG_AS_OF,
  OPENAI_PRICING_SOURCE_URL,
  PRICE_CATALOG,
  PRICE_CATALOG_AS_OF,
  PRICE_CATALOG_VERSION,
  PRICE_PROFILE_SCHEMA_VERSION,
  aggregateCostEstimateCoverage,
  createDefaultPriceProfileV3,
  estimateUsageCost,
  exportPriceProfileV3,
  findCatalogEntry,
  getApiFastPolicyDisplay,
  getLocalEstimateCoverageDisplay,
  hasPricingAnomaly,
  importPriceProfileV3,
  isLocalEstimateComplete,
  materializePriceProfiles,
  migrateModelPricesV2ToV3,
  normalizePriceProfileV3,
  preflightPriceProfileImportV3,
  resolvePriceProfile,
  restorePresetEquivalentOverrides,
  serializePriceProfileV3,
  ZAI_CATALOG_AS_OF,
  ZAI_PRICING_SOURCE_URL,
} from './usage/pricing';
export {
  LEGACY_MODEL_PRICE_STORAGE_KEY,
  PRICE_PROFILE_STORAGE_KEY,
  loadPriceProfileV3,
  resetPriceProfileV3,
  savePriceProfileV3,
} from './usage/pricing/storage';
export type { PriceProfileLoadResult, PriceProfileLoadSource } from './usage/pricing/storage';
export {
  estimateUsageDetailCost,
  resolveUsageDetailServiceTier,
  summarizeUsageDetailCosts,
} from './usage/pricing/usagePricing';
export type {
  DisplayServiceTier,
  ResolvedServiceTier,
  ServiceTierEvidence,
} from './usage/serviceTier';
export { classifyServiceTier, normalizeServiceTier, resolveServiceTier } from './usage/serviceTier';

export interface UsageTokenStats extends UsageTokenFields {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  total_tokens?: number;
}

export interface UsageDetail {
  timestamp: string;
  source: string;
  auth_index: string | number | null;
  service_tier?: string | null;
  request_service_tier?: string | null;
  outbound_service_tier?: string | null;
  response_service_tier?: string | null;
  effective_service_tier?: string | null;
  reasoning_effort?: string | null;
  latency_ms?: number;
  ttfb_ms?: number;
  timing_version?: number;
  ttft_ms?: number;
  ttfa_ms?: number;
  tokens: UsageTokenStats;
  failed: boolean;
  /** Parent key from usage.apis; may be a caller key, endpoint, provider, or unknown fallback. */
  __apiBucket?: string;
  __modelName?: string;
  __timestampMs?: number;
}

export interface UsageDetailWithEndpoint extends UsageDetail {
  __endpoint: string;
  __endpointMethod?: string;
  __endpointPath?: string;
  __timestampMs: number;
}

export interface ApiStats {
  endpoint: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalCost: number;
  pricingCoverage: PricingCoverage;
  models: Record<
    string,
    { requests: number; successCount: number; failureCount: number; tokens: number }
  >;
}

export interface ModelStatsSummary {
  model: string;
  requests: number;
  successCount: number;
  failureCount: number;
  tokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheRate: number | null;
  cost: number;
  pricingCoverage: PricingCoverage;
  averageLatencyMs: number | null;
  latencySampleCount: number;
}

export interface PricingModelSummary {
  modelName: string;
  resolvedPrice: ResolvedPrice;
  pricingCoverage: PricingCoverage;
  requestCount: number;
  tokenCount: number;
  estimatedAmount: number;
  fastRequestCount: number;
  longContextRequestCount: number;
  warnings: CostEstimateWarning[];
}

export interface UsagePricingAnalysis {
  coverage: PricingCoverage;
  modelSummaries: PricingModelSummary[];
}

export type UsageTimeRange = '7h' | '24h' | '7d' | 'all';

const USAGE_ENDPOINT_METHOD_REGEX = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i;
const USAGE_TIME_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '7h': 7 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const createEmptyPricingCoverage = (): PricingCoverage => aggregateCostEstimateCoverage([]);

const getApisRecord = (usageData: unknown): Record<string, unknown> | null => {
  const usageRecord = isRecord(usageData) ? usageData : null;
  const apisRaw = usageRecord ? usageRecord.apis : null;
  return isRecord(apisRaw) ? apisRaw : null;
};

interface PricingUsageAggregate {
  requests: number;
  tokens: number;
}

const toAggregateCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const pricingRatio = (part: number, total: number): number => (total > 0 ? part / total : 0);

const reconcilePricingCoverage = (
  coverage: PricingCoverage,
  aggregateRequests: unknown,
  aggregateTokens: unknown,
  totalModels: number = coverage.totalModels,
  pricedModels: number = coverage.pricedModels
): PricingCoverage => {
  const totalRequests = Math.max(coverage.totalRequests, toAggregateCount(aggregateRequests));
  const totalTokens = Math.max(coverage.totalTokens, toAggregateCount(aggregateTokens));
  const hasAggregateGap =
    totalRequests > coverage.totalRequests || totalTokens > coverage.totalTokens;
  const reconciledPricedModels =
    hasAggregateGap && totalModels > 0 && pricedModels >= totalModels
      ? totalModels - 1
      : pricedModels;
  return {
    ...coverage,
    totalRequests,
    totalTokens,
    totalModels,
    pricedModels: reconciledPricedModels,
    pricedRequestRatio: pricingRatio(coverage.pricedRequests, totalRequests),
    pricedTokenRatio: pricingRatio(coverage.pricedTokens, totalTokens),
    pricedModelRatio: pricingRatio(reconciledPricedModels, totalModels),
  };
};

const reconcileModelPricingCoverage = (
  coverage: PricingCoverage,
  aggregateRequests: unknown,
  aggregateTokens: unknown
): PricingCoverage => {
  const totalRequests = Math.max(coverage.totalRequests, toAggregateCount(aggregateRequests));
  const totalTokens = Math.max(coverage.totalTokens, toAggregateCount(aggregateTokens));
  const hasUsage = totalRequests > 0 || totalTokens > 0 || coverage.totalModels > 0;
  const pricedModels =
    hasUsage &&
    totalRequests > 0 &&
    coverage.pricedRequests === totalRequests &&
    coverage.pricedTokens === totalTokens
      ? 1
      : 0;
  return reconcilePricingCoverage(
    coverage,
    totalRequests,
    totalTokens,
    hasUsage ? 1 : 0,
    pricedModels
  );
};

const combinePricingCoverages = (coverages: Iterable<PricingCoverage>): PricingCoverage => {
  const combined = createEmptyPricingCoverage();
  for (const coverage of coverages) {
    combined.totalRequests += coverage.totalRequests;
    combined.pricedRequests += coverage.pricedRequests;
    combined.unmatchedRequests += coverage.unmatchedRequests;
    combined.unsupportedRequests += coverage.unsupportedRequests;
    combined.totalTokens += coverage.totalTokens;
    combined.pricedTokens += coverage.pricedTokens;
    combined.totalModels += coverage.totalModels;
    combined.pricedModels += coverage.pricedModels;
    combined.estimatedAmount += coverage.estimatedAmount;
    combined.assumedTierRequests += coverage.assumedTierRequests;
  }
  combined.pricedRequestRatio = pricingRatio(combined.pricedRequests, combined.totalRequests);
  combined.pricedTokenRatio = pricingRatio(combined.pricedTokens, combined.totalTokens);
  combined.pricedModelRatio = pricingRatio(combined.pricedModels, combined.totalModels);
  return combined;
};

const collectUsageModelAggregates = (usageData: unknown): Map<string, PricingUsageAggregate> => {
  const aggregates = new Map<string, PricingUsageAggregate>();
  const apis = getApisRecord(usageData);
  if (!apis) return aggregates;

  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry) || !isRecord(apiEntry.models)) return;
    Object.entries(apiEntry.models).forEach(([modelName, modelEntry]) => {
      if (!modelName || !isRecord(modelEntry)) return;
      const aggregate = aggregates.get(modelName) ?? { requests: 0, tokens: 0 };
      aggregate.requests += toAggregateCount(modelEntry.total_requests);
      aggregate.tokens += toAggregateCount(modelEntry.total_tokens);
      aggregates.set(modelName, aggregate);
    });
  });

  return aggregates;
};

const normalizeUsageDetailTokens = (tokensRaw: Record<string, unknown>): UsageTokenStats => {
  const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(tokensRaw);
  return {
    ...tokensRaw,
    cached_tokens: cacheReadTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: cacheWriteTokens,
  } as UsageTokenStats;
};

interface UsageSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
}

const createUsageSummary = (): UsageSummary => ({
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
});

const toUsageSummaryFields = (summary: UsageSummary) => ({
  total_requests: summary.totalRequests,
  success_count: summary.successCount,
  failure_count: summary.failureCount,
  total_tokens: summary.totalTokens,
});

export function filterUsageByTimeRange<T>(
  usageData: T,
  range: UsageTimeRange,
  nowMs: number = Date.now()
): T {
  if (range === 'all') {
    return usageData;
  }

  const usageRecord = isRecord(usageData) ? usageData : null;
  const apis = getApisRecord(usageData);
  if (!usageRecord || !apis) {
    return usageData;
  }

  const rangeMs = USAGE_TIME_RANGE_MS[range];
  if (!Number.isFinite(rangeMs) || rangeMs <= 0) {
    return usageData;
  }

  const windowStart = nowMs - rangeMs;
  const filteredApis: Record<string, unknown> = {};
  const totalSummary = createUsageSummary();

  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      return;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      return;
    }

    const filteredModels: Record<string, unknown> = {};
    const apiSummary = createUsageSummary();
    let hasModelData = false;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) {
        return;
      }

      const detailsRaw = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      const modelSummary = createUsageSummary();
      const filteredDetails: unknown[] = [];

      detailsRaw.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        if (!detailRecord || typeof detailRecord.timestamp !== 'string') {
          return;
        }
        const timestamp = parseTimestampMs(detailRecord.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart || timestamp > nowMs) {
          return;
        }

        filteredDetails.push(detail);
        modelSummary.totalRequests += 1;
        if (detailRecord.failed === true) {
          modelSummary.failureCount += 1;
        } else {
          modelSummary.successCount += 1;
        }
        modelSummary.totalTokens += extractTotalTokens(detailRecord, modelName);
      });

      if (!filteredDetails.length) {
        return;
      }

      filteredModels[modelName] = {
        ...modelEntry,
        ...toUsageSummaryFields(modelSummary),
        details: filteredDetails,
      };
      hasModelData = true;

      apiSummary.totalRequests += modelSummary.totalRequests;
      apiSummary.successCount += modelSummary.successCount;
      apiSummary.failureCount += modelSummary.failureCount;
      apiSummary.totalTokens += modelSummary.totalTokens;
    });

    if (!hasModelData) {
      return;
    }

    filteredApis[apiName] = {
      ...apiEntry,
      ...toUsageSummaryFields(apiSummary),
      models: filteredModels,
    };

    totalSummary.totalRequests += apiSummary.totalRequests;
    totalSummary.successCount += apiSummary.successCount;
    totalSummary.failureCount += apiSummary.failureCount;
    totalSummary.totalTokens += apiSummary.totalTokens;
  });

  return {
    ...usageRecord,
    ...toUsageSummaryFields(totalSummary),
    apis: filteredApis,
  } as T;
}

export const normalizeAuthIndex = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const extractNamedServiceTier = (
  detail: Record<string, unknown>,
  snakeCaseKey: string,
  camelCaseKey: string,
  pascalCaseKey: string
): string | null =>
  normalizeServiceTier(detail[snakeCaseKey]) ??
  normalizeServiceTier(detail[camelCaseKey]) ??
  normalizeServiceTier(detail[pascalCaseKey]);

const extractServiceTier = (detail: Record<string, unknown>): string | null =>
  extractNamedServiceTier(detail, 'service_tier', 'serviceTier', 'ServiceTier');

const extractRequestServiceTier = (detail: Record<string, unknown>): string | null =>
  extractNamedServiceTier(
    detail,
    'request_service_tier',
    'requestServiceTier',
    'RequestServiceTier'
  );

const extractOutboundServiceTier = (detail: Record<string, unknown>): string | null =>
  extractNamedServiceTier(
    detail,
    'outbound_service_tier',
    'outboundServiceTier',
    'OutboundServiceTier'
  );

const extractResponseServiceTier = (detail: Record<string, unknown>): string | null =>
  extractNamedServiceTier(
    detail,
    'response_service_tier',
    'responseServiceTier',
    'ResponseServiceTier'
  );

const extractEffectiveServiceTier = (detail: Record<string, unknown>): string | null =>
  extractNamedServiceTier(
    detail,
    'effective_service_tier',
    'effectiveServiceTier',
    'EffectiveServiceTier'
  );

const extractReasoningEffort = (detail: Record<string, unknown>): string | null =>
  normalizeReasoningEffort(detail.reasoning_effort) ??
  normalizeReasoningEffort(detail.reasoningEffort) ??
  normalizeReasoningEffort(detail.ReasoningEffort);

const USAGE_SOURCE_PREFIX_KEY = 'k:';
const USAGE_SOURCE_PREFIX_MASKED = 'm:';
const USAGE_SOURCE_PREFIX_TEXT = 't:';

const KEY_LIKE_TOKEN_REGEX =
  /(sk-[A-Za-z0-9-_]{6,}|sk-ant-[A-Za-z0-9-_]{6,}|AIza[0-9A-Za-z-_]{8,}|AI[a-zA-Z0-9_-]{6,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/;
const MASKED_TOKEN_HINT_REGEX = /^[^\s]{1,24}(\*{2,}|\.{3}|…)[^\s]{1,24}$/;

const keyFingerprintCache = new Map<string, string>();

const fnv1a64Hex = (value: string): string => {
  const cached = keyFingerprintCache.get(value);
  if (cached) return cached;

  const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }

  const hex = hash.toString(16).padStart(16, '0');
  keyFingerprintCache.set(value, hex);
  return hex;
};

const looksLikeRawSecret = (text: string): boolean => {
  if (!text || /\s/.test(text)) return false;

  const lower = text.toLowerCase();
  if (lower.endsWith('.json')) return false;
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  if (/[\\/]/.test(text)) return false;

  if (KEY_LIKE_TOKEN_REGEX.test(text)) return true;

  if (text.length >= 32 && text.length <= 512) {
    return true;
  }

  if (text.length >= 16 && text.length < 32 && /^[A-Za-z0-9._=-]+$/.test(text)) {
    return /[A-Za-z]/.test(text) && /\d/.test(text);
  }

  return false;
};

const extractRawSecretFromText = (text: string): string | null => {
  if (!text) return null;
  if (looksLikeRawSecret(text)) return text;

  const keyLikeMatch = text.match(KEY_LIKE_TOKEN_REGEX);
  if (keyLikeMatch?.[0]) return keyLikeMatch[0];

  const queryMatch = text.match(
    /(?:[?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/i
  );
  const queryValue = queryMatch?.[2];
  if (queryValue && looksLikeRawSecret(queryValue)) {
    return queryValue;
  }

  const headerMatch = text.match(
    /(api[-_]?key|key|token|access[-_]?token|authorization)\s*[:=]\s*([A-Za-z0-9._=-]+)/i
  );
  const headerValue = headerMatch?.[2];
  if (headerValue && looksLikeRawSecret(headerValue)) {
    return headerValue;
  }

  const bearerMatch = text.match(/\bBearer\s+([A-Za-z0-9._=-]{6,})/i);
  const bearerValue = bearerMatch?.[1];
  if (bearerValue && looksLikeRawSecret(bearerValue)) {
    return bearerValue;
  }

  return null;
};

export function normalizeUsageSourceId(
  value: unknown,
  masker: (val: string) => string = maskApiKey
): string {
  const raw =
    typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const extracted = extractRawSecretFromText(trimmed);
  if (extracted) {
    return `${USAGE_SOURCE_PREFIX_KEY}${fnv1a64Hex(extracted)}`;
  }

  if (MASKED_TOKEN_HINT_REGEX.test(trimmed)) {
    return `${USAGE_SOURCE_PREFIX_MASKED}${masker(trimmed)}`;
  }

  return `${USAGE_SOURCE_PREFIX_TEXT}${trimmed}`;
}

export function buildCandidateUsageSourceIds(input: {
  apiKey?: string;
  prefix?: string;
}): string[] {
  const result: string[] = [];

  const prefix = input.prefix?.trim();
  if (prefix) {
    result.push(`${USAGE_SOURCE_PREFIX_TEXT}${prefix}`);
  }

  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    // Include the normalised form first so that "non-standard" keys (e.g. short tokens,
    // keys containing '/' etc.) that are classified as text by normalizeUsageSourceId()
    // can still match usage details.
    result.push(normalizeUsageSourceId(apiKey));
    result.push(`${USAGE_SOURCE_PREFIX_KEY}${fnv1a64Hex(apiKey)}`);
    result.push(`${USAGE_SOURCE_PREFIX_MASKED}${maskApiKey(apiKey)}`);
  }

  return Array.from(new Set(result));
}

/**
 * 对使用数据中的敏感字段进行遮罩
 */
export function maskUsageSensitiveValue(
  value: unknown,
  masker: (val: string) => string = maskApiKey
): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = typeof value === 'string' ? value : String(value);
  if (!raw) {
    return '';
  }

  let masked = raw;

  const queryRegex = /([?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/gi;
  masked = masked.replace(
    queryRegex,
    (_full, prefix, keyName, valuePart) => `${prefix}${keyName}=${masker(valuePart)}`
  );

  const headerRegex =
    /(api[-_]?key|key|token|access[-_]?token|authorization)\s*([:=])\s*([A-Za-z0-9._-]+)/gi;
  masked = masked.replace(
    headerRegex,
    (_full, keyName, separator, valuePart) => `${keyName}${separator}${masker(valuePart)}`
  );

  const keyLikeRegex =
    /(sk-[A-Za-z0-9]{6,}|AI[a-zA-Z0-9_-]{6,}|AIza[0-9A-Za-z-_]{8,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;
  masked = masked.replace(keyLikeRegex, (match) => masker(match));

  if (masked === raw) {
    const trimmed = raw.trim();
    if (trimmed && !/\s/.test(trimmed)) {
      const looksLikeKey =
        /^sk-/i.test(trimmed) ||
        /^AI/i.test(trimmed) ||
        /^AIza/i.test(trimmed) ||
        /^hf_/i.test(trimmed) ||
        /^pk_/i.test(trimmed) ||
        /^rk_/i.test(trimmed) ||
        (!/[\\/]/.test(trimmed) && (/\d/.test(trimmed) || trimmed.length >= 10)) ||
        trimmed.length >= 24;
      if (looksLikeKey) {
        return masker(trimmed);
      }
    }
  }

  return masked;
}

/**
 * 格式化每分钟数值
 */
export function formatPerMinuteValue(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0.00';
  }
  const abs = Math.abs(num);
  if (abs >= 1000) {
    return Math.round(num).toLocaleString();
  }
  if (abs >= 100) {
    return num.toFixed(0);
  }
  if (abs >= 10) {
    return num.toFixed(1);
  }
  return num.toFixed(2);
}

/**
 * 格式化紧凑数字
 */
export function formatCompactNumber(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0';
  }
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return abs >= 1 ? num.toFixed(0) : num.toFixed(2);
}

/**
 * 格式化美元
 */
export function formatUsd(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '$0.00';
  }
  const fixed = num.toFixed(2);
  const parts = Number(fixed).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${parts}`;
}

const usageDetailsCache = new WeakMap<object, UsageDetail[]>();
const usageDetailsWithEndpointCache = new WeakMap<object, UsageDetailWithEndpoint[]>();

/**
 * 从使用数据中收集所有请求明细
 */
export function collectUsageDetails(usageData: unknown): UsageDetail[] {
  const cacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (cacheKey) {
    const cached = usageDetailsCache.get(cacheKey);
    if (cached) return cached;
  }

  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const details: UsageDetail[] = [];
  const sourceCache = new Map<string, string>();

  const normalizeSource = (value: unknown): string => {
    const raw =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const cached = sourceCache.get(trimmed);
    if (cached !== undefined) return cached;
    const normalized = normalizeUsageSourceId(trimmed);
    sourceCache.set(trimmed, normalized);
    return normalized;
  };

  Object.entries(apis).forEach(([apiBucket, apiEntry]) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;
      const modelDetailsRaw = modelEntry.details;
      const modelDetails = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : [];

      modelDetails.forEach((detailRaw) => {
        if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') return;
        const timestamp = detailRaw.timestamp;
        const timestampMs = parseTimestampMs(timestamp);
        const tokensRaw = isRecord(detailRaw.tokens) ? detailRaw.tokens : {};
        const latencyMs = extractLatencyMs(detailRaw);
        const ttfbMs = extractTTFBMs(detailRaw);
        const timingVersion = extractTimingVersion(detailRaw);
        const ttftMs = normalizeSemanticTimingMs(
          extractTTFTMs(detailRaw),
          latencyMs,
          ttfbMs
        );
        const ttfaMs = normalizeSemanticTimingMs(
          extractTTFAMs(detailRaw),
          latencyMs,
          ttfbMs
        );
        details.push({
          timestamp,
          source: normalizeSource(detailRaw.source),
          auth_index: (detailRaw?.auth_index ??
            detailRaw?.authIndex ??
            detailRaw?.AuthIndex ??
            null) as UsageDetail['auth_index'],
          service_tier: extractServiceTier(detailRaw),
          request_service_tier: extractRequestServiceTier(detailRaw),
          outbound_service_tier: extractOutboundServiceTier(detailRaw),
          response_service_tier: extractResponseServiceTier(detailRaw),
          effective_service_tier: extractEffectiveServiceTier(detailRaw),
          reasoning_effort: extractReasoningEffort(detailRaw),
          latency_ms: latencyMs ?? undefined,
          ttfb_ms: ttfbMs ?? undefined,
          timing_version: timingVersion ?? undefined,
          ttft_ms: ttftMs ?? undefined,
          ttfa_ms: ttfaMs ?? undefined,
          tokens: normalizeUsageDetailTokens(tokensRaw),
          failed: detailRaw.failed === true,
          __apiBucket: apiBucket,
          __modelName: modelName,
          __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        });
      });
    });
  });

  if (cacheKey) {
    usageDetailsCache.set(cacheKey, details);
  }
  return details;
}

/**
 * 从使用数据中收集包含 endpoint/method/path 的请求明细
 */
export function collectUsageDetailsWithEndpoint(usageData: unknown): UsageDetailWithEndpoint[] {
  const cacheKey = isRecord(usageData) ? (usageData as object) : null;
  if (cacheKey) {
    const cached = usageDetailsWithEndpointCache.get(cacheKey);
    if (cached) return cached;
  }

  const apis = getApisRecord(usageData);
  if (!apis) return [];

  const details: UsageDetailWithEndpoint[] = [];
  const sourceCache = new Map<string, string>();

  const normalizeSource = (value: unknown): string => {
    const raw =
      typeof value === 'string'
        ? value
        : value === null || value === undefined
          ? ''
          : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const cached = sourceCache.get(trimmed);
    if (cached !== undefined) return cached;
    const normalized = normalizeUsageSourceId(trimmed);
    sourceCache.set(trimmed, normalized);
    return normalized;
  };

  Object.entries(apis).forEach(([endpoint, apiEntry]) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    const endpointMatch = endpoint.match(USAGE_ENDPOINT_METHOD_REGEX);
    const endpointMethod = endpointMatch?.[1]?.toUpperCase();
    const endpointPath = endpointMatch?.[2];

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) return;
      const modelDetailsRaw = modelEntry.details;
      const modelDetails = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : [];

      modelDetails.forEach((detailRaw) => {
        if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') return;
        const timestamp = detailRaw.timestamp;
        const timestampMs = parseTimestampMs(timestamp);
        const tokensRaw = isRecord(detailRaw.tokens) ? detailRaw.tokens : {};
        const latencyMs = extractLatencyMs(detailRaw);
        const ttfbMs = extractTTFBMs(detailRaw);
        const timingVersion = extractTimingVersion(detailRaw);
        const ttftMs = normalizeSemanticTimingMs(extractTTFTMs(detailRaw), latencyMs, ttfbMs);
        const ttfaMs = normalizeSemanticTimingMs(extractTTFAMs(detailRaw), latencyMs, ttfbMs);
        details.push({
          timestamp,
          source: normalizeSource(detailRaw.source),
          auth_index: (detailRaw?.auth_index ??
            detailRaw?.authIndex ??
            detailRaw?.AuthIndex ??
            null) as UsageDetail['auth_index'],
          service_tier: extractServiceTier(detailRaw),
          request_service_tier: extractRequestServiceTier(detailRaw),
          outbound_service_tier: extractOutboundServiceTier(detailRaw),
          response_service_tier: extractResponseServiceTier(detailRaw),
          effective_service_tier: extractEffectiveServiceTier(detailRaw),
          reasoning_effort: extractReasoningEffort(detailRaw),
          latency_ms: latencyMs ?? undefined,
          ttfb_ms: ttfbMs ?? undefined,
          timing_version: timingVersion ?? undefined,
          ttft_ms: ttftMs ?? undefined,
          ttfa_ms: ttfaMs ?? undefined,
          tokens: normalizeUsageDetailTokens(tokensRaw),
          failed: detailRaw.failed === true,
          __apiBucket: endpoint,
          __modelName: modelName,
          __endpoint: endpoint,
          __endpointMethod: endpointMethod,
          __endpointPath: endpointPath,
          __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        });
      });
    });
  });

  if (cacheKey) {
    usageDetailsWithEndpointCache.set(cacheKey, details);
  }
  return details;
}

/**
 * 从单条明细提取总 tokens
 */
export function extractTotalTokens(detail: unknown, modelNameOverride?: string): number {
  const record = isRecord(detail) ? detail : null;
  const tokensRaw = record?.tokens;
  const tokens = isRecord(tokensRaw) ? tokensRaw : {};
  const modelName =
    modelNameOverride ?? (typeof record?.__modelName === 'string' ? record.__modelName : '');
  return resolveUsageTotalTokens(tokens, modelName);
}

/**
 * 计算耗时统计
 */
export function calculateLatencyStats(usageData: unknown): LatencyStats {
  return calculateLatencyStatsFromDetails(collectUsageDetails(usageData));
}

/**
 * 计算 token 分类统计
 */
export function calculateTokenBreakdown(usageData: unknown): TokenBreakdown {
  const details = collectUsageDetails(usageData);
  if (!details.length) {
    return { cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  }

  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let reasoningTokens = 0;

  details.forEach((detail) => {
    const tokens = detail.tokens;
    const cacheTokens = getUsageCacheTokenCounts(tokens);
    cacheReadTokens += cacheTokens.cacheReadTokens;
    cacheWriteTokens += cacheTokens.cacheWriteTokens;
    if (typeof tokens.reasoning_tokens === 'number') {
      reasoningTokens += tokens.reasoning_tokens;
    }
  });

  return { cacheReadTokens, cacheWriteTokens, reasoningTokens };
}

/**
 * 计算最近 N 分钟的 RPM/TPM
 */
export function calculateRecentPerMinuteRates(
  windowMinutes: number = 30,
  usageData: unknown
): RateStats {
  const details = collectUsageDetails(usageData);
  const effectiveWindow = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : 30;

  if (!details.length) {
    return { rpm: 0, tpm: 0, windowMinutes: effectiveWindow, requestCount: 0, tokenCount: 0 };
  }

  const now = Date.now();
  const windowStart = now - effectiveWindow * 60 * 1000;
  let requestCount = 0;
  let tokenCount = 0;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) {
      return;
    }
    requestCount += 1;
    tokenCount += extractTotalTokens(detail);
  });

  const denominator = effectiveWindow > 0 ? effectiveWindow : 1;
  return {
    rpm: requestCount / denominator,
    tpm: tokenCount / denominator,
    windowMinutes: effectiveWindow,
    requestCount,
    tokenCount,
  };
}

/**
 * 从使用数据获取模型名称列表
 */
export function getModelNamesFromUsage(usageData: unknown): string[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const names = new Set<string>();
  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;
    Object.keys(models).forEach((modelName) => {
      if (modelName) {
        names.add(modelName);
      }
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function calculateCostEstimate(
  detail: UsageDetail,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): CostEstimate {
  return estimateUsageDetailCost(detail, priceProfile).estimate;
}

/** Numeric compatibility wrapper. Coverage-aware UI should use calculateCostEstimate. */
export function calculateCost(
  detail: UsageDetail,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): number {
  return pricedAmountOrZero(calculateCostEstimate(detail, priceProfile));
}

export function calculatePricingCoverage(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): PricingCoverage {
  return analyzeUsagePricing(usageData, priceProfile).coverage;
}

/** One-pass pricing analysis for UI surfaces that need both coverage and model rows. */
export function analyzeUsagePricing(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): UsagePricingAnalysis {
  const modelSummaries = getPricingModelSummaries(usageData, priceProfile);
  const modelCoverage = combinePricingCoverages(
    modelSummaries.map((summary) => summary.pricingCoverage)
  );
  const usageRecord = isRecord(usageData) ? usageData : {};
  return {
    coverage: reconcilePricingCoverage(
      modelCoverage,
      usageRecord.total_requests,
      usageRecord.total_tokens
    ),
    modelSummaries,
  };
}

export function calculateTotalCost(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): number {
  return calculatePricingCoverage(usageData, priceProfile).estimatedAmount;
}

/**
 * 获取 API 统计数据
 */
export function getApiStats(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): ApiStats[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const result: ApiStats[] = [];
  const detailsByEndpointAndModel = new Map<string, UsageDetailWithEndpoint[]>();
  collectUsageDetailsWithEndpoint(usageData).forEach((detail) => {
    const key = `${detail.__endpoint}\u0000${detail.__modelName ?? ''}`;
    const bucket = detailsByEndpointAndModel.get(key);
    if (bucket) bucket.push(detail);
    else detailsByEndpointAndModel.set(key, [detail]);
  });

  Object.entries(apis).forEach(([endpoint, apiData]) => {
    if (!isRecord(apiData)) return;
    const models: Record<
      string,
      { requests: number; successCount: number; failureCount: number; tokens: number }
    > = {};
    let derivedSuccessCount = 0;
    let derivedFailureCount = 0;
    const pricingCoverages: PricingCoverage[] = [];

    const modelsData = isRecord(apiData.models) ? apiData.models : {};
    Object.entries(modelsData).forEach(([modelName, modelData]) => {
      if (!isRecord(modelData)) return;
      const details = detailsByEndpointAndModel.get(`${endpoint}\u0000${modelName}`) ?? [];
      const hasExplicitCounts =
        typeof modelData.success_count === 'number' || typeof modelData.failure_count === 'number';

      let successCount = 0;
      let failureCount = 0;
      if (hasExplicitCounts) {
        successCount += Number(modelData.success_count) || 0;
        failureCount += Number(modelData.failure_count) || 0;
      }

      const modelPricingInputs = details.map((detail) => {
        if (!hasExplicitCounts) {
          if (detail.failed === true) {
            failureCount += 1;
          } else {
            successCount += 1;
          }
        }
        return estimateUsageDetailCost(detail, priceProfile);
      });
      pricingCoverages.push(
        reconcileModelPricingCoverage(
          aggregateCostEstimateCoverage(modelPricingInputs),
          modelData.total_requests,
          modelData.total_tokens
        )
      );

      models[modelName] = {
        requests: Number(modelData.total_requests) || 0,
        successCount,
        failureCount,
        tokens: Number(modelData.total_tokens) || 0,
      };
      derivedSuccessCount += successCount;
      derivedFailureCount += failureCount;
    });

    const hasApiExplicitCounts =
      typeof apiData.success_count === 'number' || typeof apiData.failure_count === 'number';
    const successCount = hasApiExplicitCounts
      ? Number(apiData.success_count) || 0
      : derivedSuccessCount;
    const failureCount = hasApiExplicitCounts
      ? Number(apiData.failure_count) || 0
      : derivedFailureCount;
    const pricingCoverage = reconcilePricingCoverage(
      combinePricingCoverages(pricingCoverages),
      apiData.total_requests,
      apiData.total_tokens
    );

    result.push({
      endpoint: maskUsageSensitiveValue(endpoint) || endpoint,
      totalRequests: Number(apiData.total_requests) || 0,
      successCount,
      failureCount,
      totalTokens: Number(apiData.total_tokens) || 0,
      totalCost: pricingCoverage.estimatedAmount,
      pricingCoverage,
      models,
    });
  });

  return result;
}

/**
 * 获取模型统计数据
 */
export function getModelStats(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): ModelStatsSummary[] {
  const apis = getApisRecord(usageData);
  if (!apis) return [];
  const detailsByEndpointAndModel = new Map<string, UsageDetailWithEndpoint[]>();
  collectUsageDetailsWithEndpoint(usageData).forEach((detail) => {
    const key = `${detail.__endpoint}\u0000${detail.__modelName ?? ''}`;
    const bucket = detailsByEndpointAndModel.get(key);
    if (bucket) bucket.push(detail);
    else detailsByEndpointAndModel.set(key, [detail]);
  });

  const modelMap = new Map<
    string,
    {
      requests: number;
      successCount: number;
      failureCount: number;
      tokens: number;
      inputTokens: number;
      cacheReadTokens: number;
      detailCount: number;
      pricingInputs: PricingCoverageInput[];
      latency: LatencyAccumulator;
    }
  >();

  Object.entries(apis).forEach(([endpoint, apiData]) => {
    if (!isRecord(apiData)) return;
    const modelsRaw = apiData.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.entries(models).forEach(([modelName, modelData]) => {
      if (!isRecord(modelData)) return;
      const existing = modelMap.get(modelName) || {
        requests: 0,
        successCount: 0,
        failureCount: 0,
        tokens: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        detailCount: 0,
        pricingInputs: [],
        latency: createLatencyAccumulator(),
      };
      existing.requests += Number(modelData.total_requests) || 0;
      existing.tokens += Number(modelData.total_tokens) || 0;

      const details = detailsByEndpointAndModel.get(`${endpoint}\u0000${modelName}`) ?? [];

      const hasExplicitCounts =
        typeof modelData.success_count === 'number' || typeof modelData.failure_count === 'number';
      if (hasExplicitCounts) {
        existing.successCount += Number(modelData.success_count) || 0;
        existing.failureCount += Number(modelData.failure_count) || 0;
      }

      if (details.length > 0) {
        details.forEach((detail) => {
          const latencyMs = extractLatencyMs(detail);
          const { cacheReadTokens } = getUsageCacheTokenCounts(detail.tokens);
          if (!hasExplicitCounts) {
            if (detail.failed === true) {
              existing.failureCount += 1;
            } else {
              existing.successCount += 1;
            }
          }

          addLatencySample(existing.latency, latencyMs);
          existing.detailCount += 1;
          existing.inputTokens += toTokenCount(detail.tokens.input_tokens);
          existing.cacheReadTokens += cacheReadTokens;
          existing.pricingInputs.push(estimateUsageDetailCost(detail, priceProfile));
        });
      }
      modelMap.set(modelName, existing);
    });
  });

  return Array.from(modelMap.entries())
    .map(([model, stats]) => {
      const latencyStats = finalizeLatencyStats(stats.latency);
      const pricingCoverage = reconcileModelPricingCoverage(
        aggregateCostEstimateCoverage(stats.pricingInputs),
        stats.requests,
        stats.tokens
      );
      return {
        model,
        requests: stats.requests,
        successCount: stats.successCount,
        failureCount: stats.failureCount,
        tokens: stats.tokens,
        inputTokens: stats.inputTokens,
        cacheReadTokens: stats.cacheReadTokens,
        cacheRate:
          stats.requests > 0 && stats.detailCount === stats.requests && stats.inputTokens > 0
            ? Math.max(stats.cacheReadTokens / stats.inputTokens, 0)
            : null,
        cost: pricingCoverage.estimatedAmount,
        pricingCoverage,
        averageLatencyMs: latencyStats.averageMs,
        latencySampleCount: latencyStats.sampleCount,
      };
    })
    .sort((a, b) => b.requests - a.requests);
}

export function getPricingModelSummaries(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): PricingModelSummary[] {
  const groups = new Map<
    string,
    {
      pricingInputs: PricingCoverageInput[];
      fastRequestCount: number;
      longContextRequestCount: number;
      warnings: Set<CostEstimateWarning>;
    }
  >();

  collectUsageDetails(usageData).forEach((detail) => {
    const modelName = detail.__modelName?.trim();
    if (!modelName) return;
    const pricingInput = estimateUsageDetailCost(detail, priceProfile);
    const group = groups.get(modelName) ?? {
      pricingInputs: [],
      fastRequestCount: 0,
      longContextRequestCount: 0,
      warnings: new Set<CostEstimateWarning>(),
    };
    group.pricingInputs.push(pricingInput);
    if (pricingInput.estimate.tier.tier === 'fast') {
      group.fastRequestCount += 1;
    }
    if (pricingInput.estimate.contextBand === 'long') {
      group.longContextRequestCount += 1;
    }
    pricingInput.estimate.warnings.forEach((warning) => group.warnings.add(warning));
    groups.set(modelName, group);
  });

  const aggregates = collectUsageModelAggregates(usageData);
  const modelNames = new Set(groups.keys());
  aggregates.forEach((aggregate, modelName) => {
    if (aggregate.requests > 0 || aggregate.tokens > 0) modelNames.add(modelName);
  });

  return Array.from(modelNames)
    .map((modelName) => {
      const group = groups.get(modelName) ?? {
        pricingInputs: [],
        fastRequestCount: 0,
        longContextRequestCount: 0,
        warnings: new Set<CostEstimateWarning>(),
      };
      const aggregate = aggregates.get(modelName);
      const pricingCoverage = reconcileModelPricingCoverage(
        aggregateCostEstimateCoverage(group.pricingInputs),
        aggregate?.requests,
        aggregate?.tokens
      );
      return {
        modelName,
        resolvedPrice: resolvePriceProfile(modelName, priceProfile),
        pricingCoverage,
        requestCount: pricingCoverage.totalRequests,
        tokenCount: pricingCoverage.totalTokens,
        estimatedAmount: pricingCoverage.estimatedAmount,
        fastRequestCount: group.fastRequestCount,
        longContextRequestCount: group.longContextRequestCount,
        warnings: Array.from(group.warnings),
      };
    })
    .sort(
      (left, right) =>
        right.requestCount - left.requestCount || left.modelName.localeCompare(right.modelName)
    );
}

/**
 * 格式化小时标签
 */
export function formatHourLabel(date: Date): string {
  if (!(date instanceof Date)) {
    return '';
  }
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  return `${month}-${day} ${hour}:00`;
}

/**
 * 格式化日期标签
 */
export function formatDayLabel(date: Date): string {
  if (!(date instanceof Date)) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 构建小时级别的数据序列
 */
export function buildHourlySeriesByModel(
  usageData: unknown,
  metric: 'requests' | 'tokens' = 'requests',
  hourWindow: number = 24
): {
  labels: string[];
  dataByModel: Map<string, number[]>;
  hasData: boolean;
} {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindow) && hourWindow > 0
      ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
      : 24;
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const earliestBucket = new Date(currentHour);
  earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliestBucket.getTime();

  const labels: string[] = [];
  for (let i = 0; i < resolvedHourWindow; i++) {
    const bucketStart = earliestTime + i * hourMs;
    labels.push(formatHourLabel(new Date(bucketStart)));
  }

  const details = collectUsageDetails(usageData);
  const dataByModel = new Map<string, number[]>();
  let hasData = false;

  if (!details.length) {
    return { labels, dataByModel, hasData };
  }

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return;
    }

    const normalized = new Date(timestamp);
    normalized.setMinutes(0, 0, 0);
    const bucketStart = normalized.getTime();
    const lastBucketTime = earliestTime + (labels.length - 1) * hourMs;
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) {
      return;
    }

    const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
    if (bucketIndex < 0 || bucketIndex >= labels.length) {
      return;
    }

    const modelName = detail.__modelName || 'Unknown';
    if (!dataByModel.has(modelName)) {
      dataByModel.set(modelName, new Array(labels.length).fill(0));
    }

    const bucketValues = dataByModel.get(modelName)!;
    if (metric === 'tokens') {
      bucketValues[bucketIndex] += extractTotalTokens(detail);
    } else {
      bucketValues[bucketIndex] += 1;
    }
    hasData = true;
  });

  return { labels, dataByModel, hasData };
}

/**
 * 构建日级别的数据序列
 */
export function buildDailySeriesByModel(
  usageData: unknown,
  metric: 'requests' | 'tokens' = 'requests'
): {
  labels: string[];
  dataByModel: Map<string, number[]>;
  hasData: boolean;
} {
  const details = collectUsageDetails(usageData);
  const valuesByModel = new Map<string, Map<string, number>>();
  const labelsSet = new Set<string>();
  let hasData = false;

  if (!details.length) {
    return { labels: [], dataByModel: new Map(), hasData };
  }

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return;
    }
    const dayLabel = formatDayLabel(new Date(timestamp));
    if (!dayLabel) {
      return;
    }

    const modelName = detail.__modelName || 'Unknown';
    if (!valuesByModel.has(modelName)) {
      valuesByModel.set(modelName, new Map());
    }
    const modelDayMap = valuesByModel.get(modelName)!;
    const increment = metric === 'tokens' ? extractTotalTokens(detail) : 1;
    modelDayMap.set(dayLabel, (modelDayMap.get(dayLabel) || 0) + increment);
    labelsSet.add(dayLabel);
    hasData = true;
  });

  const labels = Array.from(labelsSet).sort();
  const dataByModel = new Map<string, number[]>();
  valuesByModel.forEach((dayMap, modelName) => {
    const series = labels.map((label) => dayMap.get(label) || 0);
    dataByModel.set(modelName, series);
  });

  return { labels, dataByModel, hasData };
}

export interface ChartDataset {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor:
    | string
    | CanvasGradient
    | ((context: ScriptableContext<'line'>) => string | CanvasGradient);
  pointBackgroundColor?: string;
  pointBorderColor?: string;
  fill: boolean;
  tension: number;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

const CHART_COLORS = [
  { borderColor: '#8b8680', backgroundColor: 'rgba(139, 134, 128, 0.15)' },
  { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.15)' },
  { borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  { borderColor: '#c65746', backgroundColor: 'rgba(198, 87, 70, 0.15)' },
  { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.15)' },
  { borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.15)' },
  { borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.15)' },
  { borderColor: '#84cc16', backgroundColor: 'rgba(132, 204, 22, 0.15)' },
  { borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.15)' },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.trim().replace('#', '');
  if (normalized.length !== 6) {
    return null;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) {
    return null;
  }
  return { r, g, b };
};

const withAlpha = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }
  const clamped = clamp(alpha, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
};

const buildAreaGradient = (
  context: ScriptableContext<'line'>,
  baseHex: string,
  fallback: string
) => {
  const chart = context.chart;
  const ctx = chart.ctx;
  const area = chart.chartArea;

  if (!area) {
    return fallback;
  }

  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, withAlpha(baseHex, 0.28));
  gradient.addColorStop(0.6, withAlpha(baseHex, 0.12));
  gradient.addColorStop(1, withAlpha(baseHex, 0.02));
  return gradient;
};

/**
 * 构建图表数据
 */
export function buildChartData(
  usageData: unknown,
  period: 'hour' | 'day' = 'day',
  metric: 'requests' | 'tokens' = 'requests',
  selectedModels: string[] = [],
  options: { hourWindowHours?: number } = {}
): ChartData {
  const baseSeries =
    period === 'hour'
      ? buildHourlySeriesByModel(usageData, metric, options.hourWindowHours)
      : buildDailySeriesByModel(usageData, metric);

  const { labels, dataByModel } = baseSeries;

  // Build "All" series as sum of all models
  const getAllSeries = (): number[] => {
    const summed = new Array(labels.length).fill(0);
    dataByModel.forEach((values) => {
      values.forEach((value, idx) => {
        summed[idx] = (summed[idx] || 0) + value;
      });
    });
    return summed;
  };

  // Determine which models to show
  const modelsToShow = selectedModels.length > 0 ? selectedModels : ['all'];

  const datasets: ChartDataset[] = modelsToShow.map((model, index) => {
    const isAll = model === 'all';
    const data = isAll
      ? getAllSeries()
      : dataByModel.get(model) || new Array(labels.length).fill(0);
    const colorIndex = index % CHART_COLORS.length;
    const style = CHART_COLORS[colorIndex];
    const shouldFill = modelsToShow.length === 1 || (isAll && modelsToShow.length > 1);

    return {
      label: isAll ? 'All Models' : model,
      data,
      borderColor: style.borderColor,
      backgroundColor: shouldFill
        ? (ctx) => buildAreaGradient(ctx, style.borderColor, style.backgroundColor)
        : style.backgroundColor,
      pointBackgroundColor: style.borderColor,
      pointBorderColor: style.borderColor,
      fill: shouldFill,
      tension: 0.35,
    };
  });

  return { labels, datasets };
}

/**
 * 依据 usage 数据计算密钥使用统计
 */
/**
 * 状态栏单个格子的状态
 */
export type StatusBlockState = 'success' | 'failure' | 'mixed' | 'idle';

/**
 * 状态栏单个格子的详细信息
 */
export interface StatusBlockDetail {
  success: number;
  failure: number;
  /** 该格子的成功率 (0–1)，无请求时为 -1 */
  rate: number;
  /** 格子起始时间戳 (ms) */
  startTime: number;
  /** 格子结束时间戳 (ms) */
  endTime: number;
}

/**
 * 状态栏数据
 */
export interface StatusBarData {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number;
  totalSuccess: number;
  totalFailure: number;
}

/**
 * 计算状态栏数据（最近200分钟，分为20个10分钟的时间块）
 * 每个时间块代表窗口内的一个等长区间，用于展示成功/失败趋势
 */
export function calculateStatusBarData(
  usageDetails: UsageDetail[],
  sourceFilter?: string,
  authIndexFilter?: string | number
): StatusBarData {
  const BLOCK_COUNT = 20;
  const BLOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes
  const WINDOW_MS = BLOCK_COUNT * BLOCK_DURATION_MS; // 200 minutes

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Initialize blocks
  const blockStats: Array<{ success: number; failure: number }> = Array.from(
    { length: BLOCK_COUNT },
    () => ({ success: 0, failure: 0 })
  );

  let totalSuccess = 0;
  let totalFailure = 0;

  // Filter and bucket the usage details
  usageDetails.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      timestamp < windowStart ||
      timestamp > now
    ) {
      return;
    }

    // Apply filters if provided
    if (sourceFilter !== undefined && detail.source !== sourceFilter) {
      return;
    }
    if (authIndexFilter !== undefined && detail.auth_index !== authIndexFilter) {
      return;
    }

    // Calculate which block this falls into (0 = oldest, 19 = newest)
    const ageMs = now - timestamp;
    const blockIndex = BLOCK_COUNT - 1 - Math.floor(ageMs / BLOCK_DURATION_MS);

    if (blockIndex >= 0 && blockIndex < BLOCK_COUNT) {
      if (detail.failed) {
        blockStats[blockIndex].failure += 1;
        totalFailure += 1;
      } else {
        blockStats[blockIndex].success += 1;
        totalSuccess += 1;
      }
    }
  });

  // Convert stats to block states and build details
  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBlockDetail[] = [];

  blockStats.forEach((stat, idx) => {
    const total = stat.success + stat.failure;
    if (total === 0) {
      blocks.push('idle');
    } else if (stat.failure === 0) {
      blocks.push('success');
    } else if (stat.success === 0) {
      blocks.push('failure');
    } else {
      blocks.push('mixed');
    }

    const blockStartTime = windowStart + idx * BLOCK_DURATION_MS;
    blockDetails.push({
      success: stat.success,
      failure: stat.failure,
      rate: total > 0 ? stat.success / total : -1,
      startTime: blockStartTime,
      endTime: blockStartTime + BLOCK_DURATION_MS,
    });
  });

  // Calculate success rate
  const total = totalSuccess + totalFailure;
  const successRate = total > 0 ? (totalSuccess / total) * 100 : 100;

  return {
    blocks,
    blockDetails,
    successRate,
    totalSuccess,
    totalFailure,
  };
}

/**
 * 服务健康监测数据（最近168小时/7天，7×96网格）
 * 每个格子代表15分钟的健康度
 */
export interface ServiceHealthData {
  blocks: StatusBlockState[];
  blockDetails: StatusBlockDetail[];
  successRate: number;
  totalSuccess: number;
  totalFailure: number;
  rows: number;
  cols: number;
}

export function calculateServiceHealthData(usageDetails: UsageDetail[]): ServiceHealthData {
  const ROWS = 7;
  const COLS = 96;
  const BLOCK_COUNT = ROWS * COLS; // 672
  const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  const WINDOW_MS = BLOCK_COUNT * BLOCK_DURATION_MS; // 168 hours (7 days)

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const blockStats: Array<{ success: number; failure: number }> = Array.from(
    { length: BLOCK_COUNT },
    () => ({ success: 0, failure: 0 })
  );

  let totalSuccess = 0;
  let totalFailure = 0;

  usageDetails.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      timestamp < windowStart ||
      timestamp > now
    ) {
      return;
    }

    const ageMs = now - timestamp;
    const blockIndex = BLOCK_COUNT - 1 - Math.floor(ageMs / BLOCK_DURATION_MS);

    if (blockIndex >= 0 && blockIndex < BLOCK_COUNT) {
      if (detail.failed) {
        blockStats[blockIndex].failure += 1;
        totalFailure += 1;
      } else {
        blockStats[blockIndex].success += 1;
        totalSuccess += 1;
      }
    }
  });

  const blocks: StatusBlockState[] = [];
  const blockDetails: StatusBlockDetail[] = [];

  blockStats.forEach((stat, idx) => {
    const total = stat.success + stat.failure;
    if (total === 0) {
      blocks.push('idle');
    } else if (stat.failure === 0) {
      blocks.push('success');
    } else if (stat.success === 0) {
      blocks.push('failure');
    } else {
      blocks.push('mixed');
    }

    const blockStartTime = windowStart + idx * BLOCK_DURATION_MS;
    blockDetails.push({
      success: stat.success,
      failure: stat.failure,
      rate: total > 0 ? stat.success / total : -1,
      startTime: blockStartTime,
      endTime: blockStartTime + BLOCK_DURATION_MS,
    });
  });

  const total = totalSuccess + totalFailure;
  const successRate = total > 0 ? (totalSuccess / total) * 100 : 100;

  return {
    blocks,
    blockDetails,
    successRate,
    totalSuccess,
    totalFailure,
    rows: ROWS,
    cols: COLS,
  };
}

export function computeKeyStats(
  usageData: unknown,
  masker: (val: string) => string = maskApiKey
): KeyStats {
  const apis = getApisRecord(usageData);
  if (!apis) {
    return { bySource: {}, byAuthIndex: {} };
  }

  const sourceStats: Record<string, KeyStatBucket> = {};
  const authIndexStats: Record<string, KeyStatBucket> = {};

  const ensureBucket = (bucket: Record<string, KeyStatBucket>, key: string) => {
    if (!bucket[key]) {
      bucket[key] = { success: 0, failure: 0 };
    }
    return bucket[key];
  };

  Object.values(apis).forEach((apiEntry) => {
    if (!isRecord(apiEntry)) return;
    const modelsRaw = apiEntry.models;
    const models = isRecord(modelsRaw) ? modelsRaw : null;
    if (!models) return;

    Object.values(models).forEach((modelEntry) => {
      if (!isRecord(modelEntry)) return;
      const details = Array.isArray(modelEntry.details) ? modelEntry.details : [];

      details.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        const source = normalizeUsageSourceId(detailRecord?.source, masker);
        const authIndexKey = normalizeAuthIndex(detailRecord?.auth_index);
        const isFailed = detailRecord?.failed === true;

        if (source) {
          const bucket = ensureBucket(sourceStats, source);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }

        if (authIndexKey) {
          const bucket = ensureBucket(authIndexStats, authIndexKey);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }
      });
    });
  });

  return {
    bySource: sourceStats,
    byAuthIndex: authIndexStats,
  };
}

export function computeKeyStatsFromDetails(usageDetails: UsageDetail[]): KeyStats {
  const bySource: Record<string, KeyStatBucket> = {};
  const byAuthIndex: Record<string, KeyStatBucket> = {};

  const ensureBucket = (bucket: Record<string, KeyStatBucket>, key: string) => {
    if (!bucket[key]) {
      bucket[key] = { success: 0, failure: 0 };
    }
    return bucket[key];
  };

  usageDetails.forEach((detail) => {
    const source = detail.source;
    const authIndexKey = normalizeAuthIndex(detail.auth_index);
    const isFailed = detail.failed === true;

    if (source) {
      const bucket = ensureBucket(bySource, source);
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
    }

    if (authIndexKey) {
      const bucket = ensureBucket(byAuthIndex, authIndexKey);
      if (isFailed) {
        bucket.failure += 1;
      } else {
        bucket.success += 1;
      }
    }
  });

  return { bySource, byAuthIndex };
}

export type TokenCategory = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning';

export interface TokenBreakdownSeries {
  labels: string[];
  dataByCategory: Record<TokenCategory, number[]>;
  hasData: boolean;
}

/**
 * 按 token 类别构建小时级别的堆叠序列
 */
export function buildHourlyTokenBreakdown(
  usageData: unknown,
  hourWindow: number = 24
): TokenBreakdownSeries {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindow) && hourWindow > 0
      ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
      : 24;
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const earliestBucket = new Date(currentHour);
  earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliestBucket.getTime();

  const labels: string[] = [];
  for (let i = 0; i < resolvedHourWindow; i++) {
    labels.push(formatHourLabel(new Date(earliestTime + i * hourMs)));
  }

  const dataByCategory: Record<TokenCategory, number[]> = {
    input: new Array(labels.length).fill(0),
    output: new Array(labels.length).fill(0),
    cacheRead: new Array(labels.length).fill(0),
    cacheWrite: new Array(labels.length).fill(0),
    reasoning: new Array(labels.length).fill(0),
  };

  const details = collectUsageDetails(usageData);
  let hasData = false;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const normalized = new Date(timestamp);
    normalized.setMinutes(0, 0, 0);
    const bucketStart = normalized.getTime();
    const lastBucketTime = earliestTime + (labels.length - 1) * hourMs;
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) return;
    const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
    if (bucketIndex < 0 || bucketIndex >= labels.length) return;

    const tokens = detail.tokens;
    const input = typeof tokens.input_tokens === 'number' ? Math.max(tokens.input_tokens, 0) : 0;
    const output = typeof tokens.output_tokens === 'number' ? Math.max(tokens.output_tokens, 0) : 0;
    const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(tokens);
    const reasoning =
      typeof tokens.reasoning_tokens === 'number' ? Math.max(tokens.reasoning_tokens, 0) : 0;

    dataByCategory.input[bucketIndex] += input;
    dataByCategory.output[bucketIndex] += output;
    dataByCategory.cacheRead[bucketIndex] += cacheReadTokens;
    dataByCategory.cacheWrite[bucketIndex] += cacheWriteTokens;
    dataByCategory.reasoning[bucketIndex] += reasoning;
    hasData = true;
  });

  return { labels, dataByCategory, hasData };
}

/**
 * 按 token 类别构建日级别的堆叠序列
 */
export function buildDailyTokenBreakdown(usageData: unknown): TokenBreakdownSeries {
  const details = collectUsageDetails(usageData);
  const dayMap: Record<string, Record<TokenCategory, number>> = {};
  let hasData = false;

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const dayLabel = formatDayLabel(new Date(timestamp));
    if (!dayLabel) return;

    if (!dayMap[dayLabel]) {
      dayMap[dayLabel] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    }

    const tokens = detail.tokens;
    const input = typeof tokens.input_tokens === 'number' ? Math.max(tokens.input_tokens, 0) : 0;
    const output = typeof tokens.output_tokens === 'number' ? Math.max(tokens.output_tokens, 0) : 0;
    const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(tokens);
    const reasoning =
      typeof tokens.reasoning_tokens === 'number' ? Math.max(tokens.reasoning_tokens, 0) : 0;

    dayMap[dayLabel].input += input;
    dayMap[dayLabel].output += output;
    dayMap[dayLabel].cacheRead += cacheReadTokens;
    dayMap[dayLabel].cacheWrite += cacheWriteTokens;
    dayMap[dayLabel].reasoning += reasoning;
    hasData = true;
  });

  const labels = Object.keys(dayMap).sort();
  const dataByCategory: Record<TokenCategory, number[]> = {
    input: labels.map((l) => dayMap[l].input),
    output: labels.map((l) => dayMap[l].output),
    cacheRead: labels.map((l) => dayMap[l].cacheRead),
    cacheWrite: labels.map((l) => dayMap[l].cacheWrite),
    reasoning: labels.map((l) => dayMap[l].reasoning),
  };

  return { labels, dataByCategory, hasData };
}

export interface CostSeries {
  labels: string[];
  data: number[];
  hasData: boolean;
  pricingCoverage: PricingCoverage;
}

/**
 * 按小时构建费用时间序列
 */
export function buildHourlyCostSeries(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3(),
  hourWindow: number = 24
): CostSeries {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindow) && hourWindow > 0
      ? Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31)
      : 24;
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const earliestBucket = new Date(currentHour);
  earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliestBucket.getTime();

  const labels: string[] = [];
  for (let i = 0; i < resolvedHourWindow; i++) {
    labels.push(formatHourLabel(new Date(earliestTime + i * hourMs)));
  }

  const data = new Array(labels.length).fill(0);
  const details = collectUsageDetails(usageData);
  const pricingInputs: PricingCoverageInput[] = [];

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const normalized = new Date(timestamp);
    normalized.setMinutes(0, 0, 0);
    const bucketStart = normalized.getTime();
    const lastBucketTime = earliestTime + (labels.length - 1) * hourMs;
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) return;
    const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
    if (bucketIndex < 0 || bucketIndex >= labels.length) return;

    const pricingInput = estimateUsageDetailCost(detail, priceProfile);
    pricingInputs.push(pricingInput);
    data[bucketIndex] += pricedAmountOrZero(pricingInput.estimate);
  });

  const pricingCoverage = aggregateCostEstimateCoverage(pricingInputs);
  return { labels, data, hasData: pricingCoverage.pricedRequests > 0, pricingCoverage };
}

/**
 * 按天构建费用时间序列
 */
export function buildDailyCostSeries(
  usageData: unknown,
  priceProfile: PriceProfileV3 = createDefaultPriceProfileV3()
): CostSeries {
  const details = collectUsageDetails(usageData);
  const dayMap: Record<string, number> = {};
  const pricingInputs: PricingCoverageInput[] = [];

  details.forEach((detail) => {
    const timestamp =
      typeof detail.__timestampMs === 'number'
        ? detail.__timestampMs
        : parseTimestampMs(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    const dayLabel = formatDayLabel(new Date(timestamp));
    if (!dayLabel) return;

    const pricingInput = estimateUsageDetailCost(detail, priceProfile);
    pricingInputs.push(pricingInput);
    dayMap[dayLabel] = (dayMap[dayLabel] || 0) + pricedAmountOrZero(pricingInput.estimate);
  });

  const labels = Object.keys(dayMap).sort();
  const data = labels.map((l) => dayMap[l]);

  const pricingCoverage = aggregateCostEstimateCoverage(pricingInputs);
  return { labels, data, hasData: pricingCoverage.pricedRequests > 0, pricingCoverage };
}
