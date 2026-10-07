/**
 * 延迟分析聚合：按小时/天分桶的分位数序列、延迟直方图、TTFT/TTFA 摘要。
 *
 * 口径：延迟/首内容分位数只统计成功请求（生成延迟语义）；失败请求的
 * 时序归 errorAnalytics 负责。
 */

import { buildAnalyticsBuckets, type AnalyticsGrain, type AnalyticsTimeWindow } from './analyticsBuckets';
export type { AnalyticsGrain, AnalyticsTimeWindow } from './analyticsBuckets';

export interface PercentileSummary {
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  average: number | null;
  sampleCount: number;
}

export interface LatencyAnalysisRow {
  timestampMs: number;
  latencyMs: number | null;
  ttfbMs: number | null;
  ttftMs: number | null;
  ttfaMs: number | null;
  failed: boolean;
}

const SEMANTIC_TIMING_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readNonNegativeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const readTimestampMs = (detail: Record<string, unknown>): number | null => {
  const explicit = readNonNegativeNumber(detail.__timestampMs);
  if (explicit !== null && explicit > 0) return explicit;
  const parsed = typeof detail.timestamp === 'string' ? Date.parse(detail.timestamp) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const extractSemanticTimingMs = (
  detail: Record<string, unknown>,
  field: string
): number | null => {
  const version = readNonNegativeNumber(detail.timing_version);
  if (version === null || !Number.isSafeInteger(version) || version !== SEMANTIC_TIMING_VERSION) {
    return null;
  }
  return readNonNegativeNumber(detail[field]);
};

/** 与 performance.ts normalizeSemanticTimingMs 相同的因果校验。 */
const validateSemanticTimingMs = (
  timing: number | null,
  latencyMs: number | null,
  ttfbMs: number | null
): number | null => {
  if (timing === null || latencyMs === null || ttfbMs === null) return null;
  if (timing < ttfbMs || timing > latencyMs) return null;
  return timing;
};

const toRow = (detail: unknown): LatencyAnalysisRow | null => {
  const record = isRecord(detail) ? detail : null;
  if (!record) return null;
  const timestampMs = readTimestampMs(record);
  if (timestampMs === null) return null;
  const latencyMs = readNonNegativeNumber(record.latency_ms);
  const ttfbMs = readNonNegativeNumber(record.ttfb_ms);
  const ttftMs = validateSemanticTimingMs(
    extractSemanticTimingMs(record, 'ttft_ms'),
    latencyMs,
    ttfbMs
  );
  const ttfaMs = validateSemanticTimingMs(
    extractSemanticTimingMs(record, 'ttfa_ms'),
    latencyMs,
    ttfbMs
  );
  return { timestampMs, latencyMs, ttfbMs, ttftMs, ttfaMs, failed: record.failed === true };
};

export function collectLatencyAnalysisRows(details: Iterable<unknown>): LatencyAnalysisRow[] {
  const rows: LatencyAnalysisRow[] = [];
  for (const detail of details) {
    const row = toRow(detail);
    if (row) rows.push(row);
  }
  return rows;
}

// ---- nearest-rank 分位数（与 ./percentiles.ts 语义一致） ----

const sortValidSamples = (samples: readonly number[]): number[] => {
  const valid = samples.filter((value) => Number.isFinite(value) && value >= 0);
  valid.sort((a, b) => a - b);
  return valid;
};

const percentileFromSorted = (
  sorted: readonly number[],
  rank: number
): number | null => {
  if (!sorted.length) return null;
  const parsed = Number(rank);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return null;
  const index = Math.min(
    Math.max(Math.ceil((parsed / 100) * sorted.length) - 1, 0),
    sorted.length - 1
  );
  return sorted[index];
};

const summarizeSortedSamples = (sorted: readonly number[]): PercentileSummary => {
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    p50: percentileFromSorted(sorted, 50),
    p90: percentileFromSorted(sorted, 90),
    p95: percentileFromSorted(sorted, 95),
    p99: percentileFromSorted(sorted, 99),
    average: sorted.length > 0 ? total / sorted.length : null,
    sampleCount: sorted.length,
  };
};

