/**
 * 错误分析：按 failure_status（上游 HTTP 状态码）与脱敏 failure_reason 聚合，
 * 并给出逐桶失败率趋势。状态码读取口径与 usage.ts extractFailureStatus 一致。
 */

import { buildAnalyticsBuckets, type AnalyticsGrain, type AnalyticsTimeWindow } from './analyticsBuckets';

export type ErrorFamily = '429' | '4xx' | '5xx' | 'other';

export interface ErrorAnalysisRow {
  timestampMs: number;
  failed: boolean;
  failureStatus: number | null;
  failureReason: string | null;
}

const FAILURE_REASON_MAX_LENGTH = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readTimestampMs = (detail: Record<string, unknown>): number | null => {
  const explicitRaw = detail.__timestampMs;
  const explicit =
    typeof explicitRaw === 'number' && Number.isFinite(explicitRaw) && explicitRaw > 0
      ? explicitRaw
      : null;
  if (explicit !== null) return explicit;
  const parsed = typeof detail.timestamp === 'string' ? Date.parse(detail.timestamp) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const readFailureStatus = (detail: Record<string, unknown>): number | null => {
  const raw = detail.failure_status ?? detail.failureStatus ?? detail.FailureStatus;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 599) return null;
  return Math.floor(parsed);
};

const readFailureReason = (detail: Record<string, unknown>): string | null => {
  const raw = detail.failure_reason ?? detail.failureReason ?? detail.FailureReason;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, FAILURE_REASON_MAX_LENGTH);
};

const toRow = (detail: unknown): ErrorAnalysisRow | null => {
  const record = isRecord(detail) ? detail : null;
  if (!record) return null;
  const timestampMs = readTimestampMs(record);
  if (timestampMs === null) return null;
  return {
    timestampMs,
    failed: record.failed === true,
    failureStatus: readFailureStatus(record),
    failureReason: readFailureReason(record),
  };
};

export function collectErrorAnalysisRows(details: Iterable<unknown>): ErrorAnalysisRow[] {
  const rows: ErrorAnalysisRow[] = [];
  for (const detail of details) {
    const row = toRow(detail);
    if (row) rows.push(row);
  }
  return rows;
}

export function classifyFailureStatus(status: number | null): ErrorFamily {
  if (status === 429) return '429';
  if (status !== null && status >= 400 && status < 500) return '4xx';
  if (status !== null && status >= 500 && status < 600) return '5xx';
  return 'other';
}

export interface ErrorStatusGroup {
  status: number | null;
  family: ErrorFamily;
  count: number;
  /** 该状态码失败数 / 总失败数。 */
  share: number;
}

export interface ErrorReasonGroup {
  reason: string;
  count: number;
}

export interface ErrorAnalyticsSummary {
  totalRequests: number;
  failedRequests: number;
  failureRate: number | null;
  /** count 降序；unknown（无状态码）排最后。 */
  byStatus: ErrorStatusGroup[];
  /** count 降序、reason 字典序稳定排序后的前 N 条。 */
  topReasons: ErrorReasonGroup[];
}

export interface ErrorAnalyticsOptions {
  topReasonLimit?: number;
}

export function summarizeErrorAnalytics(
  rows: readonly ErrorAnalysisRow[],
  options: ErrorAnalyticsOptions = {}
): ErrorAnalyticsSummary {
  const topReasonLimit =
    Number.isFinite(options.topReasonLimit) && (options.topReasonLimit ?? 0) > 0
      ? Math.floor(options.topReasonLimit as number)
      : 5;
  let totalRequests = 0;
  let failedRequests = 0;
  const statusCounts = new Map<number, number>();
  const unknownCount = { value: 0 };
  const reasonCounts = new Map<string, number>();

  for (const row of rows) {
    totalRequests += 1;
    if (!row.failed) continue;
    failedRequests += 1;
    if (row.failureStatus !== null) {
      statusCounts.set(row.failureStatus, (statusCounts.get(row.failureStatus) ?? 0) + 1);
    } else {
      unknownCount.value += 1;
    }
    if (row.failureReason !== null) {
      reasonCounts.set(row.failureReason, (reasonCounts.get(row.failureReason) ?? 0) + 1);
    }
  }

  const byStatus: ErrorStatusGroup[] = Array.from(statusCounts.entries())
    .map(([status, count]) => ({
      status,
      family: classifyFailureStatus(status),
      count,
      share: failedRequests > 0 ? count / failedRequests : 0,
    }))
    .sort((a, b) => b.count - a.count || a.status - b.status);
  if (unknownCount.value > 0) {
    byStatus.push({
      status: null,
      family: 'other',
      count: unknownCount.value,
      share: failedRequests > 0 ? unknownCount.value / failedRequests : 0,
    });
  }

  const topReasons: ErrorReasonGroup[] = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, topReasonLimit);

  return {
    totalRequests,
    failedRequests,
    failureRate: totalRequests > 0 ? failedRequests / totalRequests : null,
    byStatus,
    topReasons,
  };
}

export interface FailureTrendPoint {
  timestampMs: number;
  requests: number;
  failures: number;
  failureRate: number | null;
}

export function buildFailureTrendSeries(
  rows: readonly ErrorAnalysisRow[],
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): FailureTrendPoint[] {
  const { times, indexOf } = buildAnalyticsBuckets(rows, grain, window);
  const buckets = times.map(() => ({ requests: 0, failures: 0 }));
  for (const row of rows) {
    const index = indexOf(row.timestampMs);
    if (index < 0) continue;
    buckets[index].requests += 1;
    if (row.failed) buckets[index].failures += 1;
  }
  return times.map((timestampMs, index) => {
    const bucket = buckets[index];
    return {
      timestampMs,
      requests: bucket.requests,
      failures: bucket.failures,
      failureRate: bucket.requests > 0 ? bucket.failures / bucket.requests : null,
    };
  });
}
