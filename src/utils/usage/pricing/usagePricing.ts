import { resolveUsageTotalTokens, type UsageTokenFields } from '../cacheTokens';
import { resolveServiceTier, type ResolvedServiceTier } from '../serviceTier';
import {
  aggregateCostEstimateCoverage,
  estimateUsageCost,
  type CostEstimate,
  type PriceProfileV3,
  type PricingCoverage,
  type PricingCoverageInput,
} from './index';

export interface PriceableUsageDetail {
  __modelName?: string;
  tokens: UsageTokenFields;
  service_tier?: unknown;
  request_service_tier?: unknown;
  response_service_tier?: unknown;
  effective_service_tier?: unknown;
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

export function estimateUsageDetailCost(
  detail: PriceableUsageDetail,
  profile: PriceProfileV3
): UsageDetailCostEstimate {
  const modelName = detail.__modelName?.trim() ?? '';
  const tier = resolveUsageDetailServiceTier(detail);
  const estimate = estimateUsageCost(modelName, detail.tokens, profile, tier);
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
