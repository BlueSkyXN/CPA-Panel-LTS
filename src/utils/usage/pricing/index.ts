import {
  resolveCacheWriteUnitPrice,
  splitUsageTokensForCost,
  type UsageCostTokenSplit,
  type UsageTokenFields,
} from '../cacheTokens';
import { normalizePersistedModelPrices } from '../modelPrices';
import type { ResolvedServiceTier } from '../serviceTier';
import {
  BILLING_BASIS_API_TOKEN_USD,
  BILLING_BASIS_CHATGPT_CREDITS,
  type BillingBasis,
} from './billing';
export {
  BILLING_BASIS_API_TOKEN_USD,
  BILLING_BASIS_CHATGPT_CREDITS,
  BILLING_BASIS_UNKNOWN,
  normalizeBillingBasis,
} from './billing';
export type { BillingBasis } from './billing';
import {
  OPENAI_PRICE_CATALOG,
  PRICE_CURRENCY,
  type FastPricing,
  type LongContextPricing,
  type PriceCatalogEntry,
  type StandardPricing,
  type TokenRates,
} from './catalog';

export {
  CHATGPT_CREDIT_CATALOG,
  CHATGPT_FAST_SOURCE_URL,
  LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
  OPENAI_CATALOG_AS_OF,
  OPENAI_CATALOG_VERSION,
  OPENAI_PRICE_CATALOG,
  OPENAI_PRICING_SOURCE_URL,
  PRICE_CURRENCY,
  findChatGptCreditPolicy,
} from './catalog';
export type {
  ChatGptCreditPolicy,
  FastPricing,
  LongContextPricing,
  PriceCatalogEntry,
  StandardPricing,
  TokenRates,
} from './catalog';

/** Pure, storage-free pricing v3 contract. All rates are USD per one million tokens. */
export const PRICE_PROFILE_SCHEMA_VERSION = 3 as const;
export const PRICE_PROFILE_V3 = PRICE_PROFILE_SCHEMA_VERSION;
export const TOKENS_PER_MILLION = 1_000_000;

/** Import ceilings prevent corrupt or nonsensical user profiles from becoming trusted. */
export const MAX_RATE_PER_MILLION = 1_000_000;
export const MAX_FAST_MULTIPLIER = 1_000;
export const MAX_LONG_CONTEXT_THRESHOLD = 10_000_000;

/** Editable custom Fast card. It must select one pricing strategy. */
export type FastOverride = FastPricing;

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

export type CostEstimateStatus =
  | 'priced'
  | 'credit-rated'
  | 'billing-unknown'
  | 'unmatched'
  | 'unsupported';
export type CostEstimateWarning = 'fallbackStandard' | 'requestedEstimate' | 'assumedStandard';
export type ModelMatch = 'custom' | 'preset' | 'alias' | 'none';
export type ContextBand = 'short' | 'long';

export interface CostEstimate {
  amount: number | null;
  status: CostEstimateStatus;
  billingBasis: BillingBasis;
  /** ChatGPT Fast consumes credits at this multiple of Standard; it is not a credit amount. */
  creditMultiplier: number | null;
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
  apiTokenUsdRequests: number;
  chatGptCreditRequests: number;
  pricedRequests: number;
  creditRatedRequests: number;
  creditFastRequests: number;
  unknownBillingRequests: number;
  unmatchedRequests: number;
  unsupportedRequests: number;
  totalTokens: number;
  apiTokenUsdTokens: number;
  chatGptCreditTokens: number;
  pricedTokens: number;
  creditRatedTokens: number;
  unknownBillingTokens: number;
  totalModels: number;
  pricedModels: number;
  apiTokenUsdModels: number;
  apiPricedModels: number;
  chatGptCreditModels: number;
  creditRatedModels: number;
  unknownBillingModels: number;
  estimatedAmount: number;
  assumedTierRequests: number;
  /** Legacy all-request ratio. Prefer apiPricedRequestRatio for USD coverage UI. */
  pricedRequestRatio: number;
  /** Legacy all-token ratio. Prefer apiPricedTokenRatio for USD coverage UI. */
  pricedTokenRatio: number;
  pricedModelRatio: number;
  apiPricedRequestRatio: number;
  apiPricedTokenRatio: number;
  apiPricedModelRatio: number;
  creditRatedRequestRatio: number;
  creditRatedTokenRatio: number;
}

