import { useCallback, useMemo } from 'react';
import { useUsageQuerySession, useUsageQuerySummary } from '@/components/usage/hooks/useUsageQuery';
import { useUsageQueryStore } from '@/stores/useUsageQueryStore';
import { queryKeyStats } from '@/utils/usage/queryView';
import { useInterval } from '@/hooks/useInterval';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import type { KeyStats, UsageDetail } from '@/utils/usage';

const EMPTY_KEY_STATS: KeyStats = { bySource: {}, byAuthIndex: {} };
const EMPTY_USAGE_DETAILS: UsageDetail[] = [];

export type UseProviderStatsOptions = {
  enabled?: boolean;
  autoRefresh?: boolean;
};

export const useProviderStats = (options: UseProviderStatsOptions = {}) => {
  const enabled = options.enabled ?? true;
  const legacyKeyStats = useUsageStatsStore((state) => (enabled ? state.keyStats : EMPTY_KEY_STATS));
  const legacyDetails = useUsageStatsStore((state) =>
    enabled ? state.usageDetails : EMPTY_USAGE_DETAILS
  );
  const legacyLoading = useUsageStatsStore((state) => (enabled ? state.loading : false));
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const session = useUsageQuerySession();
  const loadSession = session.load;
  const query = useUsageQuerySummary(enabled && session.mode === 'query' ? session.session : null, { modules: ['credentials', 'status'] });
  const keyStats = useMemo(() => session.mode === 'legacy' ? legacyKeyStats : queryKeyStats(query.data), [session.mode, legacyKeyStats, query.data]);
  const usageDetails = session.mode === 'legacy' ? legacyDetails : EMPTY_USAGE_DETAILS;
  const isLoading = enabled && (session.loading || query.loading || session.mode === 'legacy' && legacyLoading);

  // 首次进入页面优先复用缓存，避免跨页面重复拉取 /usage。
  const loadKeyStats = useCallback(async () => {
    await loadSession();
    if (useUsageQueryStore.getState().mode === 'legacy') await loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats, loadSession]);

  // 定时器触发时强制刷新共享 usage。
  const refreshKeyStats = useCallback(async () => {
    await loadSession(true);
    if (useUsageQueryStore.getState().mode === 'legacy') await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats, loadSession]);

  useInterval(() => {
    void refreshKeyStats().catch(() => {});
  }, enabled && options.autoRefresh !== false ? 240_000 : null);

  return { keyStats, usageDetails, querySummary: query.data, loadKeyStats, refreshKeyStats, isLoading, error: session.error || query.error };
};
