import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';

/** 一个可下钻的时间桶：[startMs, endMs]，两端均含，与 Core 的 from_ms/to_ms 闭区间一致。 */
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
  if (!Number.isInteger(index) || index < 0) return null;
  const bucketStart = times[index];
  if (!Number.isFinite(bucketStart) || bucketStart <= 0) return null;
  const advanced = nextBucketStart(bucketStart, grain);
  if (!Number.isFinite(advanced) || advanced <= bucketStart) return null;
  const next = times[index + 1];
  // 高基数窗口可能省略空桶，不能把下一观测桶之前的空档并入当前桶。
  const endExclusive =
    Number.isFinite(next) && next > bucketStart ? Math.min(next, advanced) : advanced;
  let startMs = bucketStart;
  let endMs = endExclusive - 1;
  if (window) {
    if (
      !Number.isFinite(window.startMs) ||
      !Number.isFinite(window.endMs) ||
      window.startMs > window.endMs
    )
      return null;
    startMs = Math.max(startMs, window.startMs);
    endMs = Math.min(endMs, window.endMs);
  }
  return endMs >= startMs ? { startMs, endMs } : null;
}