export type ApiFastPolicyDisplay =
  | { kind: 'none'; multiplier: null }
  | { kind: 'official-multiplier'; multiplier: number }
  | { kind: 'custom-multiplier'; multiplier: number }
  | { kind: 'explicit-rates'; multiplier: null };

export const hasUnknownBillingUsage = (coverage: PricingCoverage): boolean =>
  coverage.unknownBillingRequests > 0 ||
  coverage.unknownBillingTokens > 0 ||
  coverage.unknownBillingModels > 0;

export const isApiUsdEstimateComplete = (coverage: PricingCoverage): boolean =>
  coverage.apiTokenUsdRequests > 0 &&
  coverage.pricedRequests === coverage.apiTokenUsdRequests &&
  coverage.pricedTokens === coverage.apiTokenUsdTokens &&
  coverage.apiPricedModels === coverage.apiTokenUsdModels &&
  !hasUnknownBillingUsage(coverage);

export const hasPricingAnomaly = (
  coverage: PricingCoverage,
  warnings: readonly CostEstimateWarning[] = []
): boolean =>
  hasUnknownBillingUsage(coverage) ||
  coverage.unmatchedRequests > 0 ||
  coverage.unsupportedRequests > 0 ||
  coverage.pricedRequests < coverage.apiTokenUsdRequests ||
  coverage.pricedTokens < coverage.apiTokenUsdTokens ||
  coverage.apiPricedModels < coverage.apiTokenUsdModels ||
  coverage.creditRatedRequests < coverage.chatGptCreditRequests ||
  coverage.creditRatedTokens < coverage.chatGptCreditTokens ||
  coverage.creditRatedModels < coverage.chatGptCreditModels ||
  warnings.includes('fallbackStandard');

