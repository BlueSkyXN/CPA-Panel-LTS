import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildCacheTrendSeries,
  collectCacheAnalysisRows,
  formatCompactNumber,
  formatDayLabel,
  formatHourLabel,
  summarizeCacheAnalytics,
  type AnalyticsTimeWindow,
  type CacheAnalyticsSummary,
  type CacheTrendPoint,
  type UsageDetail,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';

const CACHE_RATE_COLOR = '#0E9F6E';

export interface CacheEfficiencyCardProps {
  details: UsageDetail[];
  loading: boolean;
  isMobile: boolean;
  timeWindow: AnalyticsTimeWindow | null;
}

export function CacheEfficiencyCard({
  details,
  loading,
  isMobile,
  timeWindow,
}: CacheEfficiencyCardProps) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: 'percent',
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );

  const { chartData, chartOptions, points, summary, hasData } = useMemo(() => {
    const rows = collectCacheAnalysisRows(details);
    const points: CacheTrendPoint[] = buildCacheTrendSeries(rows, period, timeWindow);
    const summary: CacheAnalyticsSummary = summarizeCacheAnalytics(rows);
    const labels = points.map((point) =>
      period === 'hour'
        ? formatHourLabel(new Date(point.timestampMs))
        : formatDayLabel(new Date(point.timestampMs))
    );

    const data: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: t('usage_stats.cache_analytics_rate_series'),
          data: points.map((point) => point.cacheRate),
          borderColor: CACHE_RATE_COLOR,
          backgroundColor: CACHE_RATE_COLOR,
          tension: 0.35,
          spanGaps: true,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels, isMobile });
    const options: ChartOptions<'line'> = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          min: 0,
          max: 1,
          ticks: {
            ...baseOptions.scales?.y?.ticks,
            callback: (value) => percentFormatter.format(Number(value)),
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
              const rate = point?.cacheRate ?? null;
              return rate === null
                ? `${context.dataset.label}: --`
                : `${context.dataset.label}: ${percentFormatter.format(rate)} (${formatCompactNumber(
                    point.cacheReadTokens
                  )}/${formatCompactNumber(point.inputTokens)})`;
            },
          },
        },
      },
    };

    return {
      chartData: data,
      chartOptions: options,
      points,
      summary,
      hasData: points.some((point) => point.requests > 0),
    };
  }, [details, period, isMobile, timeWindow, percentFormatter, t]);

  return (
    <Card
      title={t('usage_stats.cache_analytics_title')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
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
          <div className={styles.analyticsChips}>
            <span className={styles.analyticsChip}>
              <span className={styles.analyticsChipLabel}>{t('usage_stats.cache_analytics_read_rate')}</span>
              <span className={styles.analyticsChipValue}>
                {summary.cacheReadRate === null ? '--' : percentFormatter.format(summary.cacheReadRate)}
              </span>
            </span>
            <span className={styles.analyticsChip}>
              <span className={styles.analyticsChipLabel}>{t('usage_stats.cache_analytics_hit_requests')}</span>
              <span className={styles.analyticsChipValue}>
                {summary.cacheHitRequestRatio === null
                  ? '--'
                  : percentFormatter.format(summary.cacheHitRequestRatio)}
              </span>
            </span>
            <span className={styles.analyticsChip}>
              <span className={styles.analyticsChipLabel}>{t('usage_stats.cache_read_tokens')}</span>
              <span className={styles.analyticsChipValue}>
                {formatCompactNumber(summary.cacheReadTokens)}
              </span>
            </span>
            <span className={styles.analyticsChip}>
              <span className={styles.analyticsChipLabel}>{t('usage_stats.cache_write_tokens')}</span>
              <span className={styles.analyticsChipValue}>
                {formatCompactNumber(summary.cacheWriteTokens)}
              </span>
            </span>
          </div>
          <div className={styles.chartArea}>
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
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
