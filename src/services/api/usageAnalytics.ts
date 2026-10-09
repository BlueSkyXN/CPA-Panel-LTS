import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type { UsageAnalyticsResult } from '@/types/usageAnalytics';
import type { UsageQueryRequest } from '@/types/usageQuery';

const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => number(v) && Number.isSafeInteger(v);
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= 8640000000000000;
const nullable = (v: unknown) => v === null || number(v);
const list = (v: unknown, check: (item: unknown) => boolean, max = 4098): v is unknown[] =>
  Array.isArray(v) && v.length <= max && v.every(check);
const counts = (v: Record<string, unknown>, names: string[]) =>
  names.every((key) => number(v[key]));
const percentiles = (v: unknown) =>
  isRecord(v) &&
  integer(v.sampleCount) &&
  ['p50', 'p90', 'p95', 'p99', 'average'].every((key) => nullable(v[key])) &&
  (v.sampleCount !== 0 || ['p50', 'p90', 'p95', 'p99', 'average'].every((key) => v[key] === null));
const cacheCounts = [
  'requests',
  'cachedRequests',
  'inputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
];
const grain = (v: unknown) => {
  if (!isRecord(v) || !isRecord(v.latency)) return false;
  const l = v.latency;
  if (
    !list(l.times, timestamp) ||
    !list(l.sampleCounts, integer) ||
    !['p50', 'p95', 'p99', 'average'].every((key) => list(l[key], nullable))
  )
    return false;
  const length = l.times.length;
  if (
    !['sampleCounts', 'p50', 'p95', 'p99', 'average'].every(
      (key) => (l[key] as unknown[]).length === length
    )
  )
    return false;
  if (
    !list(
      v.cache,
      (p) =>
        isRecord(p) && timestamp(p.timestampMs) && counts(p, cacheCounts) && nullable(p.cacheRate)
    ) ||
    !list(
      v.errors,
      (p) =>
        isRecord(p) &&
        timestamp(p.timestampMs) &&
        counts(p, ['requests', 'failures']) &&
        nullable(p.failureRate)
    )
  )
    return false;
  const throughputCounts = [
    'outputTokens',
    'decodeDurationMs',
    'outputSamples',
    'averageTokens',
    'averageDurationMs',
    'averageSamples',
    'visibleTokens',
    'visibleDurationMs',
    'visibleSamples',
    'reasoningTokens',
    'reasoningDenominator',
    'reasoningSamples',
  ];
  // Cores released before the throughput series omit the field entirely.
  // Fill an empty series so the chart degrades to "no measurements" instead of
  // rejecting the whole analytics response; a present but malformed series
  // still fails closed.
  if (v.throughput === undefined) {
    v.throughput = (l.times as number[]).map((time) => ({
      timestampMs: time,
      outputTokens: 0,
      decodeDurationMs: 0,
      outputSamples: 0,
      averageTokens: 0,
      averageDurationMs: 0,
      averageSamples: 0,
      visibleTokens: 0,
      visibleDurationMs: 0,
      visibleSamples: 0,
      reasoningTokens: 0,
      reasoningDenominator: 0,
      reasoningSamples: 0,
    }));
  }
  if (
    !list(
      v.throughput,
      (p) => isRecord(p) && timestamp(p.timestampMs) && counts(p, throughputCounts)
    )
  )
    return false;
  return (
    v.cache.length === length &&
    v.errors.length === length &&
    v.throughput.length === length &&
    l.times.every(
      (time, i, times) =>
        (i === 0 || (time as number) > (times[i - 1] as number)) &&
        (v.cache as Record<string, unknown>[])[i].timestampMs === time &&
        (v.errors as Record<string, unknown>[])[i].timestampMs === time &&
        (v.throughput as Record<string, unknown>[])[i].timestampMs === time
    )
  );
};
export function decodeUsageAnalytics(v: unknown): UsageAnalyticsResult {
  const invalid = (): never => {
    throw new Error('Invalid usage analytics response');
  };
  if (
    !isRecord(v) ||
    v.version !== 1 ||
    v.analytics_version !== 1 ||
    typeof v.bound !== 'string' ||
    !v.bound ||
    !number(v.now_ms) ||
    !nullable(v.from_ms) ||
    !nullable(v.to_ms) ||
    typeof v.timezone !== 'string' ||
    !integer(v.total) ||
    !integer(v.analyzed) ||
    v.analyzed > v.total ||
    !isRecord(v.data)
  )
    return invalid();
  const d = v.data;
  if (
    !isRecord(d.timings) ||
    !['latency', 'ttft', 'ttfa', 'firstContent'].every((key) =>
      percentiles((d.timings as Record<string, unknown>)[key])
    ) ||
    !isRecord(d.histogram) ||
    !list(d.histogram.counts, integer, 8) ||
    d.histogram.counts.length !== 8 ||
    !integer(d.histogram.sampleCount)
  )
    return invalid();
  if (
    !isRecord(d.cache) ||
    !counts(d.cache, cacheCounts) ||
    !nullable(d.cache.cacheReadRate) ||
    !nullable(d.cache.cacheHitRequestRatio) ||
    !isRecord(d.errors) ||
    !counts(d.errors, ['totalRequests', 'failedRequests']) ||
    !nullable(d.errors.failureRate)
  )
    return invalid();
  if (
    !list(
      d.errors.byStatus,
      (s) =>
        isRecord(s) &&
        (s.status === null || (integer(s.status) && s.status >= 100 && s.status <= 599)) &&
        ['429', '4xx', '5xx', 'other'].includes(String(s.family)) &&
        integer(s.count) &&
        number(s.share),
      501
    ) ||
    !list(
      d.errors.topReasons,
      (r) => isRecord(r) && typeof r.reason === 'string' && integer(r.count),
      5
    ) ||
    !grain(d.hour) ||
    !grain(d.day)
  )
    return invalid();
  if (
    v.options !== undefined &&
    (!isRecord(v.options) ||
      !list(v.options.models, (m) => typeof m === 'string', 8192) ||
      !list(
        v.options.identities,
        (id) => isRecord(id) && typeof id.source === 'string' && typeof id.auth_index === 'string',
        8192
      ))
  )
    return invalid();
  return v as unknown as UsageAnalyticsResult;
}
export const usageAnalyticsApi = {
  query: async (request: UsageQueryRequest, signal?: AbortSignal) =>
    decodeUsageAnalytics(
      await apiClient.post<unknown>('/usage/query/analytics', request, { signal, timeout: 30_000 })
    ),
};
