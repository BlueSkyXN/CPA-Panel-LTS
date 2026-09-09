import type {
  UsageQueryGroup,
  UsageQueryMetrics,
  UsageQueryPriceGroup,
  UsageQueryRequest,
  UsageQuerySummary,
} from '@/types/usageQuery';
import type {
  ApiStats,
  ModelStatsSummary,
  PricingModelSummary,
  StatusBarData,
  TokenCategory,
  UsageTimeWindow,
} from '@/utils/usage';
import {
  formatDayLabel,
  formatHourLabel,
  maskUsageSensitiveValue,
  normalizeUsageSourceId,
  normalizeAuthIndex,
} from '@/utils/usage';
import {
  aggregateCostEstimateCoverage,
  estimateUsageCost,
  isGptSeriesModelName,
  preparePriceProfile,
  resolvePriceProfile,
  type PriceProfileV3,
  type PricingCoverageInput,
} from './pricing';

/** 独立的查询视图，不包含 apis/details，不能写回完整快照 store。 */
export interface UsageQueryView {
  kind: 'usage-query-v1';
  summary: UsageQuerySummary;
  pricing: UsageQuerySummary | null;
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  [key: string]: unknown;
}
export const isUsageQueryView = (v: unknown): v is UsageQueryView =>
  typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'usage-query-v1';
export const makeUsageQueryView = (
  summary: UsageQuerySummary | null,
  pricing: UsageQuerySummary | null = null
): UsageQueryView | null =>
  summary
    ? {
        kind: 'usage-query-v1',
        summary,
        pricing,
        total_requests: summary.totals.requests,
        success_count: summary.totals.success,
        failure_count: summary.totals.failure,
        total_tokens: summary.totals.tokens,
      }
    : null;

export function buildQueryPriceRules(
  models: string[],
  source: PriceProfileV3
): UsageQueryRequest['rules'] {
  const profile = preparePriceProfile(source);
  return Object.fromEntries(
    models.map((model) => {
      const resolved = resolvePriceProfile(model, profile);
      const suppressed =
        profile.assumptions.gptLongContext === 'shortOnly' &&
        isGptSeriesModelName(resolved.resolvedModel ?? model);
      const threshold = suppressed ? undefined : resolved.standard?.long?.thresholdTokens;
      return [model, threshold === undefined ? {} : { long_threshold: threshold }];
    })
  );
}

function priceInput(group: UsageQueryPriceGroup, profile: PriceProfileV3): PricingCoverageInput {
  const resolved = resolvePriceProfile(group.model, profile);
  const input = group.band === 'long' ? (resolved.standard?.long?.thresholdTokens ?? 0) : 0;
  const estimate = estimateUsageCost(group.model, { input_tokens: input }, profile, {
    tier: group.tier,
    evidence: group.evidence,
    rawRequest: null,
    rawOutbound: null,
    rawResponse: null,
    rawEffective: null,
  });
  const rates = estimate.rates;
  const amount = rates
    ? (group.prompt * rates.input +
        group.cache_read * rates.cachedInput +
        group.cache_write * (rates.cacheWrite ?? rates.input) +
        group.output * rates.output) /
      1_000_000
    : null;
  return {
    modelName: group.model,
    tokenCount: group.tokens,
    requestCount: group.requests,
    estimate: { ...estimate, amount },
  };
}
export function queryCoverage(metrics: UsageQueryMetrics | undefined, source: PriceProfileV3) {
  const profile = preparePriceProfile(source);
  return aggregateCostEstimateCoverage(
    (metrics?.prices ?? []).map((group) => priceInput(group, profile))
  );
}
export const queryGroupKey = (g: UsageQueryGroup) =>
  JSON.stringify([g.api, g.model, g.source, g.auth_index, g.start_ms]);
const pricedGroups = (view: UsageQueryView, module: keyof UsageQuerySummary['groups']) =>
  new Map((view.pricing?.groups[module] ?? []).map((g) => [queryGroupKey(g), g.metrics]));

