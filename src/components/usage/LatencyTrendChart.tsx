import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatDayLabel, formatDurationMs, formatHourLabel } from '@/utils/usage';
import {
  buildChartOptions,
  getHourChartMinWidth,
  sparsePointRadius,
} from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';
import { bucketRangeAt, type AnalyticsBucketRange } from './analyticsBucketDrill';
import { AnalyticsBucketDrillControl } from './AnalyticsBucketDrillControl';
import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';

const SERIES_COLORS = {
  p50: '#10B981',
  p95: '#F59E0B',
  p99: '#EF4444',
  average: '#6B7280',
} as const;

export interface LatencyTrendChartProps {
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
}

export function LatencyTrendChart({
  data,
  loading,
  isMobile,
  window,
  grain: period,
  onGrainChange: setPeriod,
  onBucketClick,
}: LatencyTrendChartProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, hasSamples } = useMemo(() => {
    const series = data[period].latency;
    const labels = series.times.map((time) =>
      period === 'hour' ? formatHourLabel(new Date(time)) : formatDayLabel(new Date(time))
    );
    const datasetLabels = {
      p50: 'P50',
      p95: 'P95',
      p99: 'P99',
      average: t('usage_stats.latency_trend_avg'),
    };
    const chart: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: datasetLabels.p50,
          data: series.p50,
          borderColor: SERIES_COLORS.p50,
          backgroundColor: SERIES_COLORS.p50,
          tension: 0.35,
          spanGaps: true,
        },
        {
          label: datasetLabels.p95,
          data: series.p95,
          borderColor: SERIES_COLORS.p95,
          backgroundColor: SERIES_COLORS.p95,
          tension: 0.35,
          spanGaps: true,
        },
        {
          label: datasetLabels.p99,
          data: series.p99,
          borderColor: SERIES_COLORS.p99,
          backgroundColor: SERIES_COLORS.p99,
          tension: 0.35,
          spanGaps: true,
        },
        {
          label: datasetLabels.average,
          data: series.average,
          borderColor: SERIES_COLORS.average,
          backgroundColor: SERIES_COLORS.average,
          borderDash: [6, 4],
          tension: 0.35,
          spanGaps: true,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels, isMobile });
    const sampleCountAt = (items: { dataIndex: number }[]): number | null => {
      const first = items[0];
      return first ? series.sampleCounts[first.dataIndex] : null;
    };
    const bucketTimes = series.times;
    const grain = period;
    const options: ChartOptions<'line'> = {
      ...baseOptions,
      onClick: onBucketClick
        ? (_elements, elements) => {
            const first = elements[0];
            if (!first) return;
            const bucket = bucketRangeAt(bucketTimes, first.index, grain, window);
            if (bucket) onBucketClick(bucket);
          }
        : undefined,
      elements: {
        ...baseOptions.elements,
        point: {
          ...baseOptions.elements?.point,
          // 稀疏窗口（如 24 小时只有 1 个有数据桶）在移动端也要可见。
          radius: sparsePointRadius(baseOptions.elements?.point?.radius),
        },
      },
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...baseOptions.scales?.y?.ticks,
            callback: (value) => formatDurationMs(Number(value)),
          },
        },
      },
      plugins: {
        ...baseOptions.plugins,
        tooltip: {
          ...baseOptions.plugins?.tooltip,
          callbacks: {
            ...baseOptions.plugins?.tooltip?.callbacks,
            label: (context) =>
              `${context.dataset.label}: ${formatDurationMs(Number(context.parsed.y))}`,
            afterBody: (items) => {
              const count = sampleCountAt(items);
              return count !== null ? t('usage_stats.analytics_samples_in_bucket', { count }) : '';
            },
          },
        },
      },
    };

    return {
      chartData: chart,
      chartOptions: options,
      hasSamples: series.sampleCounts.some((count) => count > 0),
    };
  }, [data, period, isMobile, t, window, onBucketClick]);

  const labels = chartData.labels ?? [];

  return (
    <Card
      title={t('usage_stats.latency_trend_title')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
            data-testid="analytics-latency-hour"
            aria-pressed={period === 'hour'}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
            data-testid="analytics-latency-day"
            aria-pressed={period === 'day'}
          >
            {t('usage_stats.by_day')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : hasSamples && labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset) => (
              <div key={dataset.label} className={styles.legendItem} title={dataset.label}>
                <span
                  className={styles.legendDot}
                  style={{ backgroundColor: dataset.borderColor as string }}
                />
                <span className={styles.legendLabel}>{dataset.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(labels.length, isMobile) }
                    : undefined
                }
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
          <p className={styles.analyticsNote}>{t('usage_stats.analytics_success_only_note')}</p>
        </div>
      ) : (
        <div className={styles.hint}>{t('analytics.no_measurements')}</div>
      )}
      {onBucketClick && !loading && hasSamples && (
        <AnalyticsBucketDrillControl
          key={period}
          id="latency"
          times={data[period].latency.times}
          grain={period}
          window={window}
          onOpen={onBucketClick}
        />
      )}
    </Card>
  );
}
