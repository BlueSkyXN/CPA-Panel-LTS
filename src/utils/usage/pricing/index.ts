import {
  resolveCacheWriteUnitPrice,
  splitUsageTokensForCost,
  type UsageCostTokenSplit,
  type UsageTokenFields,
} from '../cacheTokens';
import { normalizePersistedModelPrices } from '../modelPrices';
import type { ResolvedServiceTier } from '../serviceTier';

/** Pure, storage-free pricing v3 contract. All rates are USD per one million tokens. */
export const PRICE_PROFILE_SCHEMA_VERSION = 3 as const;
export const PRICE_PROFILE_V3 = PRICE_PROFILE_SCHEMA_VERSION;
export const PRICE_CURRENCY = 'USD' as const;
export const OPENAI_CATALOG_AS_OF = '2026-07-19';
export const OPENAI_CATALOG_VERSION = `openai-${OPENAI_CATALOG_AS_OF}`;
export const OPENAI_PRICING_SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
export const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;
export const TOKENS_PER_MILLION = 1_000_000;

/** Import ceilings prevent corrupt or nonsensical user profiles from becoming trusted. */
export const MAX_RATE_PER_MILLION = 1_000_000;
export const MAX_FAST_MULTIPLIER = 1_000;
export const MAX_LONG_CONTEXT_THRESHOLD = 10_000_000;

export interface TokenRates {
  input: number;
  cachedInput: number;
  /** Omitted means legacy Auto: use the input rate. Explicit 0 is free. */
  cacheWrite?: number;
  output: number;
}

export interface LongContextPricing {
  thresholdTokens: number;
  basis: 'inputTokens';
  appliesTo: 'entireRequest';
  rates: TokenRates;
}

export interface StandardPricing {
  short: TokenRates;
  long?: LongContextPricing;
}

/** Catalog Fast/Priority card. Priority long context is explicitly unsupported. */
export interface FastPricing {
  short: TokenRates;
  longSupported: boolean;
}

/** Editable custom Fast card. It must select one pricing strategy. */
export type FastOverride =
  | { short: TokenRates; multiplier?: never; longSupported: boolean }
  | { short?: never; multiplier: number; longSupported: boolean };

export interface PriceCatalogEntry {
  canonicalModel: string;
  aliases: readonly string[];
  currency: typeof PRICE_CURRENCY;
  standard: StandardPricing;
  fast?: FastPricing;
  sourceUrl: string;
  asOf: string;
}

export interface PriceOverride {
  standard: StandardPricing;
  fast?: FastOverride;
}

export interface PriceProfileAssumptions {
  historicalPricing: 'current';
  unknownServiceTier: 'standard';
}

/** A profile holds only user intent; immutable preset catalog cards stay external. */
export interface PriceProfileV3 {
  schemaVersion: typeof PRICE_PROFILE_SCHEMA_VERSION;
  currency: typeof PRICE_CURRENCY;
  assumptions: PriceProfileAssumptions;
  aliases: Record<string, string>;
  overrides: Record<string, PriceOverride>;
}

export type CostEstimateStatus = 'priced' | 'unmatched' | 'unsupported';
export type CostEstimateWarning = 'fallbackStandard' | 'requestedEstimate' | 'assumedStandard';
export type ModelMatch = 'custom' | 'preset' | 'alias' | 'none';
export type ContextBand = 'short' | 'long';

export interface CostEstimate {
  amount: number | null;
  status: CostEstimateStatus;
  modelMatch: ModelMatch;
  tier: ResolvedServiceTier;
  contextBand: ContextBand;
  rates: TokenRates | null;
  warnings: CostEstimateWarning[];
  modelName: string;
  resolvedModel: string | null;
  tokenSplit: UsageCostTokenSplit;
}

export interface ResolvedPrice {
  modelName: string;
  resolvedModel: string | null;
  modelMatch: ModelMatch;
  standard: StandardPricing | null;
  fast: FastPricing | FastOverride | null;
  usesCustomOverride: boolean;
}

export interface PriceProfileNormalization {
  profile: PriceProfileV3;
  warnings: string[];
}

export interface PriceProfileImportPreflight extends PriceProfileNormalization {
  valid: boolean;
  errors: string[];
}

