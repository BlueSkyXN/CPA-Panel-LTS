/** Official provider catalog data is kept separate from the pricing engine and UI. */
export const PRICE_CURRENCY = 'USD' as const;
export const OPENAI_CATALOG_AS_OF = '2026-07-31';
export const ZAI_CATALOG_AS_OF = '2026-07-22';
export const KIMI_CATALOG_AS_OF = '2026-07-28';
export const XAI_CATALOG_AS_OF = '2026-07-23';
export const CODEX_SPARK_CATALOG_AS_OF = '2026-07-25';
export const ANTHROPIC_CATALOG_AS_OF = '2026-07-26';
export const PRICE_CATALOG_AS_OF = OPENAI_CATALOG_AS_OF;
export const PRICE_CATALOG_VERSION = `api-${PRICE_CATALOG_AS_OF}`;
export const OPENAI_PRICING_SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
export const ZAI_PRICING_SOURCE_URL = 'https://docs.z.ai/guides/overview/pricing';
export const KIMI_PRICING_SOURCE_URL = 'https://platform.kimi.ai/docs/pricing/chat';
export const XAI_PRICING_SOURCE_URL = 'https://docs.x.ai/developers/models/grok-4.5';
export const XAI_GROK_46_PRICING_SOURCE_URL = 'https://docs.x.ai/developers/models/grok-4.6';
export const XAI_GROK_46_CATALOG_AS_OF = '2026-08-18';
export const ANTHROPIC_PRICING_SOURCE_URL =
  'https://platform.claude.com/docs/en/about-claude/pricing';
export const ANTHROPIC_MODEL_IDS_SOURCE_URL =
  'https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions';
export const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;
export const XAI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 200_000;

