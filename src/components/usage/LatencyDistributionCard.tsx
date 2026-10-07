import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import {
  buildLatencyHistogram,
  collectLatencyAnalysisRows,
  formatDurationMs,
  summarizeLatencyRows,
  type PercentileSummary,
  type UsageDetail,
} from '@/utils/usage';
import { buildStaticAxisTheme } from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';

/**
 * 紧凑桶标签：与 LATENCY_HISTOGRAM_EDGE_MS 一一对应；
 * 单位在首标签声明一次，避免移动端 45° 旋转时互相重叠。
 */
const HISTOGRAM_BIN_LABELS: readonly string[] = [
  '<100ms',
  '100–250',
  '250–500',
  '0.5–1s',
  '1–2.5s',
  '2.5–5s',
  '5–10s',
  '≥10s',
];

interface PercentileChipGroupProps {
  label: string;
  summary: PercentileSummary;
}

function PercentileChipGroup({ label, summary }: PercentileChipGroupProps) {
  return (
    <div className={styles.analyticsChipGroup}>
      <span className={styles.analyticsChipGroupLabel}>
        {label} · n={summary.sampleCount.toLocaleString()}
      </span>
      <div className={styles.analyticsChips}>
        {(['p50', 'p90', 'p95', 'p99'] as const).map((rank) => (
          <span key={rank} className={styles.analyticsChip}>
            <span className={styles.analyticsChipLabel}>{rank.toUpperCase()}</span>
            <span className={styles.analyticsChipValue}>
              {formatDurationMs(summary[rank])}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export interface LatencyDistributionCardProps {
  details: UsageDetail[];
  loading: boolean;
  isMobile?: boolean;
}

export function LatencyDistributionCard({ details, loading, isMobile = false }: LatencyDistributionCardProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, histogram, summaries } = useMemo(() => {
    const rows = collectLatencyAnalysisRows(details);
    const histogram = buildLatencyHistogram(rows);
    const summaries = summarizeLatencyRows(rows);
    const labels = [...HISTOGRAM_BIN_LABELS];
    const axis = buildStaticAxisTheme(isMobile ? 10 : 11);

    const data: ChartData<'bar'> = {
      labels,
      datasets: [
        {
          label: t('usage_stats.latency_distribution_series'),
          data: histogram.counts,
          backgroundColor: '#3B82F6',
          borderColor: '#ffffff',
          borderWidth: 1,
          categoryPercentage: 0.82,
          barPercentage: 0.88,
        },
      ],
    };

    const options: ChartOptions<'bar'> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          titleColor: '#111827',
          bodyColor: '#374151',
          borderColor: 'rgba(17, 24, 39, 0.10)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (context) => {
              const count = Number(context.parsed.y) || 0;
              const share =
                histogram.sampleCount > 0 ? (count / histogram.sampleCount) * 100 : null;
              return share === null
                ? `${count}`
                : `${count} (${share.toFixed(1)}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: axis.gridColor, drawTicks: false },
          border: { color: axis.axisBorderColor },
          ticks: {
            color: axis.tickColor,
            font: axis.tickFont,
            maxRotation: isMobile ? 45 : 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: isMobile ? 4 : 8,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: axis.gridColor },
          border: { color: axis.axisBorderColor },
          ticks: {
            color: axis.tickColor,
            font: axis.tickFont,
            precision: 0,
          },
        },
      },
    };

    return { chartData: data, chartOptions: options, histogram, summaries };
  }, [details, isMobile, t]);

  return (
    <Card title={t('usage_stats.latency_distribution_title')}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : histogram.sampleCount > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div className={styles.chartCanvas}>
                <Bar data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
          <div className={styles.analyticsChipStack}>
            <PercentileChipGroup label={t('usage_stats.latency_distribution_latency')} summary={summaries.latency} />
            <PercentileChipGroup label={t('usage_stats.request_events_first_content')} summary={summaries.firstContent} />
            <PercentileChipGroup label={t('usage_stats.request_events_ttft')} summary={summaries.ttft} />
            <PercentileChipGroup label={t('usage_stats.request_events_ttfa')} summary={summaries.ttfa} />
          </div>
          <p className={styles.analyticsNote}>{t('usage_stats.analytics_success_only_note')}</p>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
