export interface UsageTokenFields {
  input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_tokens?: unknown;
  cached_tokens?: unknown;
  cache_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_creation_tokens?: unknown;
  cache_write_tokens?: unknown;
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

const GPT_56_MODEL_PATTERN = /(?:^|[/:])gpt-5\.6(?:$|[-_.:/])/;
const GPT_56_CODEX_ALIASES = new Set(['sol', 'terra', 'luna']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toOptionalTokenCount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
};

export const toTokenCount = (value: unknown): number => toOptionalTokenCount(value) ?? 0;

export function getUsageCacheTokenCounts(tokens: unknown): UsageCacheTokenCounts {
  const record = isRecord(tokens) ? tokens : {};
  const explicitRead = toOptionalTokenCount(record.cache_read_tokens);
  const legacyReadCandidates = [record.cached_tokens, record.cache_tokens]
    .map(toOptionalTokenCount)
    .filter((value): value is number => value !== null);
  const legacyRead = legacyReadCandidates.length > 0 ? Math.max(...legacyReadCandidates) : 0;

  const explicitWrite = toOptionalTokenCount(record.cache_creation_tokens);
  const writeAlias = toOptionalTokenCount(record.cache_write_tokens);

  return {
    cacheReadTokens: explicitRead ?? legacyRead,
    cacheWriteTokens: explicitWrite ?? writeAlias ?? 0,
  };
}

export function isGpt56CacheWriteModel(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  if (!normalized) return false;
  if (GPT_56_MODEL_PATTERN.test(normalized)) return true;

  const modelSegments = normalized.split(/[/:]/).filter(Boolean);
  return modelSegments.some((segment) => GPT_56_CODEX_ALIASES.has(segment));
}

export function splitUsageTokensForCost(
  tokens: UsageTokenFields,
  modelName: string
): UsageCostTokenSplit {
  const inputTokens = toTokenCount(tokens.input_tokens);
  const outputTokens = toTokenCount(tokens.output_tokens);
  const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(tokens);
  const promptDiscountTokens =
    cacheReadTokens + (isGpt56CacheWriteModel(modelName) ? cacheWriteTokens : 0);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    promptTokens: Math.max(inputTokens - promptDiscountTokens, 0),
  };
}

export function calculateFallbackUsageTotalTokens(
  tokens: UsageTokenFields,
  modelName: string
): number {
  const inputTokens = toTokenCount(tokens.input_tokens);
  const outputTokens = toTokenCount(tokens.output_tokens);
  const reasoningTokens = toTokenCount(tokens.reasoning_tokens);
  const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(tokens);
  const cacheTokens = isGpt56CacheWriteModel(modelName) ? 0 : cacheReadTokens + cacheWriteTokens;

  return inputTokens + outputTokens + reasoningTokens + cacheTokens;
}

export function resolveCacheWriteUnitPrice(
  modelName: string,
  promptUnitPrice: number,
  cacheReadUnitPrice: number,
  configuredCacheWriteUnitPrice?: number
): number {
  if (
    typeof configuredCacheWriteUnitPrice === 'number' &&
    Number.isFinite(configuredCacheWriteUnitPrice) &&
    configuredCacheWriteUnitPrice >= 0
  ) {
    return configuredCacheWriteUnitPrice;
  }

  const prompt = Number.isFinite(promptUnitPrice) ? Math.max(promptUnitPrice, 0) : 0;
  if (isGpt56CacheWriteModel(modelName)) {
    return prompt * 1.25;
  }

  return Number.isFinite(cacheReadUnitPrice) ? Math.max(cacheReadUnitPrice, 0) : 0;
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