export function queryApiStats(view: UsageQueryView, profile: PriceProfileV3): ApiStats[] {
  const apis = new Map<string, ApiStats>();
  const prices = pricedGroups(view, 'api_models');
  const inputs = new Map<string, PricingCoverageInput[]>();
  for (const group of view.summary.groups.api_models ?? []) {
    const api = group.api ?? '';
    const m = group.metrics;
    const row = apis.get(api) ?? {
      endpoint: maskUsageSensitiveValue(api) || api,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCost: 0,
      pricingCoverage: aggregateCostEstimateCoverage([]),
      models: {},
    };
    row.totalRequests += m.requests;
    row.successCount += m.success;
    row.failureCount += m.failure;
    row.totalTokens += m.tokens;
    row.models[group.model ?? ''] = {
      requests: m.requests,
      successCount: m.success,
      failureCount: m.failure,
      tokens: m.tokens,
    };
    const list = inputs.get(api) ?? [];
    for (const p of prices.get(queryGroupKey(group))?.prices ?? [])
      list.push(priceInput(p, preparePriceProfile(profile)));
    inputs.set(api, list);
    apis.set(api, row);
  }
  return Array.from(apis, ([api, row]) => {
    row.pricingCoverage = aggregateCostEstimateCoverage(inputs.get(api) ?? []);
    row.totalCost = row.pricingCoverage.estimatedAmount;
    return row;
  });
}
export function queryModelStats(
  view: UsageQueryView,
  profile: PriceProfileV3
): ModelStatsSummary[] {
  const prices = pricedGroups(view, 'models');
  return (view.summary.groups.models ?? [])
    .map((g) => {
      const m = g.metrics;
      const pricingCoverage = queryCoverage(prices.get(queryGroupKey(g)), profile);
      return {
        model: g.model ?? '',
        requests: m.requests,
        successCount: m.success,
        failureCount: m.failure,
        tokens: m.tokens,
        inputTokens: m.input,
        cacheReadTokens: m.cache_read,
        cacheRate: m.input > 0 ? m.cache_read / m.input : null,
        cost: pricingCoverage.estimatedAmount,
        pricingCoverage,
        averageLatencyMs: m.latency_samples > 0 ? m.latency_ms / m.latency_samples : null,
        latencySampleCount: m.latency_samples,
      };
    })
    .sort((a, b) => b.requests - a.requests);
}
export function queryPricingModels(
  view: UsageQueryView,
  source: PriceProfileV3
): PricingModelSummary[] {
  const profile = preparePriceProfile(source);
  const prices = pricedGroups(view, 'models');
  return (view.summary.groups.models ?? [])
    .map((g) => {
      const modelName = g.model ?? '';
      const groups = prices.get(queryGroupKey(g))?.prices ?? [];
      const pricingCoverage = queryCoverage(prices.get(queryGroupKey(g)), profile);
      return {
        modelName,
        resolvedPrice: resolvePriceProfile(modelName, profile),
        pricingCoverage,
        requestCount: g.metrics.requests,
        tokenCount: g.metrics.tokens,
        estimatedAmount: pricingCoverage.estimatedAmount,
        fastRequestCount: groups.reduce((n, p) => n + (p.tier === 'fast' ? p.requests : 0), 0),
        longContextRequestCount: groups.reduce(
          (n, p) => n + (p.band === 'long' ? p.requests : 0),
          0
        ),
        warnings: Array.from(
          new Set(groups.flatMap((p) => priceInput(p, profile).estimate.warnings))
        ),
      };
    })
    .sort((a, b) => b.requestCount - a.requestCount || a.modelName.localeCompare(b.modelName));
}

