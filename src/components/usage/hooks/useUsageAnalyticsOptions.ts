import { useEffect, useMemo, useState } from 'react';
import { usageQueryApi } from '@/services/api/usageQuery';
import { useAuthStore } from '@/stores/useAuthStore';
import type { UsageQuerySession } from '@/types/usageQuery';
import type { AnalyticsTimeWindow } from '@/utils/usage';
import {
  legacyAnalyticsOptions,
  type AnalyticsFilterOptions,
} from '@/utils/usage/analyticsFilters';

export function useUsageAnalyticsOptions(
  session: UsageQuerySession | null,
  usage: unknown,
  window: AnalyticsTimeWindow | null,
  active: boolean,
  enabled: boolean
) {
  const scope = useAuthStore((state) => JSON.stringify([state.apiBase, state.managementKey]));
  const legacy = useMemo(() => legacyAnalyticsOptions(usage), [usage]);
  const key = JSON.stringify([scope, session?.bound, session?.now_ms, window]);
  const [state, setState] = useState<{
    key: string;
    options: AnalyticsFilterOptions | null;
    error: string;
  } | null>(null);
  const current = state?.key === key ? state : null;
  useEffect(() => {
    if (!session || !active || !enabled || current) return;
    const controller = new AbortController();
    void usageQueryApi
      .details(
        {
          bound: session.bound,
          now_ms: session.now_ms,
          ...(window ? { from_ms: window.startMs, to_ms: window.endMs } : {}),
          limit: 1,
          include_options: true,
        },
        controller.signal
      )
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!data.options) throw new Error('Missing usage query options');
        setState({ key, options: data.options, error: '' });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            options: null,
            error: error instanceof Error ? error.message : 'Usage query failed',
          });
      });
    return () => controller.abort();
  }, [session, window, key, active, enabled, current]);
  return {
    options: session ? (current?.options ?? null) : legacy,
    loading: Boolean(session && enabled && !current),
    error: session ? (current?.error ?? '') : '',
    retry: () => setState(null),
  };
}