export interface PricingCoverageInput {
  modelName: string;
  tokenCount: number;
  estimate: CostEstimate;
}

export interface PricingCoverage {
  totalRequests: number;
  pricedRequests: number;
  unmatchedRequests: number;
  unsupportedRequests: number;
  totalTokens: number;
  pricedTokens: number;
  totalModels: number;
  pricedModels: number;
  estimatedAmount: number;
  assumedTierRequests: number;
  pricedRequestRatio: number;
  pricedTokenRatio: number;
  pricedModelRatio: number;
}

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (record: RecordValue, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const normalizeModelKey = (value: string): string => value.trim().toLowerCase();

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isFiniteWithin = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

const parseTokenRates = (value: unknown): TokenRates | null => {
  if (!isRecord(value)) return null;
  if (
    !isFiniteWithin(value.input, MAX_RATE_PER_MILLION) ||
    !isFiniteWithin(value.cachedInput, MAX_RATE_PER_MILLION) ||
    !isFiniteWithin(value.output, MAX_RATE_PER_MILLION)
  ) {
    return null;
  }
  if (hasOwn(value, 'cacheWrite') && !isFiniteWithin(value.cacheWrite, MAX_RATE_PER_MILLION)) {
    return null;
  }
  return {
    input: value.input,
    cachedInput: value.cachedInput,
    ...(hasOwn(value, 'cacheWrite') ? { cacheWrite: value.cacheWrite as number } : {}),
    output: value.output,
  };
};

const parseLongContextPricing = (value: unknown): LongContextPricing | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.thresholdTokens !== 'number' ||
    !Number.isSafeInteger(value.thresholdTokens) ||
    value.thresholdTokens <= 0 ||
    value.thresholdTokens > MAX_LONG_CONTEXT_THRESHOLD ||
    value.basis !== 'inputTokens' ||
    value.appliesTo !== 'entireRequest'
  ) {
    return null;
  }
  const rates = parseTokenRates(value.rates);
  return rates === null
    ? null
    : {
        thresholdTokens: value.thresholdTokens,
        basis: 'inputTokens',
        appliesTo: 'entireRequest',
        rates,
      };
};

const parseStandardPricing = (value: unknown): StandardPricing | null => {
  if (!isRecord(value)) return null;
  const short = parseTokenRates(value.short);
  const long = hasOwn(value, 'long') ? parseLongContextPricing(value.long) : undefined;
  if (short === null || (hasOwn(value, 'long') && long === null)) return null;
  return { short, ...(long === undefined || long === null ? {} : { long }) };
};

const parseFastOverride = (value: unknown): FastOverride | null => {
  if (!isRecord(value) || typeof value.longSupported !== 'boolean') return null;
  const hasShort = hasOwn(value, 'short');
  const hasMultiplier = hasOwn(value, 'multiplier');
  if (hasShort === hasMultiplier) return null;
  if (hasShort) {
    const short = parseTokenRates(value.short);
    return short === null ? null : { short, longSupported: value.longSupported };
  }
  if (
    typeof value.multiplier !== 'number' ||
    !Number.isFinite(value.multiplier) ||
    value.multiplier <= 0 ||
    value.multiplier > MAX_FAST_MULTIPLIER
  ) {
    return null;
  }
  return { multiplier: value.multiplier, longSupported: value.longSupported };
};

const parsePriceOverride = (value: unknown): PriceOverride | null => {
  if (!isRecord(value)) return null;
  const standard = parseStandardPricing(value.standard);
  const fast = hasOwn(value, 'fast') ? parseFastOverride(value.fast) : undefined;
  if (standard === null || (hasOwn(value, 'fast') && fast === null)) return null;
  return { standard, ...(fast === undefined || fast === null ? {} : { fast }) };
};

const cloneRates = (rates: TokenRates): TokenRates => ({ ...rates });

const multiplyRates = (rates: TokenRates, multiplier: number): TokenRates => ({
  input: rates.input * multiplier,
  cachedInput: rates.cachedInput * multiplier,
  ...(rates.cacheWrite === undefined ? {} : { cacheWrite: rates.cacheWrite * multiplier }),
  output: rates.output * multiplier,
});