// ---- 直方图 ----

/** 对数感 bucket 下界（ms）；最后一桶为开区间。 */
export const LATENCY_HISTOGRAM_EDGE_MS: readonly number[] = [
  0, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
];

export interface LatencyHistogram {
  /** counts[i] = [edges[i], edges[i+1]) 内的成功样本数；末桶无上界。 */
  counts: number[];
  sampleCount: number;
}

export function buildLatencyHistogram(rows: readonly LatencyAnalysisRow[]): LatencyHistogram {
  const counts = new Array<number>(LATENCY_HISTOGRAM_EDGE_MS.length).fill(0);
  let sampleCount = 0;
  for (const row of rows) {
    if (row.failed || row.latencyMs === null) continue;
    let assigned = false;
    for (let i = LATENCY_HISTOGRAM_EDGE_MS.length - 1; i >= 0 && !assigned; i--) {
      if (row.latencyMs >= LATENCY_HISTOGRAM_EDGE_MS[i]) {
        counts[i] += 1;
        sampleCount += 1;
        assigned = true;
      }
    }
  }
  return { counts, sampleCount };
}

// ---- 分桶分位数序列 ----

export interface LatencyPercentileSeries {
  /** 桶起点 epoch ms，由 UI 层用既有 hour/day label formatter 渲染。 */
  times: number[];
  sampleCounts: number[];
  p50: (number | null)[];
  p95: (number | null)[];
  p99: (number | null)[];
  average: (number | null)[];
}

export function buildLatencyPercentileSeries(
  rows: readonly LatencyAnalysisRow[],
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): LatencyPercentileSeries {
  const buckets = buildAnalyticsBuckets(rows, grain, window);
  const samplesPerBucket = Array.from({ length: buckets.times.length }, () => [] as number[]);
  for (const row of rows) {
    if (row.failed || row.latencyMs === null) continue;
    const index = buckets.indexOf(row.timestampMs);
    if (index < 0) continue;
    samplesPerBucket[index].push(row.latencyMs);
  }
  const sortedPerBucket = samplesPerBucket.map(sortValidSamples);
  return {
    times: buckets.times,
    sampleCounts: sortedPerBucket.map((sorted) => sorted.length),
    p50: sortedPerBucket.map((sorted) => percentileFromSorted(sorted, 50)),
    p95: sortedPerBucket.map((sorted) => percentileFromSorted(sorted, 95)),
    p99: sortedPerBucket.map((sorted) => percentileFromSorted(sorted, 99)),
    average: sortedPerBucket.map((sorted) =>
      sorted.length > 0 ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null
    ),
  };
}

// ---- 窗口级摘要 ----

export interface LatencyTimingSummaries {
  latency: PercentileSummary;
  ttft: PercentileSummary;
  ttfa: PercentileSummary;
  /** 首个有效内容时间 = min(ttft, ttfa) 的已观测较早值。 */
  firstContent: PercentileSummary;
}

export function summarizeLatencyRows(rows: readonly LatencyAnalysisRow[]): LatencyTimingSummaries {
  const latency: number[] = [];
  const ttft: number[] = [];
  const ttfa: number[] = [];
  const firstContent: number[] = [];
  for (const row of rows) {
    if (row.failed) continue;
    if (row.latencyMs !== null) latency.push(row.latencyMs);
    if (row.ttftMs !== null) ttft.push(row.ttftMs);
    if (row.ttfaMs !== null) ttfa.push(row.ttfaMs);
    if (row.ttftMs !== null || row.ttfaMs !== null) {
      firstContent.push(
        row.ttftMs !== null && row.ttfaMs !== null
          ? Math.min(row.ttftMs, row.ttfaMs)
          : (row.ttftMs ?? row.ttfaMs ?? 0)
      );
    }
  }
  return {
    latency: summarizeSortedSamples(sortValidSamples(latency)),
    ttft: summarizeSortedSamples(sortValidSamples(ttft)),
    ttfa: summarizeSortedSamples(sortValidSamples(ttfa)),
    firstContent: summarizeSortedSamples(sortValidSamples(firstContent)),
  };
}
