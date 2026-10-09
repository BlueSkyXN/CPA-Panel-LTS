import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import {
  buildLatencyHistogram,
  buildLatencyPercentileSeries,
  collectLatencyAnalysisRows,
  summarizeLatencyRows,
} from './latencyAnalysis';
import {
  buildCacheTrendSeries,
  collectCacheAnalysisRows,
  summarizeCacheAnalytics,
} from './cacheAnalytics';
import {
  buildFailureTrendSeries,
  collectErrorAnalysisRows,
  summarizeErrorAnalytics,
} from './errorAnalytics';
import type { AnalyticsGrain, AnalyticsTimeWindow } from './analyticsBuckets';

export function buildUsageAnalytics(
  details: Iterable<unknown>,
  window: AnalyticsTimeWindow | null
): UsageAnalyticsData {
  const all = Array.from(details);
  const latency = collectLatencyAnalysisRows(all);
  const cache = collectCacheAnalysisRows(all);
  const errors = collectErrorAnalysisRows(all);
  const grain = (period: AnalyticsGrain) => ({
    latency: buildLatencyPercentileSeries(latency, period, window),
    cache: buildCacheTrendSeries(cache, period, window),
    errors: buildFailureTrendSeries(errors, period, window),
  });
  return {
    timings: summarizeLatencyRows(latency),
    histogram: buildLatencyHistogram(latency),
    cache: summarizeCacheAnalytics(cache),
    errors: summarizeErrorAnalytics(errors),
    hour: grain('hour'),
    day: grain('day'),
  };
}