const rateCard = (
  input: number,
  cachedInput: number,
  cacheWrite: number | undefined,
  output: number
): TokenRates => ({
  input,
  cachedInput,
  ...(cacheWrite === undefined ? {} : { cacheWrite }),
  output,
});

const longCard = (rates: TokenRates): LongContextPricing => ({
  thresholdTokens: LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
  basis: 'inputTokens',
  appliesTo: 'entireRequest',
  rates,
});

/** Official OpenAI rate cards confirmed on 2026-07-19. */
export const OPENAI_PRICE_CATALOG: readonly PriceCatalogEntry[] = [
  {
    canonicalModel: 'gpt-5.6-sol',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 30), long: longCard(rateCard(10, 1, 12.5, 45)) },
    fast: { short: rateCard(10, 1, 12.5, 60), longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.6-terra',
    aliases: [],
    currency: 'USD',
    standard: {
      short: rateCard(2.5, 0.25, 3.125, 15),
      long: longCard(rateCard(5, 0.5, 6.25, 22.5)),
    },
    fast: { short: rateCard(5, 0.5, 6.25, 30), longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.6-luna',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(1, 0.1, 1.25, 6), long: longCard(rateCard(2, 0.2, 2.5, 9)) },
    fast: { short: rateCard(2, 0.2, 2.5, 12), longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.5',
    aliases: [],
    currency: 'USD',
    standard: {
      short: rateCard(5, 0.5, undefined, 30),
      long: longCard(rateCard(10, 1, undefined, 45)),
    },
    fast: { short: rateCard(12.5, 1.25, undefined, 75), longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.4',
    aliases: [],
    currency: 'USD',
    standard: {
      short: rateCard(2.5, 0.25, undefined, 15),
      long: longCard(rateCard(5, 0.5, undefined, 22.5)),
    },
    fast: { short: rateCard(5, 0.5, undefined, 30), longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.4-mini',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(0.75, 0.075, undefined, 4.5) },
    fast: { short: rateCard(1.5, 0.15, undefined, 9), longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
];

const CATALOG_CANONICAL = new Map(
  OPENAI_PRICE_CATALOG.map((entry) => [normalizeModelKey(entry.canonicalModel), entry])
);
const CATALOG_ALIASES = new Map(
  OPENAI_PRICE_CATALOG.flatMap((entry) =>
    entry.aliases.map((alias) => [normalizeModelKey(alias), entry] as const)
  )
);

export function createDefaultPriceProfileV3(): PriceProfileV3 {
  return {
    schemaVersion: PRICE_PROFILE_SCHEMA_VERSION,
    currency: PRICE_CURRENCY,
    assumptions: { historicalPricing: 'current', unknownServiceTier: 'standard' },
    aliases: {},
    overrides: {},
  };
}

export function findCatalogEntry(modelName: string): PriceCatalogEntry | null {
  const key = normalizeModelKey(modelName);
  return CATALOG_CANONICAL.get(key) ?? CATALOG_ALIASES.get(key) ?? null;
}

const isKnownAliasTarget = (target: string, overrides: Record<string, PriceOverride>): boolean => {
  const key = normalizeModelKey(target);
  return overrides[key] !== undefined || CATALOG_CANONICAL.has(key) || CATALOG_ALIASES.has(key);
};

export function normalizePriceProfileV3(value: unknown): PriceProfileNormalization {
  const fallback = createDefaultPriceProfileV3();
  if (!isRecord(value)) return { profile: fallback, warnings: ['profile-not-object'] };

  const warnings: string[] = [];
  const aliases: Record<string, string> = {};
  const overrides: Record<string, PriceOverride> = {};

  if (isRecord(value.overrides)) {
    Object.entries(value.overrides).forEach(([modelName, raw]) => {
      const key = normalizeModelKey(modelName);
      const override = parsePriceOverride(raw);
      if (!key || override === null) warnings.push(`override-invalid:${modelName}`);
      else if (overrides[key] !== undefined) warnings.push(`override-conflict:${modelName}`);
      else overrides[key] = override;
    });
  } else {
    warnings.push('overrides-invalid');
  }

  if (isRecord(value.aliases)) {
    Object.entries(value.aliases).forEach(([aliasName, target]) => {
      const key = normalizeModelKey(aliasName);
      if (!key || !isNonEmptyString(target)) warnings.push(`alias-invalid:${aliasName}`);
      else if (aliases[key] !== undefined) warnings.push(`alias-conflict:${aliasName}`);
      else aliases[key] = target.trim();
    });
  } else {
    warnings.push('aliases-invalid');
  }

  if (value.schemaVersion !== PRICE_PROFILE_SCHEMA_VERSION) warnings.push('schema-version-invalid');
  if (value.currency !== PRICE_CURRENCY) warnings.push('currency-invalid');
  if (!isRecord(value.assumptions)) warnings.push('assumptions-invalid');
  else {
    if (value.assumptions.historicalPricing !== 'current')
      warnings.push('historical-pricing-invalid');
    if (value.assumptions.unknownServiceTier !== 'standard') warnings.push('unknown-tier-invalid');
  }

  return {
    profile: {
      schemaVersion: PRICE_PROFILE_SCHEMA_VERSION,
      currency: PRICE_CURRENCY,
      assumptions: { historicalPricing: 'current', unknownServiceTier: 'standard' },
      aliases,
      overrides,
    },
    warnings,
  };
}

export function preflightPriceProfileImportV3(value: unknown): PriceProfileImportPreflight {
  const normalized = normalizePriceProfileV3(value);
  const errors = [...normalized.warnings];
  if (!isRecord(value)) return { ...normalized, valid: false, errors };

  Object.entries(normalized.profile.aliases).forEach(([alias, target]) => {
    const targetKey = normalizeModelKey(target);
    if (alias === targetKey) errors.push(`alias-self-reference:${alias}`);
    if (normalized.profile.overrides[alias] !== undefined || CATALOG_CANONICAL.has(alias)) {
      errors.push(`alias-conflicts-with-direct-model:${alias}`);
    }
    if (!isKnownAliasTarget(target, normalized.profile.overrides)) {
      errors.push(`alias-target-invalid:${alias}`);
    }
  });

  return { ...normalized, valid: errors.length === 0, errors };
}

/** Normalized object export; the caller owns storage keys and persistence. */
export function exportPriceProfileV3(profile: PriceProfileV3): PriceProfileV3 {
  return normalizePriceProfileV3(profile).profile;
}

export function serializePriceProfileV3(profile: PriceProfileV3): string {
  return JSON.stringify(exportPriceProfileV3(profile));
}

export function importPriceProfileV3(value: unknown): PriceProfileImportPreflight {
  if (typeof value !== 'string') return preflightPriceProfileImportV3(value);
  try {
    return preflightPriceProfileImportV3(JSON.parse(value));
  } catch {
    const normalized = normalizePriceProfileV3(null);
    return { ...normalized, valid: false, errors: ['profile-json-invalid'] };
  }
}

/** Migrates only v2 data, without knowing or owning any v2 localStorage key. */
export function migrateModelPricesV2ToV3(value: unknown): PriceProfileNormalization {
  const profile = createDefaultPriceProfileV3();
  if (!isRecord(value)) return { profile, warnings: ['v2-prices-not-object'] };
  const warnings: string[] = [];
  const normalizedV2 = normalizePersistedModelPrices(value);
  Object.entries(value).forEach(([modelName]) => {
    const price = normalizedV2[modelName];
    const key = normalizeModelKey(modelName);
    if (!key || price === undefined) {
      warnings.push(`v2-price-invalid:${modelName}`);
      return;
    }
    profile.overrides[key] = {
      standard: {
        short: {
          input: price.prompt,
          cachedInput: price.cache,
          ...(price.cacheWrite === undefined ? {} : { cacheWrite: price.cacheWrite }),
          output: price.completion,
        },
      },
    };
  });
  return { profile, warnings };
}

const unmatchedPrice = (modelName: string, resolvedModel: string | null = null): ResolvedPrice => ({
  modelName,
  resolvedModel,
  modelMatch: 'none',
  standard: null,
  fast: null,
  usesCustomOverride: false,
});

const resolveAliasTarget = (
  modelName: string,
  target: string,
  profile: PriceProfileV3
): ResolvedPrice => {
  const targetKey = normalizeModelKey(target);
  const custom = profile.overrides[targetKey];
  if (custom !== undefined) {
    return {
      modelName,
      resolvedModel: target,
      modelMatch: 'alias',
      standard: custom.standard,
      fast: custom.fast ?? null,
      usesCustomOverride: true,
    };
  }
  const catalog = CATALOG_CANONICAL.get(targetKey) ?? CATALOG_ALIASES.get(targetKey);
  return catalog === undefined
    ? unmatchedPrice(modelName, target)
    : {
        modelName,
        resolvedModel: catalog.canonicalModel,
        modelMatch: 'alias',
        standard: catalog.standard,
        fast: catalog.fast ?? null,
        usesCustomOverride: false,
      };
};

/** Direct custom -> catalog canonical -> explicit user/catalog alias -> no fuzzy fallback. */
export function resolvePriceProfile(modelName: string, profile: PriceProfileV3): ResolvedPrice {
  const normalized = normalizePriceProfileV3(profile).profile;
  const key = normalizeModelKey(modelName);
  if (!key) return unmatchedPrice(modelName);

  const custom = normalized.overrides[key];
  if (custom !== undefined) {
    return {
      modelName,
      resolvedModel: modelName,
      modelMatch: 'custom',
      standard: custom.standard,
      fast: custom.fast ?? null,
      usesCustomOverride: true,
    };
  }

  const catalogCanonical = CATALOG_CANONICAL.get(key);
  if (catalogCanonical !== undefined) {
    return {
      modelName,
      resolvedModel: catalogCanonical.canonicalModel,
      modelMatch: 'preset',
      standard: catalogCanonical.standard,
      fast: catalogCanonical.fast ?? null,
      usesCustomOverride: false,
    };
  }

  const userAlias = normalized.aliases[key];
  if (userAlias !== undefined) return resolveAliasTarget(modelName, userAlias, normalized);
  const catalogAlias = CATALOG_ALIASES.get(key);
  if (catalogAlias !== undefined)
    return resolveAliasTarget(modelName, catalogAlias.canonicalModel, normalized);
  return unmatchedPrice(modelName);
}

export function materializePriceProfiles(
  modelNames: Iterable<string>,
  profile: PriceProfileV3 = createDefaultPriceProfileV3()
): Record<string, ResolvedPrice> {
  const materialized: Record<string, ResolvedPrice> = {};
  for (const modelName of modelNames) {
    if (isNonEmptyString(modelName))
      materialized[modelName] = resolvePriceProfile(modelName, profile);
  }
  return materialized;
}

export const materializePriceProfileV3 = materializePriceProfiles;

const ASSUMED_STANDARD_TIER: ResolvedServiceTier = {
  tier: 'std',
  evidence: 'assumed',
  rawRequest: null,
  rawResponse: null,
  rawEffective: null,
};

const resolveContextBand = (standard: StandardPricing, inputTokens: number): ContextBand =>
  standard.long !== undefined && inputTokens >= standard.long.thresholdTokens ? 'long' : 'short';

const standardRatesForBand = (standard: StandardPricing, band: ContextBand): TokenRates =>
  band === 'long' && standard.long !== undefined ? standard.long.rates : standard.short;

const resolveFastRates = (
  fast: FastPricing | FastOverride,
  standardRates: TokenRates
): TokenRates =>
  'multiplier' in fast && typeof fast.multiplier === 'number'
    ? multiplyRates(standardRates, fast.multiplier)
    : fast.short;

/**
 * The tier is intentionally resolved by serviceTier.ts before this call. Fast
 * request evidence and assumed Standard evidence remain visible in warnings.
 */
export function estimateUsageCost(
  modelName: string,
  tokens: UsageTokenFields,
  profile: PriceProfileV3 = createDefaultPriceProfileV3(),
  tier: ResolvedServiceTier = ASSUMED_STANDARD_TIER
): CostEstimate {
  const resolved = resolvePriceProfile(modelName, profile);
  const split = splitUsageTokensForCost(tokens, resolved.resolvedModel ?? modelName);
  const warnings: CostEstimateWarning[] = [];
  if (tier.tier === 'fast' && tier.evidence === 'request') warnings.push('requestedEstimate');
  if (tier.tier === 'std' && tier.evidence === 'assumed') warnings.push('assumedStandard');

  if (resolved.standard === null) {
    return {
      amount: null,
      status: 'unmatched',
      modelMatch: 'none',
      tier,
      contextBand: 'short',
      rates: null,
      warnings,
      modelName,
      resolvedModel: resolved.resolvedModel,
      tokenSplit: split,
    };
  }

  const contextBand = resolveContextBand(resolved.standard, split.inputTokens);
  const standardRates = standardRatesForBand(resolved.standard, contextBand);
  let rates = standardRates;
  if (tier.tier === 'fast') {
    if (contextBand === 'long' && resolved.fast?.longSupported === false) {
      return {
        amount: null,
        status: 'unsupported',
        modelMatch: resolved.modelMatch,
        tier,
        contextBand,
        rates: null,
        warnings,
        modelName,
        resolvedModel: resolved.resolvedModel,
        tokenSplit: split,
      };
    }
    if (resolved.fast !== null) rates = resolveFastRates(resolved.fast, standardRates);
    else if (resolved.usesCustomOverride) warnings.push('fallbackStandard');
  }

  const cacheWriteRate = resolveCacheWriteUnitPrice(
    resolved.resolvedModel ?? modelName,
    rates.input,
    rates.cachedInput,
    rates.cacheWrite
  );
  const amount =
    (split.promptTokens * rates.input +
      split.cacheReadTokens * rates.cachedInput +
      split.cacheWriteTokens * cacheWriteRate +
      split.outputTokens * rates.output) /
    TOKENS_PER_MILLION;

  return {
    amount: Number.isFinite(amount) ? Math.max(amount, 0) : null,
    status: Number.isFinite(amount) ? 'priced' : 'unmatched',
    modelMatch: Number.isFinite(amount) ? resolved.modelMatch : 'none',
    tier,
    contextBand,
    rates: Number.isFinite(amount) ? cloneRates(rates) : null,
    warnings,
    modelName,
    resolvedModel: resolved.resolvedModel,
    tokenSplit: split,
  };
}

const toTokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const ratio = (part: number, total: number): number => (total === 0 ? 0 : part / total);

export function aggregateCostEstimateCoverage(
  inputs: Iterable<PricingCoverageInput>
): PricingCoverage {
  const totalModels = new Set<string>();
  const pricedModels = new Set<string>();
  const result: Omit<
    PricingCoverage,
    'totalModels' | 'pricedModels' | 'pricedRequestRatio' | 'pricedTokenRatio' | 'pricedModelRatio'
  > = {
    totalRequests: 0,
    pricedRequests: 0,
    unmatchedRequests: 0,
    unsupportedRequests: 0,
    totalTokens: 0,
    pricedTokens: 0,
    estimatedAmount: 0,
    assumedTierRequests: 0,
  };
  for (const { modelName, tokenCount, estimate } of inputs) {
    result.totalRequests += 1;
    const modelKey = normalizeModelKey(modelName);
    if (modelKey) totalModels.add(modelKey);
    const tokens = toTokenCount(tokenCount);
    result.totalTokens += tokens;
    if (estimate.tier.evidence === 'assumed') result.assumedTierRequests += 1;
    if (estimate.status === 'priced' && estimate.amount !== null) {
      result.pricedRequests += 1;
      result.pricedTokens += tokens;
      result.estimatedAmount += estimate.amount;
      if (modelKey) pricedModels.add(modelKey);
    } else if (estimate.status === 'unsupported') result.unsupportedRequests += 1;
    else result.unmatchedRequests += 1;
  }
  return {
    ...result,
    totalModels: totalModels.size,
    pricedModels: pricedModels.size,
    pricedRequestRatio: ratio(result.pricedRequests, result.totalRequests),
    pricedTokenRatio: ratio(result.pricedTokens, result.totalTokens),
    pricedModelRatio: ratio(pricedModels.size, totalModels.size),
  };
}
