/**
 * 吞吐趋势：按小时/天分桶累计与 QueryMetrics 相同的分子分母。
 *
 * 口径与 Core analyticsAddThroughput 一致：有输出 token 且总耗时为正的请求计入
 * 端到端平均序列；显式测量过首包时间且首包早于完成的请求计入解码窗口序列；
 * reasoning token 不超过输出 token 的请求计入可见序列。失败请求同样计入，
 * 与 /usage/query 的 TPS 一致，不套用延迟分位数的“仅成功”口径。
 * 速率 = 分子 / 分母 × 1000（token/秒）；分母为零表示该桶没有可测样本。
 */

import { buildAnalyticsBuckets, type AnalyticsGrain, type AnalyticsTimeWindow } from './analyticsBuckets';
import { extractTimingVersion, SEMANTIC_TIMING_VERSION } from './performance';

export interface ThroughputTrendPoint {
  timestampMs: number;
  outputTokens: number;
  decodeDurationMs: number;
  outputSamples: number;
  averageTokens: number;
  averageDurationMs: number;
  averageSamples: number;
  visibleTokens: number;
  visibleDurationMs: number;
  visibleSamples: number;
  reasoningTokens: number;
  reasoningDenominator: number;
  reasoningSamples: number;
}

interface ThroughputRow {
  timestampMs: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  ttfbMs: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readTimestampMs = (detail: Record<string, unknown>): number | null => {
  const explicit = readNumber(detail.__timestampMs);
  if (explicit !== null && explicit > 0) return explicit;
  const parsed = typeof detail.timestamp === 'string' ? Date.parse(detail.timestamp) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toRow = (detail: unknown): ThroughputRow | null => {
  const record = isRecord(detail) ? detail : null;
  if (!record) return null;
  const timestampMs = readTimestampMs(record);
  const latencyMs = readNumber(record.latency_ms);
  if (timestampMs === null || latencyMs === null || latencyMs < 0) return null;
  const tokens = isRecord(record.tokens) ? record.tokens : {};
  const ttfbMs =
    extractTimingVersion(record) === SEMANTIC_TIMING_VERSION ? readNumber(record.ttfb_ms) : null;
  return {
    timestampMs,
    outputTokens: Math.max(readNumber(tokens.output_tokens) ?? 0, 0),
    reasoningTokens: Math.max(readNumber(tokens.reasoning_tokens) ?? 0, 0),
    latencyMs,
    // 显式零测量保留为 0；字段缺失或非法保持 null，两者不能混为一谈。
    ttfbMs: ttfbMs !== null && ttfbMs >= 0 ? ttfbMs : null,
  };
};

const emptyPoint = (timestampMs: number): ThroughputTrendPoint => ({
  timestampMs,
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
});

export function buildThroughputTrendSeries(
  details: Iterable<unknown>,
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): ThroughputTrendPoint[] {
  const rows: ThroughputRow[] = [];
  for (const detail of details) {
    const row = toRow(detail);
    if (row) rows.push(row);
  }
  const { times, indexOf } = buildAnalyticsBuckets(rows, grain, window);
  const points = times.map((timestampMs) => emptyPoint(timestampMs));
  for (const row of rows) {
    const index = indexOf(row.timestampMs);
    if (index < 0 || row.outputTokens <= 0 || row.latencyMs <= 0) continue;
    const point = points[index];
    point.averageTokens += row.outputTokens;
    point.averageDurationMs += row.latencyMs;
    point.averageSamples += 1;
    if (row.ttfbMs !== null && row.latencyMs > row.ttfbMs) {
      point.outputTokens += row.outputTokens;
      point.decodeDurationMs += row.latencyMs - row.ttfbMs;
      point.outputSamples += 1;
    }
    if (row.reasoningTokens <= row.outputTokens) {
      point.visibleTokens += row.outputTokens - row.reasoningTokens;
      point.visibleDurationMs += row.latencyMs;
      point.visibleSamples += 1;
      point.reasoningTokens += row.reasoningTokens;
      point.reasoningDenominator += row.outputTokens;
      point.reasoningSamples += 1;
    }
  }
  return points;
}

/** 桶内速率（token/秒）；没有可测样本时返回 null，而不是 0。 */
export const throughputRate = (numerator: number, denominatorMs: number): number | null =>
  denominatorMs > 0 ? (numerator * 1000) / denominatorMs : null;