export interface TokenRates {
  input: number;
  cachedInput: number;
  /** Omitted means Auto: use the selected tier's input rate. Explicit 0 is free. */
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

/** Fast/Priority is derived from Standard when the official rate is a fixed multiplier. */
export type FastPricing =
  | { short: TokenRates; multiplier?: never; longSupported: boolean }
  | { short?: never; multiplier: number; longSupported: boolean };

export interface PriceCatalogEntry {
  canonicalModel: string;
  aliases: readonly string[];
  currency: typeof PRICE_CURRENCY;
  standard: StandardPricing;
  fast?: FastPricing;
  sourceUrl: string;
  pricingNotesUrl?: string;
  asOf: string;
}

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

const longCard = (
  rates: TokenRates,
  thresholdTokens = LONG_CONTEXT_INPUT_TOKEN_THRESHOLD
): LongContextPricing => ({
  thresholdTokens,
  basis: 'inputTokens',
  appliesTo: 'entireRequest',
  rates,
});

const modelPricingNotesUrl = (model: string): string =>
  `https://developers.openai.com/api/docs/models/${model}`;

const kimiPricingSourceUrl = (model: 'k3' | 'k27-code'): string =>
  `${KIMI_PRICING_SOURCE_URL}-${model}`;

const kimiModelNotesUrl = (model: 'k3' | 'k2-7-code'): string =>
  `https://platform.kimi.ai/docs/guide/kimi-${model}-quickstart`;

/**
 * Official provider rate cards, each carrying its own verification date and source.
 * OpenAI model notes define the 272K long-context uplift when their aggregate table omits it.
 */
export const PRICE_CATALOG: readonly PriceCatalogEntry[] = [
  {
    canonicalModel: 'gpt-5.6-sol',
    aliases: ['gpt-5.6'],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 30), long: longCard(rateCard(10, 1, 12.5, 45)) },
    fast: { multiplier: 2, longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    pricingNotesUrl: modelPricingNotesUrl('gpt-5.6-sol'),
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.6-terra',
    aliases: [],
    currency: 'USD',
    standard: {
      short: rateCard(2, 0.2, 2.5, 12),
      long: longCard(rateCard(4, 0.4, 5, 18)),
    },
    fast: { multiplier: 2, longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    pricingNotesUrl: modelPricingNotesUrl('gpt-5.6-terra'),
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.6-luna',
    aliases: [],
    currency: 'USD',
    standard: {
      short: rateCard(0.2, 0.02, 0.25, 1.2),
      long: longCard(rateCard(0.4, 0.04, 0.5, 1.8)),
    },
    fast: { multiplier: 2, longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    pricingNotesUrl: modelPricingNotesUrl('gpt-5.6-luna'),
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
    fast: { multiplier: 2.5, longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    pricingNotesUrl: modelPricingNotesUrl('gpt-5.5'),
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
    fast: { multiplier: 2, longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    pricingNotesUrl: modelPricingNotesUrl('gpt-5.4'),
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.4-mini',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(0.75, 0.075, undefined, 4.5) },
    fast: { multiplier: 2, longSupported: false },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.3-codex-spark',
    aliases: [],
    currency: 'USD',
    // This model is free. Use explicit zeroes so none of the token categories
    // fall back to Auto pricing (including cache writes).
    standard: { short: rateCard(0, 0, 0, 0) },
    sourceUrl: OPENAI_PRICING_SOURCE_URL,
    asOf: CODEX_SPARK_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-haiku-4-5-20251001',
    aliases: ['claude-haiku-4-5'],
    currency: 'USD',
    // Anthropic cacheWrite values use the requested 5-minute rate; 1-hour caching is out of scope.
    standard: { short: rateCard(1, 0.1, 1.25, 5) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-sonnet-4-5-20250929',
    aliases: ['claude-sonnet-4-5'],
    currency: 'USD',
    standard: { short: rateCard(3, 0.3, 3.75, 15) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-sonnet-4-6',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(3, 0.3, 3.75, 15) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-sonnet-5',
    aliases: [],
    currency: 'USD',
    // Keep the post-promotion standard rate instead of a time-dependent introductory price.
    standard: { short: rateCard(3, 0.3, 3.75, 15) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-opus-4-5-20251101',
    aliases: ['claude-opus-4-5'],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 25) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-opus-4-6',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 25) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-opus-4-7',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 25) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-opus-4-8',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 25) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-opus-5',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(5, 0.5, 6.25, 25) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'claude-fable-5',
    aliases: [],
    currency: 'USD',
    standard: { short: rateCard(10, 1, 12.5, 50) },
    sourceUrl: ANTHROPIC_PRICING_SOURCE_URL,
    pricingNotesUrl: ANTHROPIC_MODEL_IDS_SOURCE_URL,
    asOf: ANTHROPIC_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'glm-5.2',
    aliases: [],
    currency: 'USD',
    // Z.AI lists cached-input storage as limited-time free. Explicit zero must
    // remain distinct from Auto, which inherits the selected Input rate.
    standard: { short: rateCard(1.4, 0.26, 0, 4.4) },
    sourceUrl: ZAI_PRICING_SOURCE_URL,
    pricingNotesUrl: 'https://docs.z.ai/guides/llm/glm-5.2',
    asOf: ZAI_CATALOG_AS_OF,
  },
  // Kimi keeps one flat rate per model id. Do not add long-context bands for the
  // same Kimi model; reduced-context SKUs such as kimi-k3-256k are separate models.
  {
    canonicalModel: 'kimi-k3',
    aliases: ['k3'],
    currency: 'USD',
    standard: { short: rateCard(3, 0.3, undefined, 15) },
    sourceUrl: kimiPricingSourceUrl('k3'),
    pricingNotesUrl: kimiModelNotesUrl('k3'),
    asOf: KIMI_CATALOG_AS_OF,
  },
  {
    // Half of kimi-k3 because this SKU trims context and drops video; not a context band of k3.
    canonicalModel: 'kimi-k3-256k',
    aliases: ['k3-256k'],
    currency: 'USD',
    standard: { short: rateCard(1.5, 0.15, undefined, 7.5) },
    sourceUrl: kimiPricingSourceUrl('k3'),
    pricingNotesUrl: kimiModelNotesUrl('k3'),
    asOf: KIMI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'kimi-k2.7-code',
    aliases: ['kimi-for-coding'],
    currency: 'USD',
    standard: { short: rateCard(0.95, 0.19, undefined, 4) },
    sourceUrl: kimiPricingSourceUrl('k27-code'),
    pricingNotesUrl: kimiModelNotesUrl('k2-7-code'),
    asOf: KIMI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'kimi-k2.7-code-highspeed',
    aliases: ['kimi-for-coding-highspee', 'kimi-for-coding-highspeed'],
    currency: 'USD',
    standard: { short: rateCard(1.9, 0.38, undefined, 8) },
    sourceUrl: kimiPricingSourceUrl('k27-code'),
    pricingNotesUrl: kimiModelNotesUrl('k2-7-code'),
    asOf: KIMI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'grok-4.5',
    aliases: ['grok-4.5-latest', 'grok-build-latest'],
    currency: 'USD',
    standard: {
      short: rateCard(2, 0.3, undefined, 6),
      long: longCard(rateCard(4, 0.6, undefined, 12), XAI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD),
    },
    sourceUrl: XAI_PRICING_SOURCE_URL,
    asOf: XAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'grok-4.6',
    aliases: [],
    currency: 'USD',
    standard: {
      short: rateCard(2, 0.5, undefined, 6),
      long: longCard(rateCard(4, 1, undefined, 12), XAI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD),
    },
    sourceUrl: XAI_GROK_46_PRICING_SOURCE_URL,
    asOf: XAI_GROK_46_CATALOG_AS_OF,
  },
];
