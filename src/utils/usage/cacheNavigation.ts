import type { CacheTraceLocation, CacheTraceRow } from '@/types/cacheDiagnostics';
import type { UsageQuerySession } from '@/types/usageQuery';
import type { CacheRouteKey } from '@/types/cacheDiagnostics';
import { isRecord } from '@/utils/helpers';
import { decodeTraceLocation } from './cacheDiagnostics';

export interface EventQueryNavigation {
  key: string;
  page: number;
  cursors: string[];
}

export interface CacheEventsView {
  filters: Record<string, string>;
  session: UsageQuerySession | null;
  navigation: EventQueryNavigation | null;
  page: number;
  cachePreset: boolean;
  cacheRoute: CacheRouteKey | null;
  selectedRowId: string;
  scrollTop: number;
}

interface ReturnContext {
  pathname: '/usage/events';
  search: string;
  connection: string;
  token: string;
}

// The cursors and filter values belong to this connection and remain in memory.
// Navigation state carries an opaque reference that works for browser Back too.
const views = new Map<string, { connection: string; view: CacheEventsView }>();
let nextToken = 0;
export function rememberCacheEvents(connection: string, view: CacheEventsView): string {
  const token = String(++nextToken);
  views.set(token, { connection, view });
  while (views.size > 8) {
    const oldest = views.keys().next().value;
    if (oldest === undefined) break;
    views.delete(oldest);
  }
  return token;
}

export function cacheEventsView(context: ReturnContext | null): CacheEventsView | undefined {
  if (!context) return undefined;
  const entry = views.get(context.token);
  return entry?.connection === context.connection ? entry.view : undefined;
}

export function readCacheReturnContext(value: unknown, connection: string): ReturnContext | null {
  if (!isRecord(value) || value.pathname !== '/usage/events' ||
      typeof value.search !== 'string' || (value.search !== '' && !value.search.startsWith('?')) ||
      value.connection !== connection || typeof value.token !== 'string' || !/^\d+$/.test(value.token)) {
    return null;
  }
  return { pathname: '/usage/events', search: value.search, connection, token: value.token };
}

export function readCacheLocation(search: URLSearchParams): CacheTraceLocation {
  return decodeTraceLocation({
    instance_id: search.get('instance'),
    diagnostics_id: search.get('diagnostics'),
    request_id: search.get('execution'),
    trace_id: search.get('trace'),
    attempt: search.has('attempt') ? Number(search.get('attempt')) : undefined,
  });
}

export function cacheLocationSearch(row: CacheTraceRow): string {
  const value = decodeTraceLocation(row);
  const params = new URLSearchParams();
  if (value.instance_id) params.set('instance', value.instance_id);
  if (value.diagnostics_id) params.set('diagnostics', value.diagnostics_id);
  if (value.request_id) params.set('execution', value.request_id);
  if (!value.request_id && !value.diagnostics_id && value.trace_id) params.set('trace', value.trace_id);
  if (value.attempt) params.set('attempt', String(value.attempt));
  return params.size ? `?${params}` : '';
}

export function cacheTraceRowKey(row: CacheTraceLocation & { history_key?: string }): string {
  return JSON.stringify([row.instance_id, row.diagnostics_id, row.request_id, row.attempt, row.history_key]);
}
