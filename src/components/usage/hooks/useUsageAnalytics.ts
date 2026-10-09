import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  acquireUsageAnalytics,
  analyticsCacheKey,
  peekAnalyticsOptions,
  peekUsageAnalytics,
} from '@/stores/usageAnalyticsCache';
import { usageQueryApi } from '@/services/api/usageQuery';
import type { UsageAnalyticsResult } from '@/types/usageAnalytics';
import type { UsageQueryRequest, UsageQuerySession } from '@/types/usageQuery';
import {
  analyticsQueryFilter,
  type AnalyticsFilterOptions,
  type AnalyticsFilters,
} from '@/utils/usage/analyticsFilters';
import { buildUsageAnalytics } from '@/utils/usage/analyticsModel';
import type { AnalyticsTimeWindow } from '@/utils/usage';

export function useUsageAnalytics(
  session: UsageQuerySession | null,
  timeWindow: AnalyticsTimeWindow | null,
  filters: AnalyticsFilters,
  active: boolean,
  enabled: boolean,
  rangeIdentity: string
) {
  const scope = useAuthStore((state) => JSON.stringify([state.apiBase, state.managementKey]));
  const serializedBase = JSON.stringify(
    session
      ? {
          bound: session.bound,
          now_ms: session.now_ms,
          ...(timeWindow ? { from_ms: timeWindow.startMs, to_ms: timeWindow.endMs } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          include_options: true,
        }
      : null
  );
  const base = useMemo<UsageQueryRequest | null>(
    () => JSON.parse(serializedBase),
    [serializedBase]
  );
  const metadataKey = JSON.stringify([scope, serializedBase]);
  const [metadata, setMetadata] = useState<{ key: string; options: AnalyticsFilterOptions } | null>(
    null
  );
  const options =
    metadata?.key === metadataKey ? metadata.options : base ? peekAnalyticsOptions(base) : null;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const filtersJSON = JSON.stringify(filters);
  const stableFilters = useMemo<AnalyticsFilters>(() => JSON.parse(filtersJSON), [filtersJSON]);
  const selection = options ? analyticsQueryFilter(stableFilters, options) : null;
  const request =
    base && (!stableFilters.source || selection)
      ? {
          ...base,
          filter:
            selection?.filter ??
            (stableFilters.model === undefined ? {} : { model: stableFilters.model }),
        }
      : null;
  const cacheKey = request ? analyticsCacheKey(request) : '';
  const key = JSON.stringify([metadataKey, filtersJSON]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    result: UsageAnalyticsResult | null;
    error: string;
    code: string;
    loading: boolean;
  } | null>(null);
  const cached = cacheKey && !selection?.empty ? peekUsageAnalytics(cacheKey) : null;
  const latest = useRef(state);
  latest.current = state;
  const previous = useRef<{
    scope: string;
    filters: string;
    range: string;
    result: UsageAnalyticsResult;
  } | null>(null);
  const retryRef = useRef(false);
  useEffect(() => {
    if (!base || !active || !enabled) return;
    if (latest.current?.key === key && !latest.current.loading && !retryRef.current) return;
    let stopped = false;
    let release: (() => void) | undefined;
    const controller = new AbortController();
    const force = retryRef.current;
    retryRef.current = false;
    setState((old) => ({
      key,
      result: old?.key === key ? old.result : null,
      error: '',
      code: '',
      loading: true,
    }));
    void (async () => {
      let known = optionsRef.current;
      if (stableFilters.source && !known) {
        const directory = await usageQueryApi.details({ ...base, limit: 1 }, controller.signal);
        if (stopped) return;
        if (!directory.options) throw new Error('Missing usage analytics options');
        known = directory.options;
      }
      const selected = known ? analyticsQueryFilter(stableFilters, known) : null;
      let result: UsageAnalyticsResult;
      if (selected?.empty) {
        const window =
          base.from_ms !== undefined && base.to_ms !== undefined
            ? { startMs: base.from_ms, endMs: base.to_ms }
            : null;
        result = {
          version: 1,
          analytics_version: 1,
          bound: base.bound!,
          now_ms: base.now_ms!,
          from_ms: base.from_ms ?? null,
          to_ms: base.to_ms ?? null,
          timezone: base.timezone!,
          total: 0,
          analyzed: 0,
          options: known!,
          data: buildUsageAnalytics([], window),
        };
      } else {
        const acquired = acquireUsageAnalytics(
          {
            ...base,
            filter:
              selected?.filter ??
              (stableFilters.model === undefined ? {} : { model: stableFilters.model }),
          },
          force
        );
        release = acquired.release;
        try {
          result = await acquired.promise;
        } finally {
          acquired.release();
        }
      }
      if (stopped) return;
      if (!result.options) throw new Error('Missing usage analytics options');
      setMetadata({ key: metadataKey, options: result.options });
      setState({ key, result, error: '', code: '', loading: false });
      previous.current = { scope, filters: filtersJSON, range: rangeIdentity, result };
    })().catch((error: unknown) => {
      if (stopped) return;
      const record =
        error && typeof error === 'object'
          ? (error as { code?: string; details?: unknown; message?: string })
          : null;
      const details =
        record?.details && typeof record.details === 'object'
          ? (record.details as { code?: string })
          : null;
      setState((old) => ({
        key,
        result: old?.key === key ? old.result : null,
        error: record?.message || 'Usage analytics failed',
        code: details?.code ?? record?.code ?? '',
        loading: false,
      }));
    });
    return () => {
      stopped = true;
      controller.abort();
      release?.();
    };
  }, [
    base,
    active,
    enabled,
    key,
    revision,
    stableFilters,
    metadataKey,
    scope,
    filtersJSON,
    rangeIdentity,
  ]);
  const current = state?.key === key ? state : null;
  const old = previous.current;
  const retained =
    old?.scope === scope && old.filters === filtersJSON && old.range === rangeIdentity
      ? old.result
      : null;
  const result = current?.result ?? cached ?? retained;
  return {
    result,
    options: options ?? result?.options ?? null,
    loading: enabled && active && (current ? current.loading : !cached),
    stale: Boolean(result && !current?.result && !cached),
    error: current?.error ?? '',
    code: current?.code ?? '',
    retry: () => {
      retryRef.current = true;
      setRevision((value) => value + 1);
    },
  };
}
