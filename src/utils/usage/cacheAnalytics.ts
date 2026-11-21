import type { CacheObservation } from '@/types/cacheDiagnostics';
import { readCacheObservation } from './cacheDiagnostics';
import { buildAnalyticsBuckets, type AnalyticsGrain, type AnalyticsTimeWindow } from './analyticsBuckets';

export const CACHE_STATES = ['positive', 'zero', 'unknown'] as const;
export type CacheValueState = (typeof CACHE_STATES)[number];

export const isCacheValueState = (value: unknown): value is CacheValueState =>
  CACHE_STATES.some((state) => state === value);

export function cacheValueState(field?: CacheObservation['read']): CacheValueState {
  if (field?.state !== 'present' || field.value === undefined) return 'unknown';
  return field.value === 0 ? 'zero' : 'positive';
}

export interface ObservedCacheAnalytics {
  read: Record<CacheValueState, number>;
  write: Record<CacheValueState, number>;
  inputTokens: number;
  readTokens: number;
  rate: number | null;
}

function newObservedCache(): ObservedCacheAnalytics {
  return {
    read: { positive: 0, zero: 0, unknown: 0 },
    write: { positive: 0, zero: 0, unknown: 0 },
    inputTokens: 0,
    readTokens: 0,
    rate: null,
  };
}

function addObservedCache(totals: ObservedCacheAnalytics, row: CacheAnalysisRow) {
  const read = row.observation?.read.value;
  totals.read[cacheValueState(row.observation?.read)]++;
  totals.write[cacheValueState(row.observation?.write)]++;
  if (read !== undefined && row.inputTokens > 0 && read <= row.inputTokens) {
    totals.inputTokens += row.inputTokens;
    totals.readTokens += read;
  }
}

export interface CacheAnalysisRow {
  timestampMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  observation?: CacheObservation;
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

const toRow = (detail: unknown, includeUndated: boolean): CacheAnalysisRow | null => {
  const record = isRecord(detail) ? detail : null;
  if (!record) return null;
  const timestampMs = readTimestampMs(record);
  if (timestampMs === null && !includeUndated) return null;
  const tokens = isRecord(record.tokens) ? record.tokens : {};
  const explicitRead = toOptionalTokenCount(tokens.cache_read_tokens);
  const cachedMirror = toOptionalTokenCount(tokens.cached_tokens);
  return {
    timestampMs: timestampMs ?? 0,
    inputTokens: toTokenCount(tokens.input_tokens),
    cacheReadTokens: explicitRead ?? cachedMirror ?? 0,
    cacheWriteTokens: toTokenCount(tokens.cache_creation_tokens),
    observation: readCacheObservation(record.cache_observation),
  };
};

export function collectCacheAnalysisRows(
  details: Iterable<unknown>,
  { includeUndated = false }: { includeUndated?: boolean } = {}
): CacheAnalysisRow[] {
  const rows: CacheAnalysisRow[] = [];
  for (const detail of details) {
    const row = toRow(detail, includeUndated);
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
  observed?: ObservedCacheAnalytics;
}

interface CacheBucketAccumulator {
  requests: number;
  cachedRequests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  observed: ObservedCacheAnalytics;
}

const finalizeCachePoint = (
  timestampMs: number,
  accumulator: CacheBucketAccumulator
): CacheTrendPoint => ({
  timestampMs,
  ...accumulator,
  cacheRate:
    accumulator.inputTokens > 0 ? accumulator.cacheReadTokens / accumulator.inputTokens : null,
  observed: {
    ...accumulator.observed,
    rate: accumulator.observed.inputTokens > 0
      ? accumulator.observed.readTokens / accumulator.observed.inputTokens
      : null,
  },
});

export function buildCacheTrendSeries(
  rows: readonly CacheAnalysisRow[],
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): CacheTrendPoint[] {
  const timedRows = rows.filter((row) => row.timestampMs > 0);
  const { times, indexOf } = buildAnalyticsBuckets(timedRows, grain, window);
  const accumulators = times.map((): CacheBucketAccumulator => ({
    requests: 0,
    cachedRequests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    observed: newObservedCache(),
  }));
  for (const row of timedRows) {
    const index = indexOf(row.timestampMs);
    if (index < 0) continue;
    const accumulator = accumulators[index];
    accumulator.requests += 1;
    if (row.cacheReadTokens > 0) accumulator.cachedRequests += 1;
    accumulator.inputTokens += row.inputTokens;
    accumulator.cacheReadTokens += row.cacheReadTokens;
    accumulator.cacheWriteTokens += row.cacheWriteTokens;
    addObservedCache(accumulator.observed, row);
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
  observed?: ObservedCacheAnalytics;
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
    observed: newObservedCache(),
  };
  for (const row of rows) {
    addObservedCache(totals.observed, row);
    if (row.timestampMs <= 0) continue;
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
    observed: finalized.observed,
  };
}
