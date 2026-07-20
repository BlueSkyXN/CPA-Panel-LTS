/** Official catalog data is kept separate from the pricing engine and UI. */
export const PRICE_CURRENCY = 'USD' as const;
export const OPENAI_CATALOG_AS_OF = '2026-07-20';
export const OPENAI_CATALOG_VERSION = `openai-${OPENAI_CATALOG_AS_OF}`;
export const OPENAI_PRICING_SOURCE_URL = 'https://developers.openai.com/api/docs/pricing';
export const CHATGPT_FAST_SOURCE_URL =
  'https://learn.chatgpt.com/docs/agent-configuration/speed#fast-mode';
export const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;

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

export interface ChatGptCreditPolicy {
  canonicalModel: string;
  aliases: readonly string[];
  standardMultiplier: 1;
  fastMultiplier: number;
  sourceUrl: string;
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

const longCard = (rates: TokenRates): LongContextPricing => ({
  thresholdTokens: LONG_CONTEXT_INPUT_TOKEN_THRESHOLD,
  basis: 'inputTokens',
  appliesTo: 'entireRequest',
  rates,
});

const modelPricingNotesUrl = (model: string): string =>
  `https://developers.openai.com/api/docs/models/${model}`;

/**
 * Official OpenAI API rate cards confirmed on 2026-07-20. Model pricing notes
 * define the 272K long-context uplift when the aggregate table omits that row.
 */
export const OPENAI_PRICE_CATALOG: readonly PriceCatalogEntry[] = [
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
      short: rateCard(2.5, 0.25, 3.125, 15),
      long: longCard(rateCard(5, 0.5, 6.25, 22.5)),
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
    standard: { short: rateCard(1, 0.1, 1.25, 6), long: longCard(rateCard(2, 0.2, 2.5, 9)) },
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
];

/** ChatGPT credit multipliers are not API token prices and are never converted to USD. */
export const CHATGPT_CREDIT_CATALOG: readonly ChatGptCreditPolicy[] = [
  ...['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].map((canonicalModel) => ({
    canonicalModel,
    aliases: (canonicalModel === 'gpt-5.6-sol' ? ['gpt-5.6'] : []) as readonly string[],
    standardMultiplier: 1 as const,
    fastMultiplier: 2.5,
    sourceUrl: CHATGPT_FAST_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  })),
  {
    canonicalModel: 'gpt-5.5',
    aliases: [],
    standardMultiplier: 1,
    fastMultiplier: 2.5,
    sourceUrl: CHATGPT_FAST_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
  {
    canonicalModel: 'gpt-5.4',
    aliases: [],
    standardMultiplier: 1,
    fastMultiplier: 2,
    sourceUrl: CHATGPT_FAST_SOURCE_URL,
    asOf: OPENAI_CATALOG_AS_OF,
  },
];

const normalizeModelKey = (value: string): string => value.trim().toLowerCase();
const CREDIT_POLICIES = new Map(
  CHATGPT_CREDIT_CATALOG.flatMap((policy) => [
    [normalizeModelKey(policy.canonicalModel), policy] as const,
    ...policy.aliases.map((alias) => [normalizeModelKey(alias), policy] as const),
  ])
);

export function findChatGptCreditPolicy(modelName: string): ChatGptCreditPolicy | null {
  return CREDIT_POLICIES.get(normalizeModelKey(modelName)) ?? null;
}
