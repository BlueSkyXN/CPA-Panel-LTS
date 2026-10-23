import type { UsageAnalyticsResult } from '@/types/usageAnalytics';
import type { UsageQueryRequest } from '@/types/usageQuery';
import { usageAnalyticsApi } from '@/services/api/usageAnalytics';
import { useAuthStore } from './useAuthStore';
import type { AnalyticsFilterOptions } from '@/utils/usage/analyticsFilters';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 8;
const TTL = 4 * 60_000;
type Entry = { result: UsageAnalyticsResult; bytes: number; expires: number };
type Flight = {
  controller: AbortController;
  users: number;
  promise: Promise<UsageAnalyticsResult>;
};
const entries = new Map<string, Entry>();
const flights = new Map<string, Flight>();
let size = 0;
let epoch = 0;
export const analyticsCacheKey = (request: UsageQueryRequest) => JSON.stringify(request);
export function clearUsageAnalyticsCache() {
  epoch++;
  for (const flight of flights.values()) flight.controller.abort();
  flights.clear();
  entries.clear();
  size = 0;
}
useAuthStore.subscribe((state, previous) => {
  if (
    state.apiBase !== previous.apiBase ||
    state.managementKey !== previous.managementKey ||
    (!state.isAuthenticated && previous.isAuthenticated)
  )
    clearUsageAnalyticsCache();
});
export function peekUsageAnalytics(key: string): UsageAnalyticsResult | null {
  const value = entries.get(key);
  if (!value) return null;
  if (value.expires <= Date.now()) {
    entries.delete(key);
    size -= value.bytes;
    return null;
  }
  entries.delete(key);
  entries.set(key, value);
  return value.result;
}
export function peekAnalyticsOptions(request: UsageQueryRequest): AnalyticsFilterOptions | null {
  for (const [key, entry] of entries) {
    const result = entry.result;
    if (
      entry.expires > Date.now() &&
      result.bound === request.bound &&
      result.now_ms === request.now_ms &&
      result.from_ms === (request.from_ms ?? null) &&
      result.to_ms === (request.to_ms ?? null) &&
      result.options
    ) {
      return peekUsageAnalytics(key)?.options ?? null;
    }
  }
  return null;
}
export function acquireUsageAnalytics(request: UsageQueryRequest, force = false) {
  const key = analyticsCacheKey(request);
  if (!force) {
    const result = peekUsageAnalytics(key);
    if (result) return { promise: Promise.resolve(result), release() {} };
  }
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const generation = epoch;
    const promise = usageAnalyticsApi
      .query(request, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || generation !== epoch)
          throw new DOMException('Aborted', 'AbortError');
        if (
          result.bound !== request.bound ||
          result.now_ms !== request.now_ms ||
          result.from_ms !== (request.from_ms ?? null) ||
          result.to_ms !== (request.to_ms ?? null) ||
          result.timezone !== request.timezone
        )
          throw new Error('Usage analytics scope mismatch');
        const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
        if (bytes <= MAX_BYTES) {
          const old = entries.get(key);
          if (old) {
            size -= old.bytes;
            entries.delete(key);
          }
          while (entries.size >= MAX_ENTRIES || size + bytes > MAX_BYTES) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            size -= entries.get(oldest)!.bytes;
            entries.delete(oldest);
          }
          entries.set(key, { result, bytes, expires: Date.now() + TTL });
          size += bytes;
        }
        return result;
      })
      .finally(() => {
        if (flights.get(key) === next) flights.delete(key);
      });
    const next: Flight = { controller, users: 0, promise };
    flight = next;
    flights.set(key, next);
  }
  flight.users++;
  const current = flight;
  let released = false;
  return {
    promise: current.promise,
    release() {
      if (released) return;
      released = true;
      current.users--;
      if (current.users === 0 && flights.get(key) === current) {
        flights.delete(key);
        current.controller.abort();
      }
    },
  };
}
