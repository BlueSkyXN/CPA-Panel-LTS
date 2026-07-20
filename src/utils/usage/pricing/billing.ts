export const BILLING_BASIS_API_TOKEN_USD = 'api-token-usd' as const;
export const BILLING_BASIS_CHATGPT_CREDITS = 'chatgpt-credits' as const;
export const BILLING_BASIS_UNKNOWN = 'unknown' as const;

export type BillingBasis =
  | typeof BILLING_BASIS_API_TOKEN_USD
  | typeof BILLING_BASIS_CHATGPT_CREDITS
  | typeof BILLING_BASIS_UNKNOWN;

export function normalizeBillingBasis(value: unknown): BillingBasis {
  if (typeof value !== 'string') return BILLING_BASIS_UNKNOWN;
  switch (value.trim().toLowerCase()) {
    case BILLING_BASIS_API_TOKEN_USD:
      return BILLING_BASIS_API_TOKEN_USD;
    case BILLING_BASIS_CHATGPT_CREDITS:
      return BILLING_BASIS_CHATGPT_CREDITS;
    default:
      return BILLING_BASIS_UNKNOWN;
  }
}
