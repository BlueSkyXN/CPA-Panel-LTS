export interface AnalyticsTimeWindow {
  startMs: number;
  endMs: number;
}

export type AnalyticsGrain = 'hour' | 'day';

const MAX_PADDED_BUCKETS = 24 * 90 + 1;

const floorToGrain = (timestampMs: number, grain: AnalyticsGrain): number => {
  const date = new Date(timestampMs);
  if (grain === 'day') date.setHours(0, 0, 0, 0);
  else date.setMinutes(0, 0, 0);
  return date.getTime();
};

const nextBucket = (timestampMs: number, grain: AnalyticsGrain): number => {
  const date = new Date(timestampMs);
  // Local days can have 23 or 25 hours across daylight-saving transitions.
  if (grain === 'day') date.setDate(date.getDate() + 1);
  else date.setHours(date.getHours() + 1);
  return floorToGrain(date.getTime(), grain);
};

export function buildAnalyticsBuckets(
  rows: readonly { timestampMs: number }[],
  grain: AnalyticsGrain,
  window?: AnalyticsTimeWindow | null
): { times: number[]; indexOf: (timestampMs: number) => number } {
  const inWindow = (timestampMs: number): boolean =>
    Number.isFinite(timestampMs) &&
    timestampMs > 0 &&
    (!window || (timestampMs >= window.startMs && timestampMs <= window.endMs));
  let first = Infinity;
  let last = -Infinity;
  const observed = new Set<number>();
  for (const row of rows) {
    if (!inWindow(row.timestampMs)) continue;
    first = Math.min(first, row.timestampMs);
    last = Math.max(last, row.timestampMs);
    observed.add(floorToGrain(row.timestampMs, grain));
  }
  const start = floorToGrain(window ? window.startMs : first, grain);
  const end = floorToGrain(window ? window.endMs : last, grain);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return { times: [], indexOf: () => -1 };
  }
  let times: number[] = [];
  let cursor = start;
  while (cursor <= end && times.length <= MAX_PADDED_BUCKETS) {
    times.push(cursor);
    const next = nextBucket(cursor, grain);
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
  }
  if (times.length > MAX_PADDED_BUCKETS) {
    observed.add(start);
    observed.add(end);
    times = Array.from(observed).sort((a, b) => a - b);
  }
  const indexes = new Map(times.map((timestampMs, index) => [timestampMs, index]));
  return {
    times,
    indexOf: (timestampMs: number) =>
      inWindow(timestampMs) ? (indexes.get(floorToGrain(timestampMs, grain)) ?? -1) : -1,
  };
}
