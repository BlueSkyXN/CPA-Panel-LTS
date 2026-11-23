import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  formatCompactNumber,
  formatDayLabel,
  formatHourLabel,
  type CacheAnalyticsSummary,
  type CacheTrendPoint,
} from '@/utils/usage';
import {
  buildChartOptions,
  getHourChartMinWidth,
  sparsePointRadius,
} from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';
import { bucketRangeAt, type AnalyticsBucketRange } from './analyticsBucketDrill';
import { AnalyticsBucketDrillControl } from './AnalyticsBucketDrillControl';
import { CACHE_STATES, type CacheValueState } from '@/utils/usage/cacheAnalytics';
import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';

const CACHE_RATE_COLOR = '#0E9F6E';

export interface CacheEfficiencyCardProps {
  data: UsageAnalyticsData;
  loading: boolean;
  isMobile: boolean;
  /** 当前查询窗口；用于把最后一个桶的下钻终点收敛到可见范围。 */
  window?: AnalyticsTimeWindow | null;
  /** 时间粒度由 UsageAnalyticsCharts 统一持有，四张趋势图共用。 */
  grain: AnalyticsGrain;
  onGrainChange: (grain: AnalyticsGrain) => void;
  /** 点击时间桶时下钻到该桶的请求明细；未提供时图表仅展示。 */
  onBucketClick?: ((bucket: AnalyticsBucketRange) => void) | null;
  onCacheState?: (field: 'read' | 'write', state: CacheValueState) => void;
}

