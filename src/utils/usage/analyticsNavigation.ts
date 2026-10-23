import { isRecord } from '@/utils/helpers';
import { decodeUsageQuerySession } from '@/services/api/usageQuery';
import type { UsageQuerySession } from '@/types/usageQuery';
import type { AnalyticsGrain, AnalyticsTimeWindow } from './analyticsBuckets';
import { readAnalyticsNavigationState, type AnalyticsFilters } from './analyticsFilters';

export interface AnalyticsReturnContext {
  pathname: '/analytics/observability';
  search: string;
  connection: string;
  filters: AnalyticsFilters;
  grain: AnalyticsGrain;
  timeWindow: AnalyticsTimeWindow | null;
  session: UsageQuerySession | null;
  scrollTop: number;
  focusId: string | null;
}

const focusIds = new Set([
  'analytics-open-details',
  'analytics-summary-failures',
  ...['latency', 'throughput', 'cache', 'errors'].flatMap((name) => [
    `analytics-${name}-bucket`,
    `analytics-${name}-bucket-open`,
  ]),
]);

export function readAnalyticsReturnContext(
  value: unknown,
  connection: string
): AnalyticsReturnContext | null {
  if (
    !isRecord(value) ||
    value.pathname !== '/analytics/observability' ||
    typeof value.search !== 'string' ||
    (value.search !== '' && !value.search.startsWith('?')) ||
    value.connection !== connection ||
    !['hour', 'day'].includes(String(value.grain)) ||
    typeof value.scrollTop !== 'number' ||
    !Number.isFinite(value.scrollTop) ||
    value.scrollTop < 0
  )
    return null;
  const filters = readAnalyticsNavigationState({ analyticsFilters: value.filters });
  if (!filters) return null;
  const timeWindow = value.timeWindow;
  if (
    timeWindow !== null &&
    (!isRecord(timeWindow) ||
      typeof timeWindow.startMs !== 'number' ||
      typeof timeWindow.endMs !== 'number' ||
      !Number.isSafeInteger(timeWindow.startMs) ||
      !Number.isSafeInteger(timeWindow.endMs) ||
      timeWindow.startMs < 0 ||
      timeWindow.endMs < timeWindow.startMs)
  )
    return null;
  let session: UsageQuerySession | null = null;
  if (value.session !== null) {
    try {
      session = decodeUsageQuerySession(value.session);
    } catch {
      return null;
    }
  }
  return {
    pathname: '/analytics/observability',
    search: value.search,
    connection,
    filters,
    grain: value.grain as AnalyticsGrain,
    timeWindow: timeWindow as AnalyticsTimeWindow | null,
    session,
    scrollTop: value.scrollTop,
    focusId:
      typeof value.focusId === 'string' && focusIds.has(value.focusId) ? value.focusId : null,
  };
}

export function analyticsReturnState(context: AnalyticsReturnContext) {
  return {
    analyticsFilters: context.filters,
    analyticsGrain: context.grain,
    analyticsRestoreContext: context,
  };
}
