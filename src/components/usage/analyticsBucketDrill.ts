import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';

/** 一个可下钻的时间桶：[startMs, endMs)，endMs 为下一桶起点或窗口终点。 */
export interface AnalyticsBucketRange {
  startMs: number;
  endMs: number;
}

const floorToGrain = (timestampMs: number, grain: AnalyticsGrain): number => {
  const date = new Date(timestampMs);
  if (grain === 'day') date.setHours(0, 0, 0, 0);
  else date.setMinutes(0, 0, 0);
  return date.getTime();
};

const nextBucketStart = (timestampMs: number, grain: AnalyticsGrain): number => {
  const date = new Date(timestampMs);
  // 本地日可能因夏令时为 23/25 小时；与 analyticsBuckets 的推进规则一致。
  if (grain === 'day') date.setDate(date.getDate() + 1);
  else date.setHours(date.getHours() + 1);
  return floorToGrain(date.getTime(), grain);
};

/**
 * 把趋势图第 index 个时间桶换算为绝对窗口。
 * times 来自 AnalyticsGrain 序列（latency/cache/errors/throughput 共用），
 * 与 buildAnalyticsBuckets 的桶起点对齐；返回 null 表示无法构成有效区间。
 */
export function bucketRangeAt(
  times: readonly number[],
  index: number,
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): AnalyticsBucketRange | null {
  const start = times[index];
  if (!Number.isFinite(start) || start <= 0) return null;
  const next = times[index + 1];
  const end = Number.isFinite(next) && next > start ? next : nextBucketStart(start, grain);
  if (!Number.isFinite(end) || end <= start) return null;
  // 窗口内最后一个桶可能超出 endMs（例如自定义窗口止于桶中间）；
  // 与 Core 的 from_ms/to_ms 闭区间语义对齐，收敛到窗口终点。
  const endMs = window ? Math.min(end, Math.max(window.endMs, start)) : end;
  return { startMs: start, endMs };
}