export function CacheEfficiencyCard({
  data,
  loading,
  isMobile,
  window,
  grain: period,
  onGrainChange: setPeriod,
  onBucketClick,
  onCacheState,
}: CacheEfficiencyCardProps) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState<{ index: number; grain: AnalyticsGrain } | null>(null);
  const describeBucket = (point?: CacheTrendPoint): string => {
    if (!point) return '';
    if (point.requests === 0) return t('cache_analysis.bucket_empty');
    const rate = point.observed ? point.observed.rate : point.cacheRate;
    if (rate !== null) return percentFormatter.format(rate);
    return point.observed && point.observed.read.unknown === point.requests
      ? t('cache_analysis.bucket_unknown') : t('cache_analysis.bucket_unavailable');
  };

  const locale = i18n.language;
  const percentFormatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const { chartData, chartOptions, points, summary, hasData } = useMemo(() => {
    const format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    const points: CacheTrendPoint[] = data[period].cache;
    const summary: CacheAnalyticsSummary = data.cache;
    const labels = points.map((point) =>
      period === 'hour'
        ? formatHourLabel(new Date(point.timestampMs))
        : formatDayLabel(new Date(point.timestampMs))
    );

    const chart: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: t('usage_stats.cache_analytics_rate_series'),
          data: points.map((point) => point.observed ? point.observed.rate : point.cacheRate),
          borderColor: CACHE_RATE_COLOR,
          backgroundColor: CACHE_RATE_COLOR,
          tension: 0.35,
          spanGaps: false,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels, isMobile });
    const bucketTimes = points.map((point) => point.timestampMs);
    const grain = period;
    const options: ChartOptions<'line'> = {
      ...baseOptions,
      onHover: (event, _elements, chart) => {
        const index = event.x === null ? undefined : chart.scales.x?.getValueForPixel(event.x);
        const point = index === undefined ? undefined : points[index];
        if (index !== undefined && point && (point.observed ? point.observed.rate : point.cacheRate) === null) {
          setHover((current) => current?.index === index && current.grain === grain ? current : { index, grain });
        } else {
          setHover(null);
        }
      },
      onClick: onBucketClick
        ? (event, _elements, chart) => {
            const index = event.x === null ? undefined : chart.scales.x?.getValueForPixel(event.x);
            if (index === undefined) return;
            const bucket = bucketRangeAt(bucketTimes, index, grain, window);
            if (bucket) onBucketClick(bucket);
          }
        : undefined,
      elements: {
        ...baseOptions.elements,
        point: {
          ...baseOptions.elements?.point,
          // 稀疏窗口（单点序列）在移动端 radius=0 时会完全不可见。
          radius: sparsePointRadius(baseOptions.elements?.point?.radius),
        },
      },
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          min: 0,
          max: 1,
          ticks: {
            ...baseOptions.scales?.y?.ticks,
            callback: (value) => format.format(Number(value)),
          },
        },
      },
      plugins: {
        ...baseOptions.plugins,
        tooltip: {
          ...baseOptions.plugins?.tooltip,
          callbacks: {
            ...baseOptions.plugins?.tooltip?.callbacks,
            label: (context) => {
              const point = points[context.dataIndex];
              const rate = point?.observed ? point.observed.rate : point?.cacheRate ?? null;
              return rate === null
                ? `${context.dataset.label}: --`
                : `${context.dataset.label}: ${format.format(rate)} (${formatCompactNumber(
                    point.observed?.readTokens ?? point.cacheReadTokens
                  )}/${formatCompactNumber(point.observed?.inputTokens ?? point.inputTokens)})`;
            },
          },
        },
      },
    };

    return {
      chartData: chart,
      chartOptions: options,
      points,
      summary,
      hasData: summary.observed
        ? Object.values(summary.observed.read).some((count) => count > 0)
        : points.some((point) => point.requests > 0),
    };
  }, [data, period, isMobile, locale, t, window, onBucketClick]);

  return (
    <Card
      title={t('usage_stats.cache_analytics_title')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
            data-testid="analytics-cache-hour"
            aria-pressed={period === 'hour'}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
            data-testid="analytics-cache-day"
            aria-pressed={period === 'day'}
          >
            {t('usage_stats.by_day')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : hasData ? (
        <div className={styles.chartWrapper}>
          {summary.observed ? (
            <>
              <div className={styles.analyticsChips}>
                <span className={styles.cacheObservedRate} data-testid="analytics-cache-observed-rate">
                  <span className={styles.analyticsChipLabel}>{t('usage_stats.cache_analytics_read_rate')}</span>
                  <strong>
                    {summary.observed.rate === null ? '—' : percentFormatter.format(summary.observed.rate)}
                  </strong>
                  <span className={styles.analyticsChipMeta}>
                    {t('cache_analysis.coverage', {
                      observed: summary.observed.read.positive + summary.observed.read.zero,
                      total: summary.observed.read.positive + summary.observed.read.zero + summary.observed.read.unknown,
                    })}
                  </span>
                  <span className={styles.analyticsChipMeta}>
                    {t('analytics.summary_cache_meta', {
                      read: summary.observed.readTokens.toLocaleString(i18n.language),
                      input: summary.observed.inputTokens.toLocaleString(i18n.language),
                    })}
                  </span>
                </span>
              </div>
              <div className={styles.cacheStateGroups}>
                {(['read', 'write'] as const).map((field) => (
                  <div key={field} className={styles.analyticsChips} role="group"
                    aria-label={t(`cache_analysis.${field}_filter`)}>
                    <span className={styles.analyticsChipGroupLabel}>{t(`cache_analysis.${field}_filter`)}</span>
                    {CACHE_STATES.map((state) => {
                      const count = summary.observed?.[field][state] ?? 0;
                      const content = (
                        <>
                          <span className={styles.analyticsChipLabel}>{t(`cache_analysis.${field}_${state}`)}</span>
                          <span className={styles.analyticsChipValue}>{count.toLocaleString(locale)}</span>
                        </>
                      );
                      return onCacheState && count > 0 ? (
                        <button type="button" key={state} className={styles.summaryChipButton}
                          data-testid={`analytics-cache-${field}-${state}`} onClick={() => onCacheState(field, state)}>
                          {content}
                        </button>
                      ) : <span className={styles.analyticsChip} key={state}>{content}</span>;
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.analyticsChips}>
              <span className={styles.analyticsChip}>
                <span className={styles.analyticsChipLabel}>{t('cache_analysis.legacy_rate')}</span>
                <span className={styles.analyticsChipValue}>
                  {summary.cacheReadRate === null ? '—' : percentFormatter.format(summary.cacheReadRate)}
                </span>
              </span>
            </div>
          )}
          <div className={styles.analyticsChips}>
            {[
              ['hit-ratio', t('usage_stats.cache_analytics_hit_requests'),
                summary.cacheHitRequestRatio === null ? '—' : percentFormatter.format(summary.cacheHitRequestRatio)],
              ['write-tokens', t('usage_stats.cache_write_tokens'), summary.cacheWriteTokens.toLocaleString(locale)],
              ...(!summary.observed ? [[
                'read-tokens', t('usage_stats.cache_read_tokens'), summary.cacheReadTokens.toLocaleString(locale),
              ]] : []),
            ].map(([key, label, value]) => (
              <span key={key} className={styles.analyticsChip} data-testid={`analytics-cache-${key}`}>
                <span className={styles.analyticsChipLabel}>{label}</span>
                <span className={styles.analyticsChipValue}>{value}</span>
              </span>
            ))}
          </div>
          <div className={styles.chartArea} onMouseLeave={() => setHover(null)}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(points.length, isMobile) }
                    : undefined
                }
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
          {hover?.grain === period && (
            <span className={styles.analyticsChipMeta}>{describeBucket(points[hover.index])}</span>
          )}
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
      {onBucketClick && !loading && points.length > 0 && (
        <AnalyticsBucketDrillControl
          key={period}
          id="cache"
          times={data[period].cache.map((point) => point.timestampMs)}
          grain={period}
          window={window}
          onOpen={onBucketClick}
          describeBucket={(index) => describeBucket(points[index])}
        />
      )}
    </Card>
  );
}
