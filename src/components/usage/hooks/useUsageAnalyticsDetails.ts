import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { usageQueryApi } from '@/services/api/usageQuery';
import type { UsageQueryRequest, UsageQuerySession } from '@/types/usageQuery';
import { collectUsageDetails, type UsageDetail } from '@/utils/usage';
import type { AnalyticsTimeWindow } from '@/utils/usage/latencyAnalysis';
import { queryItemDetail } from './useUsageQueryDetails';
import type { UsagePayload } from './useUsageData';

export const USAGE_ANALYTICS_AUTO_LOAD_WINDOW_HOURS = 7 * 24;
export type AnalyticsSamplesStatus = 'deferred' | 'loading' | 'ready' | 'error' | 'stopped';

export interface UseUsageAnalyticsDetailsResult {
  details: UsageDetail[];
  loading: boolean;
  error: string;
  loadedCount: number;
  totalCount: number | null;
  status: AnalyticsSamplesStatus;
  needsManualLoad: boolean;
  load: () => void;
  stop: () => void;
}

interface AnalyticsDetailsState {
  key: string;
  details: UsageDetail[];
  totalCount: number | null;
  status: AnalyticsSamplesStatus;
  error: string;
}

export function useUsageAnalyticsDetails(
  querySession: UsageQuerySession | null,
  usage: UsagePayload | null,
  timeWindow: AnalyticsTimeWindow | null,
  { active = true, enabled = true }: { active?: boolean; enabled?: boolean } = {}
): UseUsageAnalyticsDetailsResult {
  const scope = useAuthStore((s) => JSON.stringify([s.apiBase, s.managementKey]));
  const legacyDetails = useMemo(
    () => (enabled && querySession === null && usage ? collectUsageDetails(usage) : []),
    [enabled, querySession, usage]
  );
  const windowHours = timeWindow ? (timeWindow.endMs - timeWindow.startMs) / 3_600_000 : 0;
  const autoLoad =
    querySession !== null &&
    windowHours > 0 &&
    windowHours <= USAGE_ANALYTICS_AUTO_LOAD_WINDOW_HOURS;
  const baseKey = JSON.stringify([
    scope,
    querySession?.bound ?? null,
    querySession?.now_ms ?? null,
    timeWindow?.startMs ?? null,
    timeWindow?.endMs ?? null,
  ]);
  const [manualLoad, setManualLoad] = useState<{ key: string; epoch: number } | null>(null);
  const manualEpoch = manualLoad?.key === baseKey ? manualLoad.epoch : 0;
  const [state, setState] = useState<AnalyticsDetailsState | null>(null);
  const latestState = useRef(state);
  latestState.current = state;
  const inFlight = useRef<AbortController | null>(null);
  const stateKey = `${baseKey}#${manualEpoch}`;

  const load = useCallback(() => {
    setManualLoad((current) => ({
      key: baseKey,
      epoch: current?.key === baseKey ? current.epoch + 1 : 1,
    }));
  }, [baseKey]);
  const stop = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setState((current) =>
      current?.key === stateKey
        ? { ...current, status: 'stopped' }
        : { key: stateKey, details: [], totalCount: null, status: 'stopped', error: '' }
    );
  }, [stateKey]);

  useEffect(() => {
    if (!enabled || !active || querySession === null) {
      inFlight.current?.abort();
      inFlight.current = null;
      return;
    }
    const previous = latestState.current;
    if (previous?.key === stateKey && ['ready', 'stopped', 'error'].includes(previous.status))
      return;
    if (manualEpoch === 0 && !autoLoad) {
      setState({ key: stateKey, details: [], totalCount: null, status: 'deferred', error: '' });
      return;
    }

    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;
    setState({ key: stateKey, details: [], totalCount: null, status: 'loading', error: '' });
    const request: UsageQueryRequest = {
      bound: querySession.bound,
      now_ms: querySession.now_ms,
      ...(timeWindow ? { from_ms: timeWindow.startMs, to_ms: timeWindow.endMs } : {}),
    };
    const run = async () => {
      const details: UsageDetail[] = [];
      const cursors = new Set<string>();
      let cursor = '';
      let totalCount: number | null = null;
      try {
        do {
          if (controller.signal.aborted) return;
          const auth = useAuthStore.getState();
          if (JSON.stringify([auth.apiBase, auth.managementKey]) !== scope) {
            throw new Error('Connection changed');
          }
          const data = await usageQueryApi.details(
            {
              ...request,
              cursor,
              limit: Math.min(200, querySession.max_page_size || 200),
              include_options: false,
            },
            controller.signal
          );
          if (controller.signal.aborted) return;
          details.push(...data.items.map(queryItemDetail));
          totalCount = data.total;
          cursor = data.next_cursor ?? '';
          if (cursor && cursors.has(cursor)) throw new Error('Repeated usage query cursor');
          cursors.add(cursor);
          setState({
            key: stateKey,
            details: [...details],
            totalCount,
            status: 'loading',
            error: '',
          });
        } while (cursor);
        if (!controller.signal.aborted) {
          setState({ key: stateKey, details, totalCount, status: 'ready', error: '' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          key: stateKey,
          details,
          totalCount,
          status: 'error',
          error: error instanceof Error ? error.message : 'Usage query failed',
        });
      }
    };
    void run();
    return () => {
      controller.abort();
      if (inFlight.current === controller) inFlight.current = null;
    };
  }, [active, enabled, autoLoad, manualEpoch, querySession, scope, stateKey, timeWindow]);

  if (querySession === null) {
    return {
      details: legacyDetails,
      loading: false,
      error: '',
      loadedCount: legacyDetails.length,
      totalCount: legacyDetails.length,
      status: 'ready',
      needsManualLoad: false,
      load,
      stop,
    };
  }
  const current = state?.key === stateKey ? state : null;
  const status = current?.status ?? (autoLoad || manualEpoch > 0 ? 'loading' : 'deferred');
  return {
    details: current?.details ?? [],
    loading: enabled && active && status === 'loading',
    error: current?.error ?? '',
    loadedCount: current?.details.length ?? 0,
    totalCount: current?.totalCount ?? null,
    status,
    needsManualLoad: status === 'deferred',
    load,
    stop,
  };
}