function queryAxis(
  view: UsageQueryView,
  period: 'hour' | 'day',
  selection: number | UsageTimeWindow = 24
) {
  const groups = view.summary.groups[period === 'hour' ? 'hours' : 'days'] ?? [];
  let times = Array.from(new Set(groups.map((g) => g.start_ms ?? 0))).sort((a, b) => a - b);
  if (period === 'hour') {
    const floor = (n: number) => {
      const d = new Date(n);
      d.setMinutes(0, 0, 0);
      return d.getTime();
    };
    const end = floor(typeof selection === 'object' ? selection.endMs : view.summary.now_ms);
    const start =
      typeof selection === 'object'
        ? floor(selection.startMs)
        : end - (Math.min(Math.max(selection, 1), 24 * 31) - 1) * 3600000;
    const count = Math.floor((end - start) / 3600000) + 1;
    times =
      count > 0 && count <= 2161
        ? Array.from({ length: count }, (_, i) => start + i * 3600000)
        : Array.from(new Set([start, end, ...times])).sort((a, b) => a - b);
  }
  return {
    groups,
    times,
    labels: times.map((ms) =>
      period === 'hour' ? formatHourLabel(new Date(ms)) : formatDayLabel(new Date(ms))
    ),
    indices: new Map(times.map((ms, i) => [ms, i])),
  };
}
export function querySeriesByModel(
  view: UsageQueryView,
  period: 'hour' | 'day',
  metric: 'requests' | 'tokens',
  selection?: number | UsageTimeWindow
) {
  const { groups, labels, indices } = queryAxis(view, period, selection);
  const dataByModel = new Map<string, number[]>();
  let hasData = false;
  for (const g of groups) {
    const i = indices.get(g.start_ms ?? 0);
    if (i === undefined) continue;
    const data = dataByModel.get(g.model ?? '') ?? labels.map(() => 0);
    data[i] += g.metrics[metric];
    dataByModel.set(g.model ?? '', data);
    hasData = true;
  }
  return { labels, dataByModel, hasData };
}
export function queryTokenSeries(
  view: UsageQueryView,
  period: 'hour' | 'day',
  selection?: number | UsageTimeWindow
) {
  const { groups, labels, indices } = queryAxis(view, period, selection);
  const dataByCategory: Record<TokenCategory, number[]> = {
    input: labels.map(() => 0),
    output: labels.map(() => 0),
    cacheRead: labels.map(() => 0),
    cacheWrite: labels.map(() => 0),
    reasoning: labels.map(() => 0),
  };
  const fields = {
    input: 'input',
    output: 'output',
    cacheRead: 'cache_read',
    cacheWrite: 'cache_write',
    reasoning: 'reasoning',
  } as const;
  for (const g of groups) {
    const i = indices.get(g.start_ms ?? 0);
    if (i === undefined) continue;
    for (const key of Object.keys(fields) as TokenCategory[])
      dataByCategory[key][i] += g.metrics[fields[key]];
  }
  return { labels, dataByCategory, hasData: groups.length > 0 };
}
export function queryCostSeries(
  view: UsageQueryView,
  period: 'hour' | 'day',
  profile: PriceProfileV3,
  selection?: number | UsageTimeWindow
) {
  const { labels, indices } = queryAxis(view, period, selection);
  const data = labels.map(() => 0);
  const inputs: PricingCoverageInput[] = [];
  for (const g of view.pricing?.groups[period === 'hour' ? 'hours' : 'days'] ?? []) {
    const i = indices.get(g.start_ms ?? 0);
    if (i === undefined) continue;
    const estimates = (g.metrics.prices ?? []).map((p) =>
      priceInput(p, preparePriceProfile(profile))
    );
    inputs.push(...estimates);
    data[i] += estimates.reduce((n, p) => n + (p.estimate.amount ?? 0), 0);
  }
  const pricingCoverage = aggregateCostEstimateCoverage(inputs);
  return { labels, data, pricingCoverage, hasData: pricingCoverage.pricedRequests > 0 };
}

export function queryStatusBar(
  groups: UsageQueryGroup[],
  now: number,
  count = 20,
  duration = 600000
): StatusBarData {
  const start = now - count * duration;
  const blockDetails = Array.from({ length: count }, (_, i) => ({
    success: 0,
    failure: 0,
    rate: -1,
    startTime: start + i * duration,
    endTime: start + (i + 1) * duration,
  }));
  for (const g of groups) {
    const i = Math.round(((g.start_ms ?? 0) - start) / duration);
    if (i >= 0 && i < count) {
      blockDetails[i].success += g.metrics.success;
      blockDetails[i].failure += g.metrics.failure;
    }
  }
  let totalSuccess = 0,
    totalFailure = 0;
  const blocks = blockDetails.map((d) => {
    totalSuccess += d.success;
    totalFailure += d.failure;
    d.rate = d.success + d.failure > 0 ? d.success / (d.success + d.failure) : -1;
    return d.rate === -1
      ? ('idle' as const)
      : d.failure === 0
        ? ('success' as const)
        : d.success === 0
          ? ('failure' as const)
          : ('mixed' as const);
  });
  return {
    blocks,
    blockDetails,
    totalSuccess,
    totalFailure,
    successRate:
      totalSuccess + totalFailure ? (totalSuccess / (totalSuccess + totalFailure)) * 100 : 100,
  };
}
export function queryKeyStats(summary: UsageQuerySummary | null) {
  const bySource: Record<string, { success: number; failure: number }> = {};
  const byAuthIndex: Record<string, { success: number; failure: number }> = {};
  for (const g of summary?.groups.credentials ?? []) {
    for (const [map, key] of [
      [bySource, normalizeUsageSourceId(g.source ?? '')],
      [byAuthIndex, normalizeAuthIndex(g.auth_index)],
    ] as const) {
      if (!key) continue;
      const value = map[key] ?? { success: 0, failure: 0 };
      value.success += g.metrics.success;
      value.failure += g.metrics.failure;
      map[key] = value;
    }
  }
  return { bySource, byAuthIndex };
}
