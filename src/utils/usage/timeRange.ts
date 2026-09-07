/** Pure time-window selection and detail-derived summaries; no UI/i18n dependencies. */
import { parseTimestampMs } from '../timestamp';
import { resolveUsageTotalTokens } from './cacheTokens';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const getApisRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) && isRecord(value.apis) ? value.apis : null;

export type UsageTimeRange =
  | '1h'
  | '3h'
  | '6h'
  | '12h'
  | '24h'
  | '48h'
  | '7d'
  | '14d'
  | '30d'
  | '90d'
  | 'custom'
  | 'all';

export type UsagePresetTimeRange = Exclude<UsageTimeRange, 'custom' | 'all'>;

// 自定义时间范围（绝对起止时间戳，毫秒）
export interface UsageCustomTimeRange {
  startMs: number;
  endMs: number;
}

// 时间范围选择：预设区间或自定义起止窗口
export type UsageTimeRangeSelection = UsageTimeRange | UsageCustomTimeRange;

export interface UsageTimeWindow {
  startMs: number;
  endMs: number;
}

const USAGE_TIME_RANGE_MS: Record<UsagePresetTimeRange, number> = {
  '1h': 1 * 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export const USAGE_PRESET_TIME_RANGES: ReadonlyArray<UsagePresetTimeRange> = [
  '1h',
  '3h',
  '6h',
  '12h',
  '24h',
  '48h',
  '7d',
  '14d',
  '30d',
  '90d',
];

export const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === 'all' ||
  value === 'custom' ||
  USAGE_PRESET_TIME_RANGES.some((candidate) => candidate === value);

export const isUsageCustomTimeRange = (value: unknown): value is UsageCustomTimeRange => {
  if (!isRecord(value)) {
    return false;
  }
  const { startMs, endMs } = value as { startMs: unknown; endMs: unknown };
  return (
    typeof startMs === 'number' &&
    Number.isFinite(startMs) &&
    typeof endMs === 'number' &&
    Number.isFinite(endMs) &&
    endMs > startMs
  );
};

// 将时间范围选择解析为绝对窗口；'all' 或无有效的自定义范围时返回 null（表示不过滤）
export const resolveUsageTimeRangeWindow = (
  range: UsageTimeRangeSelection,
  nowMs: number
): UsageTimeWindow | null => {
  if (isUsageCustomTimeRange(range)) {
    return { startMs: range.startMs, endMs: range.endMs };
  }
  if (!isUsageTimeRange(range) || range === 'all' || range === 'custom') {
    return null;
  }
  const rangeMs = USAGE_TIME_RANGE_MS[range];
  return { startMs: nowMs - rangeMs, endMs: nowMs };
};

// 供按小时聚合的图表使用的时间窗口跨度（小时）；null 窗口（全部）返回 undefined
export const usageTimeRangeWindowHours = (
  window: UsageTimeWindow | null
): number | undefined =>
  window ? Math.max(1, Math.round((window.endMs - window.startMs) / (60 * 60 * 1000))) : undefined;

interface UsageSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
}

const createUsageSummary = (): UsageSummary => ({
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  totalTokens: 0,
});

const toUsageSummaryFields = (summary: UsageSummary) => ({
  total_requests: summary.totalRequests,
  success_count: summary.successCount,
  failure_count: summary.failureCount,
  total_tokens: summary.totalTokens,
});

export function filterUsageByTimeRange<T>(
  usageData: T,
  range: UsageTimeRangeSelection,
  nowMs: number = Date.now()
): T {
  if (isUsageTimeRange(range) && range === 'all') {
    return usageData;
  }

  const usageRecord = isRecord(usageData) ? usageData : null;
  const apis = getApisRecord(usageData);
  if (!usageRecord || !apis) {
    return usageData;
  }

  const window = resolveUsageTimeRangeWindow(range, nowMs);
  if (!window) {
    return usageData;
  }

  const windowStart = window.startMs;
  const windowEnd = window.endMs;
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) {
    return usageData;
  }
  const filteredApis: Record<string, unknown> = {};
  const totalSummary = createUsageSummary();

  Object.entries(apis).forEach(([apiName, apiEntry]) => {
    if (!isRecord(apiEntry)) {
      return;
    }

    const models = isRecord(apiEntry.models) ? apiEntry.models : null;
    if (!models) {
      return;
    }

    const filteredModels: Record<string, unknown> = {};
    const apiSummary = createUsageSummary();
    let hasModelData = false;

    Object.entries(models).forEach(([modelName, modelEntry]) => {
      if (!isRecord(modelEntry)) {
        return;
      }

      const detailsRaw = Array.isArray(modelEntry.details) ? modelEntry.details : [];
      const modelSummary = createUsageSummary();
      const filteredDetails: unknown[] = [];

      detailsRaw.forEach((detail) => {
        const detailRecord = isRecord(detail) ? detail : null;
        if (!detailRecord || typeof detailRecord.timestamp !== 'string') {
          return;
        }
        const timestamp = parseTimestampMs(detailRecord.timestamp);
        if (
          Number.isNaN(timestamp) ||
          timestamp < windowStart ||
          timestamp > windowEnd
        ) {
          return;
        }

        filteredDetails.push(detail);
        modelSummary.totalRequests += 1;
        if (detailRecord.failed === true) {
          modelSummary.failureCount += 1;
        } else {
          modelSummary.successCount += 1;
        }
        modelSummary.totalTokens += resolveUsageTotalTokens(isRecord(detailRecord.tokens) ? detailRecord.tokens : {}, modelName);
      });

      if (!filteredDetails.length) {
        return;
      }

      filteredModels[modelName] = {
        ...modelEntry,
        ...toUsageSummaryFields(modelSummary),
        details: filteredDetails,
      };
      hasModelData = true;

      apiSummary.totalRequests += modelSummary.totalRequests;
      apiSummary.successCount += modelSummary.successCount;
      apiSummary.failureCount += modelSummary.failureCount;
      apiSummary.totalTokens += modelSummary.totalTokens;
    });

    if (!hasModelData) {
      return;
    }

    filteredApis[apiName] = {
      ...apiEntry,
      ...toUsageSummaryFields(apiSummary),
      models: filteredModels,
    };

    totalSummary.totalRequests += apiSummary.totalRequests;
    totalSummary.successCount += apiSummary.successCount;
    totalSummary.failureCount += apiSummary.failureCount;
    totalSummary.totalTokens += apiSummary.totalTokens;
  });

  return {
    ...usageRecord,
    ...toUsageSummaryFields(totalSummary),
    apis: filteredApis,
  } as T;
}
