import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatDayLabel, formatHourLabel } from '@/utils/usage';
import {
  buildChartOptions,
  getHourChartMinWidth,
  sparsePointRadius,
} from '@/utils/usage/chartConfig';
import { throughputRate, type ThroughputTrendPoint } from '@/utils/usage/throughputAnalytics';
import styles from '@/pages/UsagePage.module.scss';
import { bucketRangeAt, type AnalyticsBucketRange } from './analyticsBucketDrill';
import { AnalyticsBucketDrillControl } from './AnalyticsBucketDrillControl';
import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';

const SERIES_COLORS = {
  output: '#3B82F6',
  average: '#6B7280',
  visible: '#10B981',
} as const;

const formatTps = (value: number): string =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} tok/s`;

export interface ThroughputTrendChartProps {
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

export function ThroughputTrendChart({
  data,
  loading,
  isMobile,
  window,
  grain: period,
  onGrainChange: setPeriod,
  onBucketClick,
}: ThroughputTrendChartProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, hasSamples } = useMemo(() => {
    const points: ThroughputTrendPoint[] = data[period].throughput;
    const labels = points.map((point) =>
      period === 'hour'
        ? formatHourLabel(new Date(point.timestampMs))
        : formatDayLabel(new Date(point.timestampMs))
    );
    const series = [
      {
        key: 'output' as const,
        label: t('usage_stats.throughput_output_series'),
        values: points.map((point) => throughputRate(point.outputTokens, point.decodeDurationMs)),
        samples: points.map((point) => point.outputSamples),
      },
      {
        key: 'average' as const,
        label: t('usage_stats.throughput_average_series'),
        values: points.map((point) => throughputRate(point.averageTokens, point.averageDurationMs)),
        samples: points.map((point) => point.averageSamples),
      },
      {
        key: 'visible' as const,
        label: t('usage_stats.throughput_visible_series'),
        values: points.map((point) => throughputRate(point.visibleTokens, point.visibleDurationMs)),
        samples: points.map((point) => point.visibleSamples),
      },
    ];
    const chart: ChartData<'line'> = {
      labels,
      datasets: series.map((item) => ({
        label: item.label,
        data: item.values,
        borderColor: SERIES_COLORS[item.key],
        backgroundColor: SERIES_COLORS[item.key],
        borderDash: item.key === 'average' ? [6, 4] : undefined,
        tension: 0.35,
        spanGaps: true,
      })),
    };

    const baseOptions = buildChartOptions({ period, labels, isMobile });
    const bucketTimes = points.map((point) => point.timestampMs);
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
          radius: sparsePointRadius(baseOptions.elements?.point?.radius),
        },
      },
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...baseOptions.scales?.y?.ticks,
            callback: (value) => formatTps(Number(value)),
          },
        },
      },
      plugins: {
        ...baseOptions.plugins,
        tooltip: {
          ...baseOptions.plugins?.tooltip,
          callbacks: {
            ...baseOptions.plugins?.tooltip?.callbacks,
            label: (context) => `${context.dataset.label}: ${formatTps(Number(context.parsed.y))}`,
            afterBody: (items) => {
              const first = items[0];
              if (!first) return '';
              const count = series[first.datasetIndex]?.samples[first.dataIndex];
              return count !== undefined
                ? t('usage_stats.analytics_samples_in_bucket', { count })
                : '';
            },
          },
        },
      },
    };

    return {
      chartData: chart,
      chartOptions: options,
      hasSamples: points.some((point) => point.averageSamples > 0),
    };
  }, [data, period, isMobile, t, window, onBucketClick]);

  const labels = chartData.labels ?? [];

  return (
    <Card
      title={t('usage_stats.throughput_trend_title')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
            data-testid="analytics-throughput-hour"
            aria-pressed={period === 'hour'}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
            data-testid="analytics-throughput-day"
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
          <p className={styles.analyticsNote}>{t('usage_stats.throughput_trend_note')}</p>
        </div>
      ) : (
        <div className={styles.hint}>{t('analytics.no_measurements')}</div>
      )}
      {onBucketClick && !loading && hasSamples && (
        <AnalyticsBucketDrillControl
          key={period}
          id="throughput"
          times={data[period].throughput.map((point) => point.timestampMs)}
          grain={period}
          window={window}
          onOpen={onBucketClick}
        />
      )}
    </Card>
  );
}
