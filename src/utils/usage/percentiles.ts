/**
 * nearest-rank 分位数工具。样本只保留有限非负数；空集合返回 null。
 * 选择 nearest-rank 而非线性插值：结果总是真实样本值，便于直方图对账。
 */

export interface PercentileSummary {
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  average: number | null;
  sampleCount: number;
}

export function sortValidSamples(samples: readonly number[]): number[] {
  const valid = samples.filter((value) => Number.isFinite(value) && value >= 0);
  valid.sort((a, b) => a - b);
  return valid;
}

/**
 * 对已升序排序的样本取 nearest-rank 分位数：index = ceil(p/100 * n) - 1。
 * rank 超出 (0, 100] 或样本为空时返回 null。
 */
export function percentileFromSorted(
  sorted: readonly number[],
  rank: number
): number | null {
  if (!sorted.length) return null;
  const parsed = Number(rank);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return null;
  const index = Math.min(
    Math.max(Math.ceil((parsed / 100) * sorted.length) - 1, 0),
    sorted.length - 1
  );
  return sorted[index];
}

export function summarizeSamples(samples: readonly number[]): PercentileSummary {
  const sorted = sortValidSamples(samples);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    p50: percentileFromSorted(sorted, 50),
    p90: percentileFromSorted(sorted, 90),
    p95: percentileFromSorted(sorted, 95),
    p99: percentileFromSorted(sorted, 99),
    average: sorted.length > 0 ? total / sorted.length : null,
    sampleCount: sorted.length,
  };
}
