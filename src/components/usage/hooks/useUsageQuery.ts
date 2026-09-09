import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useUsageQueryStore } from '@/stores/useUsageQueryStore';
import { usageQueryApi } from '@/services/api/usageQuery';
import type { UsageQueryRequest, UsageQuerySession, UsageQuerySummary } from '@/types/usageQuery';

export function useUsageQuerySession() {
  const apiBase = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const state = useUsageQueryStore();
  const load = state.load;
  const scope = JSON.stringify([apiBase, key]);
  useEffect(() => {
    void load().catch(() => {});
  }, [scope, load]);
  return state.scope === scope
    ? state
    : { ...state, mode: 'unknown' as const, session: null, error: '', loading: true };
}

export function useUsageQuerySummary(
  session: UsageQuerySession | null,
  input: UsageQueryRequest,
  pricing = false
) {
  const [state, setState] = useState<{
    key: string;
    data: UsageQuerySummary | null;
    error: string;
  }>({ key: '', data: null, error: '' });
  const scope = useAuthStore((s) => JSON.stringify([s.apiBase, s.managementKey]));
  const serialized = JSON.stringify(
    session
      ? {
          ...input,
          bound: session.bound,
          now_ms: session.now_ms,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
      : null
  );
  const key = JSON.stringify([scope, serialized, pricing]);
  const request = useMemo<UsageQueryRequest | null>(() => JSON.parse(serialized), [serialized]);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const run = pricing ? usageQueryApi.pricing : usageQueryApi.summary;
    void run(request, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: '' });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error: error instanceof Error ? error.message : 'Usage query failed',
          });
      });
    return () => controller.abort();
  }, [key, request, pricing]);
  const current = state.key === key ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? '',
    loading: session !== null && current === null,
  };
}
