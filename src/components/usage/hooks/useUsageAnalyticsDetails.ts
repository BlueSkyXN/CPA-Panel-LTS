import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { usageQueryApi } from '@/services/api/usageQuery';
import type { UsageQueryRequest, UsageQuerySession } from '@/types/usageQuery';
import { collectUsageDetails, type UsageDetail } from '@/utils/usage';
import type { AnalyticsTimeWindow } from '@/utils/usage/latencyAnalysis';
import { queryItemDetail } from './useUsageQueryDetails';
import type { UsagePayload } from './useUsageData';

/** query 模式下超过该窗口（小时）不自动全量拉取，改为手动触发，避免长等待。 */
export const USAGE_ANALYTICS_AUTO_LOAD_WINDOW_HOURS = 7 * 24;

export interface UseUsageAnalyticsDetailsResult {
  details: UsageDetail[];
  loading: boolean;
  error: string;
  /** query 模式下当前已加载样本数；legacy 模式与 details.length 一致。 */
  loadedCount: number;
  /** query 模式且窗口超出自动加载阈值；UI 需提供手动加载入口。 */
  needsManualLoad: boolean;
  load: () => void;
}

interface AnalyticsDetailsState {
  key: string;
  details: UsageDetail[];
  loading: boolean;
  error: string;
}

export function useUsageAnalyticsDetails(
  querySession: UsageQuerySession | null,
  usage: UsagePayload | null,
  timeWindow: AnalyticsTimeWindow | null
): UseUsageAnalyticsDetailsResult {
  const scope = useAuthStore((s) => JSON.stringify([s.apiBase, s.managementKey]));
  const legacyDetails = useMemo(
    () => (querySession === null && usage ? collectUsageDetails(usage) : []),
    [querySession, usage]
  );

  const windowHours =
    timeWindow !== null ? Math.max((timeWindow.endMs - timeWindow.startMs) / 3_600_000, 0) : null;
  const autoLoad =
    querySession !== null &&
    (timeWindow === null
      ? false
      : windowHours !== null && windowHours > 0 && windowHours <= USAGE_ANALYTICS_AUTO_LOAD_WINDOW_HOURS);

  const baseKey = useMemo(
    () =>
      JSON.stringify([
        scope,
        querySession?.bound ?? null,
        timeWindow ? Math.floor(timeWindow.startMs / 1000) : null,
        timeWindow ? Math.floor(timeWindow.endMs / 1000) : null,
      ]),
    [scope, querySession, timeWindow]
  );

  const [manualEpoch, setManualEpoch] = useState(0);
  const [state, setState] = useState<AnalyticsDetailsState | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const stateKey = `${baseKey}#${manualEpoch}`;

  const load = useCallback(() => {
    setManualEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (querySession === null) {
      inFlight.current?.abort();
      inFlight.current = null;
      return;
    }
    if (manualEpoch === 0 && !autoLoad) {
      // 超阈值窗口保持未加载状态，等待用户显式触发。
      inFlight.current?.abort();
      inFlight.current = null;
      setState({ key: stateKey, details: [], loading: false, error: '' });
      return;
    }

    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;

    const request: UsageQueryRequest = {
      bound: querySession.bound,
      now_ms: querySession.now_ms,
      ...(timeWindow ? { from_ms: timeWindow.startMs, to_ms: timeWindow.endMs } : {}),
    };

    const run = async () => {
      const details: UsageDetail[] = [];
      let cursor = '';
      try {
        do {
          if (controller.signal.aborted) return;
          const auth = useAuthStore.getState();
          if (JSON.stringify([auth.apiBase, auth.managementKey]) !== scope) {
            throw new Error('Connection changed');
          }
          const data = await usageQueryApi.details(
            { ...request, cursor, limit: 200, include_options: false },
            controller.signal
          );
          if (controller.signal.aborted) return;
          details.push(...data.items.map(queryItemDetail));
          cursor = data.next_cursor ?? '';
          setState({ key: stateKey, details: [...details], loading: true, error: '' });
        } while (cursor);
        if (!controller.signal.aborted) {
          setState({ key: stateKey, details, loading: false, error: '' });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          key: stateKey,
          details,
          loading: false,
          error: error instanceof Error ? error.message : 'Usage query failed',
        });
      }
    };

    void run();
    return () => {
      controller.abort();
      if (inFlight.current === controller) {
        inFlight.current = null;
      }
    };
  }, [autoLoad, manualEpoch, querySession, scope, stateKey, timeWindow]);

  if (querySession === null) {
    return {
      details: legacyDetails,
      loading: false,
      error: '',
      loadedCount: legacyDetails.length,
      needsManualLoad: false,
      load,
    };
  }

  const current = state?.key === stateKey ? state : null;
  return {
    details: current?.details ?? [],
    loading: current === null || current.loading,
    error: current?.error ?? '',
    loadedCount: current?.details.length ?? 0,
    needsManualLoad: !autoLoad && manualEpoch === 0,
    load,
  };
}
