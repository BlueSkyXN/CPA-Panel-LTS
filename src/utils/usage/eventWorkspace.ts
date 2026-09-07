import { isUsageTimeRange, type UsageCustomTimeRange, type UsageTimeRange } from './timeRange';

export interface UsageEventsScope {
  range: UsageTimeRange;
  customRange: UsageCustomTimeRange | null;
  valid: boolean;
}

type ScopeStorage = Pick<Storage, 'getItem'>;
const TIME_RANGE_KEY = 'cli-proxy-usage-time-range-v1';
const CUSTOM_RANGE_KEY = 'cli-proxy-usage-custom-time-range-v1';

export function buildUsageEventsSearch(
  range: UsageTimeRange,
  customRange: UsageCustomTimeRange | null
): string {
  const params = new URLSearchParams({ range });
  if (range === 'custom' && customRange) {
    params.set('start', String(customRange.startMs));
    params.set('end', String(customRange.endMs));
  }
  return `?${params.toString()}`;
}

/** Explicit URL scope wins; direct sidebar visits inherit the overview scope. */
export function resolveUsageEventsScope(
  params: URLSearchParams,
  storage?: ScopeStorage
): UsageEventsScope {
  let savedRange: string | null = null;
  let savedCustom: unknown;
  if (!params.has('range')) {
    try {
      savedRange = storage?.getItem(TIME_RANGE_KEY) ?? null;
      const raw = storage?.getItem(CUSTOM_RANGE_KEY);
      savedCustom = raw ? JSON.parse(raw) : null;
    } catch {
      // A blocked/corrupt local store must not prevent direct navigation.
    }
  }
  const rawRange = params.get('range') ?? savedRange;
  const range = isUsageTimeRange(rawRange) ? rawRange : '24h';
  if (range !== 'custom') return { range, customRange: null, valid: true };

  let startMs = NaN;
  let endMs = NaN;
  if (params.has('range')) {
    const start = params.get('start');
    const end = params.get('end');
    if (start?.trim() && end?.trim()) {
      startMs = Number(start);
      endMs = Number(end);
    }
  } else if (savedCustom && typeof savedCustom === 'object') {
    const draft = savedCustom as Record<string, unknown>;
    if (typeof draft.start === 'string' && typeof draft.end === 'string') {
      startMs = Date.parse(draft.start);
      endMs = Date.parse(draft.end);
    }
  }
  const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs &&
    Number.isFinite(new Date(startMs).getTime()) && Number.isFinite(new Date(endMs).getTime());
  return { range, customRange: valid ? { startMs, endMs } : null, valid };
}
