import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import {
  LATENCY_HISTOGRAM_EDGE_MS,
  buildLatencyHistogram,
  collectLatencyAnalysisRows,
  formatDurationMs,
  summarizeLatencyRows,
  type PercentileSummary,
  type UsageDetail,
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

const formatEdge = (edge: number): string =>
  edge >= 1_000 ? `${edge / 1_000}${edge % 1_000 === 500 ? '.5' : ''}s` : `${edge}ms`;

const buildBinLabels = (): string[] =>
  LATENCY_HISTOGRAM_EDGE_MS.map((edge, index) => {
    if (index === LATENCY_HISTOGRAM_EDGE_MS.length - 1) {
      return `≥${formatEdge(edge)}`;
    }
    if (index === 0) {
      return `<${formatEdge(LATENCY_HISTOGRAM_EDGE_MS[1])}`;
    }
    return `${formatEdge(edge)}–${formatEdge(LATENCY_HISTOGRAM_EDGE_MS[index + 1])}`;
  });

interface PercentileChipProps {
  label: string;
  summary: PercentileSummary;
}

function PercentileChipGroup({ label, summary }: PercentileChipProps) {
  return (
    <div className={styles.analyticsChipGroup}>
      <span className={styles.analyticsChipGroupLabel}>{label}</span>
      <div className={styles.analyticsChips}>
        {(['p50', 'p90', 'p95', 'p99'] as const).map((rank) => (
          <span key={rank} className={styles.analyticsChip}>
            <span className={styles.analyticsChipLabel}>{rank.toUpperCase()}</span>
            <span className={styles.analyticsChipValue}>
              {formatDurationMs(summary[rank])}
            </span>
          </span>
        ))}
        <span className={styles.analyticsChipMeta}>
          {summary.sampleCount.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export interface LatencyDistributionCardProps {
  details: UsageDetail[];
  loading: boolean;
}

export function LatencyDistributionCard({ details, loading }: LatencyDistributionCardProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, histogram, summaries } = useMemo(() => {
    const rows = collectLatencyAnalysisRows(details);
    const histogram = buildLatencyHistogram(rows);
    const summaries = summarizeLatencyRows(rows);
    const labels = buildBinLabels();

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
          grid: { color: 'rgba(17, 24, 39, 0.06)', drawTicks: false },
          ticks: {
            color: 'rgba(17, 24, 39, 0.72)',
            font: { size: 11 },
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(17, 24, 39, 0.06)' },
          ticks: { color: 'rgba(17, 24, 39, 0.72)', font: { size: 11 } },
        },
      },
    };

    return { chartData: data, chartOptions: options, histogram, summaries };
  }, [details, t]);

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
