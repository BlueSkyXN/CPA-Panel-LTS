import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  formatCompactNumber,
  formatUsd,
  type ModelStatsSummary,
} from '@/utils/usage';
import { buildStaticAxisTheme } from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';

const SHARE_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#06B6D4',
  '#F97316',
  '#EC4899',
  '#84CC16',
  '#6B7280',
  '#94A3B8',
];

const MAX_SHARE_ROWS = 10;

type ShareMetric = 'requests' | 'tokens' | 'cost';

export interface ModelShareCardProps {
  modelStats: ModelStatsSummary[];
  loading: boolean;
  showPricing: boolean;
  isMobile?: boolean;
}

export function ModelShareCard({
  modelStats,
  loading,
  showPricing,
  isMobile = false,
}: ModelShareCardProps) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<ShareMetric>('requests');

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: 'percent',
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );

  const metricLabel = useMemo(
    () => ({
      requests: t('usage_stats.requests_count'),
      tokens: t('usage_stats.tokens_count'),
      cost: t('usage_stats.pricing_api_usd_estimate'),
    }),
    [t]
  );

  // 按钮用短文案，长标题保留在图表 tooltip 里。
  const metricButtonLabel = useMemo(
    () => ({
      requests: t('usage_stats.share_metric_requests'),
      tokens: t('usage_stats.share_metric_tokens'),
      cost: t('usage_stats.share_metric_cost'),
    }),
    [t]
  );

  const { chartData, chartOptions, hasData } = useMemo(() => {
    const metricValue = (stat: ModelStatsSummary): number =>
      metric === 'requests' ? stat.requests : metric === 'tokens' ? stat.tokens : stat.cost;

    const sorted = [...modelStats].sort((a, b) => metricValue(b) - metricValue(a));
    const visible = sorted.slice(0, MAX_SHARE_ROWS);
    const rest = sorted.slice(MAX_SHARE_ROWS);
    const restTotal = rest.reduce((sum, stat) => sum + metricValue(stat), 0);

    const rows = visible.map((stat) => ({
      label: stat.model,
      value: metricValue(stat),
    }));
    if (rest.length > 0 && restTotal > 0) {
      rows.push({ label: t('usage_stats.share_other_models', { count: rest.length }), value: restTotal });
    }
    const total = rows.reduce((sum, row) => sum + row.value, 0);

    const formatValue = (value: number): string =>
      metric === 'cost' ? formatUsd(value) : formatCompactNumber(value);

    const data: ChartData<'bar'> = {
      labels: rows.map((row) => row.label),
      datasets: [
        {
          label: metricLabel[metric],
          data: rows.map((row) => (total > 0 ? row.value / total : 0)),
          backgroundColor: rows.map((_, index) => SHARE_COLORS[index % SHARE_COLORS.length]),
          borderColor: '#ffffff',
          borderWidth: 1,
        },
      ],
    };

    const axis = buildStaticAxisTheme(isMobile ? 10 : 11);
    const options: ChartOptions<'bar'> = {
      indexAxis: 'y',
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
              const share = Number(context.parsed.x) || 0;
              const value = rows[context.dataIndex]?.value ?? 0;
              return `${formatValue(value)} (${percentFormatter.format(share)})`;
            },
          },
        },
      },
      scales: {
        x: {
          min: 0,
          max: 1,
          grid: { color: axis.gridColor },
          border: { color: axis.axisBorderColor },
          ticks: {
            color: axis.tickColor,
            font: axis.tickFont,
            callback: (value) => percentFormatter.format(Number(value)),
          },
        },
        y: {
          grid: { color: axis.gridColor, drawTicks: false },
          border: { color: axis.axisBorderColor },
          ticks: { color: axis.tickColor, font: axis.tickFont },
        },
      },
    };

    return { chartData: data, chartOptions: options, hasData: total > 0 };
  }, [modelStats, metric, metricLabel, isMobile, percentFormatter, t]);

  return (
    <Card
      title={t('usage_stats.share_title')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={metric === 'requests' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMetric('requests')}
          >
            {metricButtonLabel.requests}
          </Button>
          <Button
            variant={metric === 'tokens' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMetric('tokens')}
          >
            {metricButtonLabel.tokens}
          </Button>
          {showPricing && (
            <Button
              variant={metric === 'cost' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setMetric('cost')}
            >
              {metricButtonLabel.cost}
            </Button>
          )}
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : hasData ? (
        <div className={styles.chartWrapper}>
          <div className={styles.shareChartArea}>
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
