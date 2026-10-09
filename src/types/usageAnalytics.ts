import type { AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';
import type { AnalyticsFilterOptions } from '@/utils/usage/analyticsFilters';
import type {
  LatencyHistogram,
  LatencyPercentileSeries,
  LatencyTimingSummaries,
} from '@/utils/usage/latencyAnalysis';
import type { CacheAnalyticsSummary, CacheTrendPoint } from '@/utils/usage/cacheAnalytics';
import type { ErrorAnalyticsSummary, FailureTrendPoint } from '@/utils/usage/errorAnalytics';

export interface UsageAnalyticsGrain {
  latency: LatencyPercentileSeries;
  cache: CacheTrendPoint[];
  errors: FailureTrendPoint[];
}
export interface UsageAnalyticsData {
  timings: LatencyTimingSummaries;
  histogram: LatencyHistogram;
  cache: CacheAnalyticsSummary;
  errors: ErrorAnalyticsSummary;
  hour: UsageAnalyticsGrain;
  day: UsageAnalyticsGrain;
}
export interface UsageAnalyticsResult {
  version: 1;
  analytics_version: 1;
  bound: string;
  now_ms: number;
  from_ms: number | null;
  to_ms: number | null;
  timezone: string;
  total: number;
  analyzed: number;
  data: UsageAnalyticsData;
  options?: AnalyticsFilterOptions;
}
export const analyticsResultWindow = (result: UsageAnalyticsResult): AnalyticsTimeWindow | null =>
  result.from_ms !== null && result.to_ms !== null
    ? { startMs: result.from_ms, endMs: result.to_ms }
    : null;
