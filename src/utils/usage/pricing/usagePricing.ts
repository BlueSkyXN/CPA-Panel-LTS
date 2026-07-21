import { resolveUsageTotalTokens, type UsageTokenFields } from '../cacheTokens';
import { resolveServiceTier, type ResolvedServiceTier } from '../serviceTier';
import {
  aggregateCostEstimateCoverage,
  estimateUsageCost,
  findChatGptCreditPolicy,
  type CostEstimate,
  type PriceProfileV3,
  type PricingCoverage,
  type PricingCoverageInput,
} from './index';
import {
  BILLING_BASIS_CHATGPT_CREDITS,
  normalizeBillingBasis,
  type BillingBasis,
} from './billing';

export interface PriceableUsageDetail {
  __modelName?: string;
  tokens: UsageTokenFields;
  service_tier?: unknown;
  request_service_tier?: unknown;
  response_service_tier?: unknown;
  effective_service_tier?: unknown;
  billing_basis?: unknown;
}

export interface UsageDetailCostEstimate extends PricingCoverageInput {
  tier: ResolvedServiceTier;
}

export function resolveUsageDetailServiceTier(detail: PriceableUsageDetail): ResolvedServiceTier {
  return resolveServiceTier({
    serviceTier: detail.service_tier,
    requestServiceTier: detail.request_service_tier,
    responseServiceTier: detail.response_service_tier,
    effectiveServiceTier: detail.effective_service_tier,
  });
}

export function resolveUsageDetailBillingBasis(detail: PriceableUsageDetail): BillingBasis {
  return normalizeBillingBasis(detail.billing_basis);
}

export function estimateUsageDetailCost(
  detail: PriceableUsageDetail,
  profile: PriceProfileV3
): UsageDetailCostEstimate {
  const modelName = detail.__modelName?.trim() ?? '';
  const tier = resolveUsageDetailServiceTier(detail);
  const billingBasis = resolveUsageDetailBillingBasis(detail);
  const apiEstimate = estimateUsageCost(modelName, detail.tokens, profile, tier);
  // The API-equivalent estimate is always browser-local. Billing basis is
  // retained only as audit metadata and must never gate a catalog/profile match.
  const creditPolicy =
    billingBasis === BILLING_BASIS_CHATGPT_CREDITS
      ? findChatGptCreditPolicy(modelName)
      : null;
  const estimate: CostEstimate = {
    ...apiEstimate,
    billingBasis,
    creditMultiplier: creditPolicy
      ? tier.tier === 'fast'
        ? creditPolicy.fastMultiplier
        : creditPolicy.standardMultiplier
      : null,
  };
  return {
    modelName,
    tokenCount: resolveUsageTotalTokens(detail.tokens, modelName),
    estimate,
    tier,
  };
}

export function summarizeUsageDetailCosts(
  details: Iterable<PriceableUsageDetail>,
  profile: PriceProfileV3
): PricingCoverage {
  const estimates: UsageDetailCostEstimate[] = [];
  for (const detail of details) {
    estimates.push(estimateUsageDetailCost(detail, profile));
  }
  return aggregateCostEstimateCoverage(estimates);
}

export function pricedAmountOrZero(estimate: CostEstimate): number {
  return estimate.status === 'priced' && estimate.amount !== null ? estimate.amount : 0;
}
