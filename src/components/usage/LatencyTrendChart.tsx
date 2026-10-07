import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildLatencyPercentileSeries,
  collectLatencyAnalysisRows,
  formatDayLabel,
  formatDurationMs,
  formatHourLabel,
  type AnalyticsTimeWindow,
  type UsageDetail,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth, sparsePointRadius } from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';

const SERIES_COLORS = {
  p50: '#10B981',
  p95: '#F59E0B',
  p99: '#EF4444',
  average: '#6B7280',
} as const;

export interface LatencyTrendChartProps {
  details: UsageDetail[];
  loading: boolean;
  isMobile: boolean;
  timeWindow: AnalyticsTimeWindow | null;
}

export function LatencyTrendChart({ details, loading, isMobile, timeWindow }: LatencyTrendChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');

  const { chartData, chartOptions, hasSamples } = useMemo(() => {
    const rows = collectLatencyAnalysisRows(details);
    const series = buildLatencyPercentileSeries(rows, period, timeWindow);
    const labels = series.times.map((time) =>
      period === 'hour' ? formatHourLabel(new Date(time)) : formatDayLabel(new Date(time))
    );
    const datasetLabels = {
      p50: 'P50',
      p95: 'P95',
      p99: 'P99',
      average: t('usage_stats.latency_trend_avg'),
    };
    const data: ChartData<'line'> = {
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
    const options: ChartOptions<'line'> = {
      ...baseOptions,
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
              return count !== null
                ? t('usage_stats.analytics_samples_in_bucket', { count })
                : '';
            },
          },
        },
      },
    };

    return {
      chartData: data,
      chartOptions: options,
      hasSamples: series.sampleCounts.some((count) => count > 0),
    };
  }, [details, period, isMobile, timeWindow, t]);

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
      ) : hasSamples && labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset) => (
              <div key={dataset.label} className={styles.legendItem} title={dataset.label}>
                <span className={styles.legendDot} style={{ backgroundColor: dataset.borderColor as string }} />
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
    </Card>
  );
}
