import { useEffect, useMemo, useState } from 'react';
import { getConnectionFrameElement } from '@/services/connectionRuntime';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const setRange = (range: UsageTimeRange) => {
    const custom = scope.customRange ?? {
      startMs: (nowMs || Date.now()) - 86400000,
      endMs: nowMs || Date.now(),
    };
    setParams(buildUsageEventsSearch(range, custom));
  };
  const setCustom = (field: 'start' | 'end', value: string) => {
    const next = new URLSearchParams(params);
    next.set('range', 'custom');
    next.set(field, value ? String(Date.parse(value)) : '');
    setParams(next, { replace: true });
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
            disabled={!ready}
            onClick={() =>
              navigate(
                `/usage/events${buildUsageEventsSearch(timeWindow ? 'custom' : 'all', timeWindow)}`
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
      <div className={styles.range}>
        <Select
          value={scope.range}
          options={['all', ...USAGE_PRESET_TIME_RANGES, 'custom'].map((value) => ({
            value,
            label: t(`usage_stats.range_${value}`),
          }))}
          onChange={(value) => setRange(value as UsageTimeRange)}
          ariaLabel={t('usage_stats.range_filter')}
          fullWidth={false}
        />
        {scope.range === 'custom' && (
          <>
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
          </>
        )}
      </div>
      {timeWindow && (
        <p className={styles.note}>
          {new Date(timeWindow.startMs).toLocaleString()} –{' '}
          {new Date(timeWindow.endMs).toLocaleString()}
        </p>
      )}
      {lastRefreshedAt && (
        <p className={styles.note}>
          {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleString()}
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
      {scope.valid && !error && (
        <UsageAnalyticsSection
          querySession={querySession}
          legacyUsage={legacyUsage}
          timeWindow={timeWindow}
          loading={loading}
          isMobile={isMobile}
          active={active}
          enabled={ready}
        />
      )}
    </AnalyticsLayout>
  );
}