export const getApiFastPolicyDisplay = (resolved: ResolvedPrice): ApiFastPolicyDisplay => {
  if (resolved.fast === null) return { kind: 'none', multiplier: null };
  const multiplier = resolved.fast.multiplier;
  if (typeof multiplier !== 'number') return { kind: 'explicit-rates', multiplier: null };
  return {
    kind: resolved.usesCustomOverride ? 'custom-multiplier' : 'official-multiplier',
    multiplier,
  };
};

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
      billingBasis: BILLING_BASIS_API_TOKEN_USD,
      creditMultiplier: null,
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
        billingBasis: BILLING_BASIS_API_TOKEN_USD,
        creditMultiplier: null,
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
    billingBasis: BILLING_BASIS_API_TOKEN_USD,
    creditMultiplier: null,
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
  const modelCoverage = new Map<
    string,
    {
      total: number;
      priced: number;
      apiTotal: number;
      apiPriced: number;
      creditTotal: number;
      creditRated: number;
      unknownBilling: number;
    }
  >();
  const result: Omit<
    PricingCoverage,
    | 'totalModels'
    | 'pricedModels'
    | 'apiTokenUsdModels'
    | 'apiPricedModels'
    | 'chatGptCreditModels'
    | 'creditRatedModels'
    | 'unknownBillingModels'
    | 'pricedRequestRatio'
    | 'pricedTokenRatio'
    | 'pricedModelRatio'
    | 'apiPricedRequestRatio'
    | 'apiPricedTokenRatio'
    | 'apiPricedModelRatio'
    | 'creditRatedRequestRatio'
    | 'creditRatedTokenRatio'
  > = {
    totalRequests: 0,
    apiTokenUsdRequests: 0,
    chatGptCreditRequests: 0,
    pricedRequests: 0,
    creditRatedRequests: 0,
    creditFastRequests: 0,
    unknownBillingRequests: 0,
    unmatchedRequests: 0,
    unsupportedRequests: 0,
    totalTokens: 0,
    apiTokenUsdTokens: 0,
    chatGptCreditTokens: 0,
    pricedTokens: 0,
    creditRatedTokens: 0,
    unknownBillingTokens: 0,
    estimatedAmount: 0,
    assumedTierRequests: 0,
  };
  for (const { modelName, tokenCount, estimate } of inputs) {
    result.totalRequests += 1;
    const modelKey = normalizeModelKey(modelName);
    let currentModel:
      | {
          total: number;
          priced: number;
          apiTotal: number;
          apiPriced: number;
          creditTotal: number;
          creditRated: number;
          unknownBilling: number;
        }
      | undefined;
    if (modelKey) {
      currentModel = modelCoverage.get(modelKey) ?? {
        total: 0,
        priced: 0,
        apiTotal: 0,
        apiPriced: 0,
        creditTotal: 0,
        creditRated: 0,
        unknownBilling: 0,
      };
      currentModel.total += 1;
      modelCoverage.set(modelKey, currentModel);
    }
    const tokens = toTokenCount(tokenCount);
    result.totalTokens += tokens;

    if (estimate.billingBasis === BILLING_BASIS_API_TOKEN_USD) {
      result.apiTokenUsdRequests += 1;
      result.apiTokenUsdTokens += tokens;
      if (currentModel) currentModel.apiTotal += 1;
    } else if (estimate.billingBasis === BILLING_BASIS_CHATGPT_CREDITS) {
      result.chatGptCreditRequests += 1;
      result.chatGptCreditTokens += tokens;
      if (currentModel) currentModel.creditTotal += 1;
    } else {
      result.unknownBillingRequests += 1;
      result.unknownBillingTokens += tokens;
      if (currentModel) currentModel.unknownBilling += 1;
    }

    if (
      estimate.tier.evidence === 'assumed' &&
      (estimate.status === 'priced' || estimate.status === 'credit-rated')
    ) {
      result.assumedTierRequests += 1;
    }
    if (estimate.status === 'priced' && estimate.amount !== null) {
      result.pricedRequests += 1;
      result.pricedTokens += tokens;
      result.estimatedAmount += estimate.amount;
      if (currentModel) {
        currentModel.priced += 1;
        currentModel.apiPriced += 1;
      }
    } else if (estimate.status === 'credit-rated') {
      result.creditRatedRequests += 1;
      result.creditRatedTokens += tokens;
      if (estimate.tier.tier === 'fast') result.creditFastRequests += 1;
      if (currentModel) currentModel.creditRated += 1;
    } else if (estimate.status === 'billing-unknown') {
      // Basis counters above already keep this request in the explicit unknown domain.
    } else if (estimate.status === 'unsupported') result.unsupportedRequests += 1;
    else result.unmatchedRequests += 1;
  }
  const totalModels = modelCoverage.size;
  const modelStates = Array.from(modelCoverage.values());
  const pricedModels = modelStates.filter(
    ({ total, priced }) => total > 0 && priced === total
  ).length;
  const apiTokenUsdModels = modelStates.filter(({ apiTotal }) => apiTotal > 0).length;
  const apiPricedModels = modelStates.filter(
    ({ apiTotal, apiPriced }) => apiTotal > 0 && apiPriced === apiTotal
  ).length;
  const chatGptCreditModels = modelStates.filter(({ creditTotal }) => creditTotal > 0).length;
  const creditRatedModels = modelStates.filter(
    ({ creditTotal, creditRated }) => creditTotal > 0 && creditRated === creditTotal
  ).length;
  const unknownBillingModels = modelStates.filter(
    ({ unknownBilling }) => unknownBilling > 0
  ).length;
  return {
    ...result,
    totalModels,
    pricedModels,
    apiTokenUsdModels,
    apiPricedModels,
    chatGptCreditModels,
    creditRatedModels,
    unknownBillingModels,
    pricedRequestRatio: ratio(result.pricedRequests, result.totalRequests),
    pricedTokenRatio: ratio(result.pricedTokens, result.totalTokens),
    pricedModelRatio: ratio(pricedModels, totalModels),
    apiPricedRequestRatio: ratio(result.pricedRequests, result.apiTokenUsdRequests),
    apiPricedTokenRatio: ratio(result.pricedTokens, result.apiTokenUsdTokens),
    apiPricedModelRatio: ratio(apiPricedModels, apiTokenUsdModels),
    creditRatedRequestRatio: ratio(result.creditRatedRequests, result.chatGptCreditRequests),
    creditRatedTokenRatio: ratio(result.creditRatedTokens, result.chatGptCreditTokens),
  };
}
