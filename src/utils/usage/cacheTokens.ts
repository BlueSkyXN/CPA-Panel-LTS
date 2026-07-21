export interface UsageTokenFields {
  input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_tokens?: unknown;
  cached_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_creation_tokens?: unknown;
  total_tokens?: unknown;
  [key: string]: unknown;
}

export interface UsageCacheTokenCounts {
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface UsageCostTokenSplit extends UsageCacheTokenCounts {
  inputTokens: number;
  outputTokens: number;
  promptTokens: number;
}

export interface UsagePriceFields {
  prompt: number;
  completion: number;
  cache: number;
  cacheWrite?: number;
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toOptionalTokenCount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
};

// This cache-rate complement is distinct from normal prompt input: cache
// creation remains a separate billing category.
export function getUsageNonCacheReadInputTokenCount(tokens: unknown): number {
  const record = isRecord(tokens) ? tokens : {};
  const inputTokens = toTokenCount(record.input_tokens);
  const { cacheReadTokens } = getUsageCacheTokenCounts(record);
  return Math.max(inputTokens - cacheReadTokens, 0);
}

export const toTokenCount = (value: unknown): number => toOptionalTokenCount(value) ?? 0;

export function getUsageCacheTokenCounts(tokens: unknown): UsageCacheTokenCounts {
  const record = isRecord(tokens) ? tokens : {};
  const explicitRead = toOptionalTokenCount(record.cache_read_tokens);
  const cachedTokensMirror = toOptionalTokenCount(record.cached_tokens);

  return {
    cacheReadTokens: explicitRead ?? cachedTokensMirror ?? 0,
    cacheWriteTokens: toOptionalTokenCount(record.cache_creation_tokens) ?? 0,
  };
}

export function splitUsageTokensForCost(
  tokens: UsageTokenFields,
  _modelName: string
): UsageCostTokenSplit {
  const inputTokens = toTokenCount(tokens.input_tokens);
  const outputTokens = toTokenCount(tokens.output_tokens);
  const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(tokens);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    promptTokens: Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0),
  };
}

export function calculateFallbackUsageTotalTokens(
  tokens: UsageTokenFields,
  _modelName: string
): number {
  const inputTokens = toTokenCount(tokens.input_tokens);
  const outputTokens = toTokenCount(tokens.output_tokens);
  const reasoningTokens = toTokenCount(tokens.reasoning_tokens);

  // input_tokens is already normalized to include cache reads and writes.
  return inputTokens + outputTokens + reasoningTokens;
}

export function resolveUsageTotalTokens(tokens: UsageTokenFields, modelName: string): number {
  const explicitTotal = toOptionalTokenCount(tokens.total_tokens);
  return explicitTotal ?? calculateFallbackUsageTotalTokens(tokens, modelName);
}

export function resolveCacheWriteUnitPrice(
  _modelName: string,
  promptUnitPrice: number,
  _cacheReadUnitPrice: number,
  configuredCacheWriteUnitPrice?: number
): number {
  if (
    typeof configuredCacheWriteUnitPrice === 'number' &&
    Number.isFinite(configuredCacheWriteUnitPrice) &&
    configuredCacheWriteUnitPrice >= 0
  ) {
    return configuredCacheWriteUnitPrice;
  }

  return Number.isFinite(promptUnitPrice) ? Math.max(promptUnitPrice, 0) : 0;
}

export function calculateUsageCost(
  tokens: UsageTokenFields,
  modelName: string,
  price: UsagePriceFields
): number {
  const split = splitUsageTokensForCost(tokens, modelName);
  const promptUnitPrice = Number.isFinite(price.prompt) ? Math.max(price.prompt, 0) : 0;
  const completionUnitPrice = Number.isFinite(price.completion) ? Math.max(price.completion, 0) : 0;
  const cacheReadUnitPrice = Number.isFinite(price.cache) ? Math.max(price.cache, 0) : 0;
  const cacheWriteUnitPrice = resolveCacheWriteUnitPrice(
    modelName,
    promptUnitPrice,
    cacheReadUnitPrice,
    price.cacheWrite
  );

  const total =
    (split.promptTokens / TOKENS_PER_PRICE_UNIT) * promptUnitPrice +
    (split.cacheReadTokens / TOKENS_PER_PRICE_UNIT) * cacheReadUnitPrice +
    (split.cacheWriteTokens / TOKENS_PER_PRICE_UNIT) * cacheWriteUnitPrice +
    (split.outputTokens / TOKENS_PER_PRICE_UNIT) * completionUnitPrice;

  return Number.isFinite(total) && total > 0 ? total : 0;
}
