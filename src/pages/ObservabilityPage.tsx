import { useUsageAnalytics } from '@/components/usage/hooks/useUsageAnalytics';
import { UsageAnalyticsCharts } from '@/components/usage/UsageAnalyticsCharts';
import { analyticsResultWindow } from '@/types/usageAnalytics';
import { useEffect, useMemo, useState } from 'react';
import { getConnectionFrameElement } from '@/services/connectionRuntime';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnalyticsFiltersBar } from '@/components/usage/AnalyticsFiltersBar';
import { useUsageAnalyticsOptions } from '@/components/usage/hooks/useUsageAnalyticsOptions';
import {
  analyticsQueryFilter,
  readAnalyticsNavigationState,
  type AnalyticsFilters,
} from '@/utils/usage/analyticsFilters';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { AnalyticsLayout } from './AnalyticsLayout';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { UsageAnalyticsSection } from '@/components/usage/UsageAnalyticsSection';
import { useUsageData } from '@/components/usage/hooks/useUsageData';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  filterUsageByTimeRange,
  resolveUsageTimeRangeWindow,
  USAGE_PRESET_TIME_RANGES,
  type UsageTimeRange,
} from '@/utils/usage';
import { buildUsageEventsSearch, resolveUsageEventsScope } from '@/utils/usage/eventWorkspace';
import styles from './AnalyticsPage.module.scss';

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

