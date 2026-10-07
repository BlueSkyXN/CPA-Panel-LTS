/**
 * 缓存效率分析：cache-read rate 逐桶趋势与窗口级汇总。
 *
 * 口径与 usage.ts getModelStats.cacheRate 保持一致：
 * cache rate = cache_read_tokens / input_tokens（input 已含 cache read/write）。
 * cached_requests 统计 cache_read_tokens > 0 的请求数。
 */

import { buildAnalyticsBuckets, type AnalyticsGrain, type AnalyticsTimeWindow } from './analyticsBuckets';

export interface CacheAnalysisRow {
  timestampMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toOptionalTokenCount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
};

const toTokenCount = (value: unknown): number => toOptionalTokenCount(value) ?? 0;

const readTimestampMs = (detail: Record<string, unknown>): number | null => {
  const explicit = toOptionalTokenCount(detail.__timestampMs);
  if (explicit !== null && explicit > 0) return explicit;
  const parsed = typeof detail.timestamp === 'string' ? Date.parse(detail.timestamp) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toRow = (detail: unknown): CacheAnalysisRow | null => {
  const record = isRecord(detail) ? detail : null;
  if (!record) return null;
  const timestampMs = readTimestampMs(record);
  if (timestampMs === null) return null;
  const tokens = isRecord(record.tokens) ? record.tokens : {};
  const explicitRead = toOptionalTokenCount(tokens.cache_read_tokens);
  const cachedMirror = toOptionalTokenCount(tokens.cached_tokens);
  return {
    timestampMs,
    inputTokens: toTokenCount(tokens.input_tokens),
    cacheReadTokens: explicitRead ?? cachedMirror ?? 0,
    cacheWriteTokens: toTokenCount(tokens.cache_creation_tokens),
  };
};

export function collectCacheAnalysisRows(details: Iterable<unknown>): CacheAnalysisRow[] {
  const rows: CacheAnalysisRow[] = [];
  for (const detail of details) {
    const row = toRow(detail);
    if (row) rows.push(row);
  }
  return rows;
}

export interface CacheTrendPoint {
  timestampMs: number;
  requests: number;
  cachedRequests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheRate: number | null;
}

interface CacheBucketAccumulator {
  requests: number;
  cachedRequests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const finalizeCachePoint = (
  timestampMs: number,
  accumulator: CacheBucketAccumulator
): CacheTrendPoint => ({
  timestampMs,
  ...accumulator,
  cacheRate:
    accumulator.inputTokens > 0 ? accumulator.cacheReadTokens / accumulator.inputTokens : null,
});

export function buildCacheTrendSeries(
  rows: readonly CacheAnalysisRow[],
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): CacheTrendPoint[] {
  const { times, indexOf } = buildAnalyticsBuckets(rows, grain, window);
  const accumulators = times.map((): CacheBucketAccumulator => ({
    requests: 0,
    cachedRequests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }));
  for (const row of rows) {
    const index = indexOf(row.timestampMs);
    if (index < 0) continue;
    const accumulator = accumulators[index];
    accumulator.requests += 1;
    if (row.cacheReadTokens > 0) accumulator.cachedRequests += 1;
    accumulator.inputTokens += row.inputTokens;
    accumulator.cacheReadTokens += row.cacheReadTokens;
    accumulator.cacheWriteTokens += row.cacheWriteTokens;
  }
  return times.map((timestampMs, index) => finalizeCachePoint(timestampMs, accumulators[index]));
}

export interface CacheAnalyticsSummary {
  requests: number;
  cachedRequests: number;
  cacheHitRequestRatio: number | null;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheReadRate: number | null;
}

export function summarizeCacheAnalytics(
  rows: readonly CacheAnalysisRow[]
): CacheAnalyticsSummary {
  const totals: CacheBucketAccumulator = {
    requests: 0,
    cachedRequests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const row of rows) {
    totals.requests += 1;
    if (row.cacheReadTokens > 0) totals.cachedRequests += 1;
    totals.inputTokens += row.inputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
  }
  const finalized = finalizeCachePoint(0, totals);
  return {
    requests: finalized.requests,
    cachedRequests: finalized.cachedRequests,
    cacheHitRequestRatio:
      finalized.requests > 0 ? finalized.cachedRequests / finalized.requests : null,
    inputTokens: finalized.inputTokens,
    cacheReadTokens: finalized.cacheReadTokens,
    cacheWriteTokens: finalized.cacheWriteTokens,
    cacheReadRate: finalized.cacheRate,
  };
}
