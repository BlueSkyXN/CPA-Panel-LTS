import { decodeUsageQuerySession } from '@/services/api/usageQuery';
import { isRecord } from '@/utils/helpers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { readAnalyticsNavigationState } from '@/utils/usage/analyticsFilters';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { RequestEventsDetailsCard } from '@/components/usage/RequestEventsDetailsCard';
import { useUsageData } from '@/components/usage/hooks/useUsageData';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { providersApi } from '@/services/api';
import { useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import { USAGE_PRESET_TIME_RANGES, type UsageTimeRange } from '@/utils/usage';
import { buildUsageEventsSearch, resolveUsageEventsScope } from '@/utils/usage/eventWorkspace';
import styles from './UsagePage.module.scss';

export function UsageEventsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const initialAnalyticsFilters = useMemo(() => readAnalyticsNavigationState(location.state), [location.state]);
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = useMemo(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Storage may be unavailable. */ }
    return resolveUsageEventsScope(searchParams, storage);
  }, [searchParams]);
  const config = useConfigStore((state) => state.config);
  const providerSource = config?.openaiCompatibility;
  const [providerState, setProviderState] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);
  const {
    usage, loading, error, lastRefreshedAt, priceProfile, loadUsage, querySession,
    handleExport, handleImport, handleImportChange, importInputRef, exporting, importing,
  } = useUsageData();
  const pinnedSession = useMemo(() => {
    if (!isRecord(location.state) || !location.state.analyticsSession) return null;
    try { return decodeUsageQuerySession(location.state.analyticsSession); } catch { return null; }
  }, [location.state]);
  const [releasedSnapshot, setReleasedSnapshot] = useState<string | null>(null);
  const selectedSession = pinnedSession && releasedSnapshot !== pinnedSession.bound ? pinnedSession : querySession;
  const refresh = useCallback(async () => {
    await loadUsage();
    setReleasedSnapshot(pinnedSession?.bound ?? null);
    if (pinnedSession) navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: { ...(isRecord(location.state) ? location.state : {}), analyticsSession: null },
    });
  }, [loadUsage, pinnedSession, navigate, location.pathname, location.search, location.state]);
  useHeaderRefresh(refresh);

  useEffect(() => {
    let stopped = false;
    providersApi.getOpenAIProviders().then((providers) => {
      if (!stopped) setProviderState({ source: providerSource, providers: providers || [] });
    }).catch(() => { if (!stopped) setProviderState(null); });
    return () => { stopped = true; };
  }, [providerSource]);

  const providers = providerState?.source === providerSource && providerState
    ? providerState.providers : (providerSource ?? []);
  const ranges: UsageTimeRange[] = ['all', ...USAGE_PRESET_TIME_RANGES];
  if (scope.range === 'custom') ranges.push('custom');

  return (
    <div className={`${styles.container} ${styles.requestEventsWorkspace}`} data-testid="usage-events-workspace">
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.request_events_workspace_title')}</h1>
        <div className={styles.headerActions}>
          <Select
            value={scope.range}
            options={ranges.map((value) => ({ value, label: t(`usage_stats.range_${value}`) }))}
            onChange={(value) => setSearchParams(buildUsageEventsSearch(value as UsageTimeRange, scope.customRange), { state: location.state })}
            ariaLabel={t('usage_stats.range_filter')}
            fullWidth={false}
          />
          <Button variant="secondary" size="sm" onClick={() => navigate('/usage')}>
            {t('usage_stats.pricing_back')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('/usage/pricing')}>
            {t('usage_stats.pricing_title')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting} disabled={loading || importing}>
            {t('usage_stats.export')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleImport} loading={importing} disabled={loading || exporting}>
            {t('usage_stats.import')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void refresh().catch(() => {})} disabled={loading || importing || exporting}>
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportChange} />
        </div>
      </div>
      {error && <div className={styles.errorBox}>{error}</div>}
      {!scope.valid && <div className={styles.errorBox}>{t('usage_stats.request_events_invalid_scope')}</div>}
      <RequestEventsDetailsCard
        key={JSON.stringify(initialAnalyticsFilters)}
        initialAnalyticsFilters={initialAnalyticsFilters}
        querySession={scope.valid ? selectedSession : null}
        usage={scope.valid ? usage : null}
        loading={loading}
        pageTimeRange={scope.range}
        pageTimeRangeCustom={scope.customRange}
        referenceNowMs={selectedSession?.now_ms ?? lastRefreshedAt?.getTime() ?? 0}
        priceProfile={priceProfile}
        requestApiKeys={config?.apiKeys || []}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={providers}
      />
    </div>
  );
}
