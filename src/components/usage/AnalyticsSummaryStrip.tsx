import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { useTranslation } from 'react-i18next';
import { formatCompactNumber, formatDurationMs } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface AnalyticsSummaryStripProps {
  data: UsageAnalyticsData;
  totalRecords: number;
  loading: boolean;
  /** 点击失败指标时携带当前筛选进入请求明细。 */
  onOpenFailed?: () => void;
  canOpenFailed?: boolean;
}

export function AnalyticsSummaryStrip({
  data,
  totalRecords,
  loading,
  onOpenFailed,
  canOpenFailed = false,
}: AnalyticsSummaryStripProps) {
  const { t, i18n } = useTranslation();
  const percentFormatter = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
  });
  const latency = data.timings.latency;
  const ttfa = data.timings.ttfa;
  const errors = data.errors;
  const cache = data.cache;

  const percentText = (value: number | null) =>
    value === null ? '—' : percentFormatter.format(value);

  const chips: Array<{
    key: string;
    label: string;
    value: string;
    meta?: string;
    title?: string;
    button?: boolean;
    onClick?: () => void;
  }> = [
    {
      key: 'records',
      label: t('analytics.summary_records'),
      value: loading && totalRecords === 0 ? '…' : formatCompactNumber(totalRecords),
      title: t('analytics.summary_records_hint'),
    },
    {
      key: 'failures',
      label: t('analytics.summary_failures'),
      value:
        loading && errors.totalRequests === 0
          ? '…'
          : `${formatCompactNumber(errors.failedRequests)} / ${formatCompactNumber(errors.totalRequests)}`,
      meta: percentText(errors.failureRate),
      title: t('analytics.summary_failures_hint'),
      button: canOpenFailed && errors.failedRequests > 0 && Boolean(onOpenFailed),
      onClick: onOpenFailed,
    },
    {
      key: 'latency',
      label: t('analytics.summary_latency'),
      value: latency.p95 === null ? '—' : formatDurationMs(latency.p95),
      meta:
        latency.sampleCount > 0
          ? t('analytics.summary_samples', { count: latency.sampleCount })
          : '',
      title: t('usage_stats.analytics_success_only_note'),
    },
    {
      key: 'ttfa',
      label: t('analytics.summary_ttfa'),
      value: ttfa.p95 === null ? '—' : formatDurationMs(ttfa.p95),
      meta:
        ttfa.sampleCount > 0
          ? t('analytics.summary_samples', { count: ttfa.sampleCount })
          : '',
      title: t('usage_stats.request_events_ttfa_hint'),
    },
    {
      key: 'cache',
      label: t('analytics.summary_cache'),
      value: percentText(cache.cacheReadRate),
      meta:
        cache.inputTokens > 0
          ? t('analytics.summary_cache_meta', {
              read: formatCompactNumber(cache.cacheReadTokens),
              input: formatCompactNumber(cache.inputTokens),
            })
          : '',
      title: t('usage_stats.cache_analytics_read_rate'),
    },
  ];

  return (
    <div className={styles.analyticsChips} data-testid="analytics-summary-strip" aria-busy={loading}>
      {chips.map((chip) =>
        chip.button && chip.onClick ? (
          <button
            key={chip.key}
            type="button"
            data-testid={`analytics-summary-${chip.key}`}
            className={styles.summaryChipButton}
            title={chip.title}
            onClick={chip.onClick}
          >
            <span className={styles.analyticsChipLabel}>{chip.label}</span>
            <span className={styles.analyticsChipValue}>{chip.value}</span>
            {chip.meta && <span className={styles.analyticsChipMeta}>{chip.meta}</span>}
          </button>
        ) : (
          <span key={chip.key} className={styles.analyticsChip} title={chip.title}>
            <span className={styles.analyticsChipLabel}>{chip.label}</span>
            <span className={styles.analyticsChipValue}>{chip.value}</span>
            {chip.meta && <span className={styles.analyticsChipMeta}>{chip.meta}</span>}
          </span>
        )
      )}
    </div>
  );
}