const localDateTime = (ms: number) => {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function ObservabilityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const filters = useMemo(
    () => readAnalyticsNavigationState(location.state) ?? {},
    [location.state]
  );
  const setFilters = (next: AnalyticsFilters) =>
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: { analyticsFilters: next },
    });
  const [params, setParams] = useSearchParams();
  const scope = useMemo(() => resolveUsageEventsScope(params), [params]);
  const { usage, querySession, loading, error, lastRefreshedAt, loadUsage } = useUsageData();
  const currentLayer = usePageTransitionLayer()?.isCurrentLayer ?? true;
  const [visible, setVisible] = useState(
    () => !document.hidden && getConnectionFrameElement()?.getAttribute('data-active') !== 'false'
  );
  useEffect(() => {
    const frame = getConnectionFrameElement();
    const update = () =>
      setVisible(!document.hidden && frame?.getAttribute('data-active') !== 'false');
    const observer = frame ? new MutationObserver(update) : null;
    if (frame) observer?.observe(frame, { attributes: true, attributeFilter: ['data-active'] });
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const active = currentLayer && visible;
  const isMobile = useMediaQuery('(max-width: 768px)');
  useHeaderRefresh(loadUsage, active);
  const nowMs = lastRefreshedAt?.getTime() ?? 0;
  const timeWindow = useMemo(
    () =>
      scope.range === 'custom'
        ? scope.customRange
        : nowMs > 0
          ? resolveUsageTimeRangeWindow(scope.range, nowMs)
          : null,
    [scope, nowMs]
  );
  const legacyUsage = useMemo(
    () =>
      scope.valid && usage
        ? timeWindow
          ? filterUsageByTimeRange(usage, timeWindow, nowMs)
          : usage
        : null,
    [scope.valid, usage, timeWindow, nowMs]
  );
  const ready = scope.valid && !error && nowMs > 0;
  const aggregated = querySession?.analytics_version === 1;
  const analytics = useUsageAnalytics(
    querySession,
    timeWindow,
    filters,
    active,
    ready && aggregated,
    JSON.stringify([scope.range, scope.customRange])
  );
  const metadata = useUsageAnalyticsOptions(
    querySession,
    legacyUsage,
    timeWindow,
    active,
    ready && !aggregated
  );
  const visibleResult = aggregated ? analytics.result : null;
  const visibleWindow = visibleResult ? analyticsResultWindow(visibleResult) : timeWindow;
  const selection = useMemo(
    () => (metadata.options ? analyticsQueryFilter(filters, metadata.options) : null),
    [filters, metadata.options]
  );
  const setRange = (range: UsageTimeRange) => {
    const custom = scope.customRange ?? {
      startMs: (nowMs || Date.now()) - 86400000,
      endMs: nowMs || Date.now(),
    };
    setParams(buildUsageEventsSearch(range, custom), { state: { analyticsFilters: filters } });
  };
  const setCustom = (field: 'start' | 'end', value: string) => {
    const next = new URLSearchParams(params);
    next.set('range', 'custom');
    next.set(field, value ? String(Date.parse(value)) : '');
    setParams(next, { replace: true, state: { analyticsFilters: filters } });
  };

  return (
    <AnalyticsLayout>
      <div className={styles.header}>
        <div>
          <h1>{t('analytics.observability')}</h1>
          <p>{t('analytics.observability_hint')}</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready || (aggregated && (!visibleResult || analytics.stale))}
            onClick={() =>
              navigate(
                `/usage/events${buildUsageEventsSearch(visibleWindow ? 'custom' : 'all', visibleWindow)}`,
                {
                  state: {
                    analyticsFilters: filters,
                    analyticsSession:
                      visibleResult && querySession
                        ? {
                            ...querySession,
                            bound: visibleResult.bound,
                            now_ms: visibleResult.now_ms,
                          }
                        : querySession,
                  },
                }
              )
            }
          >
            {t('usage_stats.request_events_open_workspace')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void loadUsage().catch(() => {})}
          >
            {t('usage_stats.refresh')}
          </Button>
        </div>
      </div>
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <span>{t('usage_stats.range_filter')}</span>
          <Select
            value={scope.range}
            options={['all', ...USAGE_PRESET_TIME_RANGES, 'custom'].map((value) => ({
              value,
              label: t(`usage_stats.range_${value}`),
            }))}
            onChange={(value) => setRange(value as UsageTimeRange)}
            ariaLabel={t('usage_stats.range_filter')}
          />
        </div>
        <AnalyticsFiltersBar
          options={aggregated ? analytics.options : metadata.options}
          filters={filters}
          onChange={setFilters}
          active={active && ready}
        />
      </div>
      {scope.range === 'custom' && (
        <div className={styles.range}>
          <input
            type="datetime-local"
            aria-label={t('usage_stats.range_custom_start')}
            value={localDateTime(Number(params.get('start') || NaN))}
            onChange={(event) => setCustom('start', event.target.value)}
          />
          <span>–</span>
          <input
            type="datetime-local"
            aria-label={t('usage_stats.range_custom_end')}
            value={localDateTime(Number(params.get('end') || NaN))}
            onChange={(event) => setCustom('end', event.target.value)}
          />
        </div>
      )}
      {!aggregated && metadata.error && (
        <div className="error-box" role="alert">
          {t('usage_stats.loading_error')}: {metadata.error}{' '}
          <Button variant="secondary" size="sm" onClick={metadata.retry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {visibleWindow && (
        <p className={styles.note}>
          {new Date(visibleWindow.startMs).toLocaleString()} –{' '}
          {new Date(visibleWindow.endMs).toLocaleString()}
        </p>
      )}
      {lastRefreshedAt && (
        <p className={styles.note}>
          {t('usage_stats.last_updated')}:{' '}
          {(visibleResult ? new Date(visibleResult.now_ms) : lastRefreshedAt).toLocaleString()}
        </p>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {!scope.valid && (
        <div className="error-box" role="alert">
          {t('usage_stats.range_custom_invalid')}
        </div>
      )}
      {scope.valid && !error && aggregated && (
        <section aria-label={t('usage_stats.analytics_section_title')}>
          {analytics.error && (
            <div className="error-box" role="alert">
              {t(
                analytics.code === 'usage_analytics_too_large'
                  ? 'analytics.capacity_error'
                  : analytics.code === 'usage_query_expired'
                    ? 'analytics.snapshot_expired'
                    : analytics.code === 'usage_analytics_busy'
                      ? 'analytics.busy_error'
                      : 'usage_stats.loading_error'
              )}{' '}
              <Button
                variant="secondary"
                size="sm"
                onClick={
                  analytics.code === 'usage_query_expired'
                    ? () => void loadUsage().catch(() => {})
                    : analytics.retry
                }
              >
                {t('common.retry')}
              </Button>
            </div>
          )}
          <p className={styles.note} role="status">
            {analytics.loading || analytics.stale
              ? t(
                  analytics.error && visibleResult
                    ? 'analytics.stale_error'
                    : visibleResult
                      ? 'analytics.updating'
                      : 'common.loading'
                )
              : visibleResult
                ? t('analytics.aggregated_ready', { count: visibleResult.total })
                : ''}
          </p>
          {visibleResult && visibleResult.analyzed < visibleResult.total && (
            <p className={styles.note}>
              {t('analytics.invalid_timestamps', {
                count: visibleResult.total - visibleResult.analyzed,
              })}
            </p>
          )}
          {visibleResult &&
            (visibleResult.total > 0 ? (
              <UsageAnalyticsCharts data={visibleResult.data} loading={false} isMobile={isMobile} />
            ) : (
              <p className={styles.note}>{t('analytics.empty_window')}</p>
            ))}
        </section>
      )}
      {scope.valid && !error && !aggregated && !metadata.error && (
        <UsageAnalyticsSection
          querySession={querySession}
          legacyUsage={legacyUsage}
          timeWindow={timeWindow}
          loading={loading || metadata.loading}
          isMobile={isMobile}
          active={active}
          enabled={ready && selection !== null}
          filter={selection?.filter}
          filters={filters}
          empty={selection?.empty}
        />
      )}
    </AnalyticsLayout>
  );
}
