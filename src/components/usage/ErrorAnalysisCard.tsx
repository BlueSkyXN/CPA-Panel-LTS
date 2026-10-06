import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildFailureTrendSeries,
  collectErrorAnalysisRows,
  formatCompactNumber,
  formatDayLabel,
  formatHourLabel,
  summarizeErrorAnalytics,
  type AnalyticsTimeWindow,
  type ErrorAnalyticsSummary,
  type ErrorFamily,
  type UsageDetail,
} from '@/utils/usage';
import { buildChartOptions, buildStaticAxisTheme, getHourChartMinWidth, sparsePointRadius } from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';

const FAILURE_RATE_COLOR = '#EF4444';

const FAMILY_COLORS: Record<ErrorFamily, string> = {
  '429': '#F59E0B',
  '4xx': '#FBBD23',
  '5xx': '#EF4444',
  other: '#9CA3AF',
};

export interface ErrorAnalysisCardProps {
  details: UsageDetail[];
  loading: boolean;
  isMobile: boolean;
  timeWindow: AnalyticsTimeWindow | null;
}

export function ErrorAnalysisCard({
  details,
  loading,
  isMobile,
  timeWindow,
}: ErrorAnalysisCardProps) {
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

  const { trendData, trendOptions, statusData, statusOptions, summary, hasTrend } = useMemo(() => {
    const rows = collectErrorAnalysisRows(details);
    const summary: ErrorAnalyticsSummary = summarizeErrorAnalytics(rows, { topReasonLimit: 5 });
    const trend = buildFailureTrendSeries(rows, period, timeWindow);
    const labels = trend.map((point) =>
      period === 'hour'
        ? formatHourLabel(new Date(point.timestampMs))
        : formatDayLabel(new Date(point.timestampMs))
    );

    const trendData: ChartData<'line'> = {
      labels,
      datasets: [
        {
          label: t('usage_stats.error_analysis_rate_series'),
          data: trend.map((point) => point.failureRate),
          borderColor: FAILURE_RATE_COLOR,
          backgroundColor: FAILURE_RATE_COLOR,
          tension: 0.35,
          spanGaps: true,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels, isMobile });
    const axis = buildStaticAxisTheme(isMobile ? 10 : 11);
    const trendOptions: ChartOptions<'line'> = {
      ...baseOptions,
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
          min: 0,
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
              const point = trend[context.dataIndex];
              if (!point || point.failureRate === null) {
                return `${context.dataset.label}: --`;
              }
              return `${context.dataset.label}: ${percentFormatter.format(
                point.failureRate
              )} (${point.failures}/${point.requests})`;
            },
          },
        },
      },
    };

    const statusData: ChartData<'bar'> = {
      labels: summary.byStatus.map((group) =>
        group.status === null ? t('usage_stats.error_analysis_unknown_status') : String(group.status)
      ),
      datasets: [
        {
          label: t('usage_stats.error_analysis_failures'),
          data: summary.byStatus.map((group) => group.count),
          backgroundColor: summary.byStatus.map((group) => FAMILY_COLORS[group.family]),
          borderColor: '#ffffff',
          borderWidth: 1,
        },
      ],
    };

    const statusOptions: ChartOptions<'bar'> = {
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
              const count = Number(context.parsed.x) || 0;
              const share =
                summary.failedRequests > 0 ? count / summary.failedRequests : null;
              return share === null ? `${count}` : `${count} (${percentFormatter.format(share)})`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: axis.gridColor },
          border: { color: axis.axisBorderColor },
          ticks: {
            color: axis.tickColor,
            font: axis.tickFont,
            precision: 0,
          },
        },
        y: {
          grid: { color: axis.gridColor, drawTicks: false },
          border: { color: axis.axisBorderColor },
          ticks: { color: axis.tickColor, font: axis.tickFont },
        },
      },
    };

    return {
      trendData,
      trendOptions,
      statusData,
      statusOptions,
      summary,
      hasTrend: trend.some((point) => point.requests > 0),
    };
  }, [details, period, isMobile, timeWindow, percentFormatter, t]);

  return (
    <Card
      title={t('usage_stats.error_analysis_title')}
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
      ) : summary.totalRequests > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.analyticsChips}>
            <span className={styles.analyticsChip}>
              <span className={styles.analyticsChipLabel}>{t('usage_stats.error_analysis_failure_rate')}</span>
              <span className={styles.analyticsChipValue}>
                {summary.failureRate === null ? '--' : percentFormatter.format(summary.failureRate)}
              </span>
            </span>
            <span className={styles.analyticsChip}>
              <span className={styles.analyticsChipLabel}>{t('usage_stats.error_analysis_failed_requests')}</span>
              <span className={styles.analyticsChipValue}>
                {formatCompactNumber(summary.failedRequests)} / {formatCompactNumber(summary.totalRequests)}
              </span>
            </span>
          </div>
          {hasTrend && (
            <div className={styles.chartArea}>
              <div className={styles.chartScroller}>
                <div
                  className={styles.chartCanvas}
                  style={
                    period === 'hour'
                      ? { minWidth: getHourChartMinWidth(trendData.labels?.length ?? 0, isMobile) }
                      : undefined
                  }
                >
                  <Line data={trendData} options={trendOptions} />
                </div>
              </div>
            </div>
          )}
          {summary.byStatus.length > 0 && (
            <div className={styles.errorStatusGrid}>
              <div className={styles.errorStatusChart}>
                <span className={styles.analyticsChipGroupLabel}>
                  {t('usage_stats.error_analysis_by_status')}
                </span>
                <div className={styles.errorStatusChartArea}>
                  <Bar data={statusData} options={statusOptions} />
                </div>
              </div>
              {summary.topReasons.length > 0 && (
                <div className={styles.errorReasons}>
                  <span className={styles.analyticsChipGroupLabel}>
                    {t('usage_stats.error_analysis_top_reasons')}
                  </span>
                  <ul className={styles.errorReasonList}>
                    {summary.topReasons.map((group) => (
                      <li key={group.reason} className={styles.errorReasonItem}>
                        <span className={styles.errorReasonText} title={group.reason}>
                          {group.reason}
                        </span>
                        <span className={styles.errorReasonCount}>{group.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
