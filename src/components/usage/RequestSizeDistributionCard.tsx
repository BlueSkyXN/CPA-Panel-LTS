import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { formatFileSize } from '@/utils/format';
import { formatCompactNumber } from '@/utils/usage';
import { LARGE_REQUEST_BYTES } from '@/utils/usage/requestSize';
import styles from '@/pages/UsagePage.module.scss';

export interface RequestSizeDistributionCardProps {
  data: UsageAnalyticsData;
  loading: boolean;
}

/**
 * Upstream request size distribution (Core request size tracking). Hidden entirely when the
 * window carries no measured request, so older Cores keep the previous layout.
 */
export function RequestSizeDistributionCard({ data, loading }: RequestSizeDistributionCardProps) {
  const { t, i18n } = useTranslation();
  const distribution = data.requestSize;
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.language]
  );
  if (loading || !distribution) return null;

  const rows = distribution.edges
    .map((edge, i) => {
      const next = distribution.edges[i + 1];
      const requests = distribution.requests[i];
      const failures = distribution.failures[i];
      const websocketRequests = distribution.websocketRequests[i];
      return {
        key: edge,
        large: edge >= LARGE_REQUEST_BYTES,
        label:
          next === undefined
            ? t('usage_stats.request_size_bucket_open', { from: formatFileSize(edge) })
            : t('usage_stats.request_size_bucket_range', {
                from: formatFileSize(edge),
                to: formatFileSize(next),
              }),
        requests,
        failures,
        failureRate: requests > 0 ? failures / requests : null,
        websocketShare: requests > 0 ? websocketRequests / requests : null,
        websocketFailures: distribution.websocketFailures[i],
      };
    })
    .filter((row) => row.requests > 0);
  const largeRequests = rows.filter((row) => row.large).reduce((sum, row) => sum + row.requests, 0);
  const largeFailures = rows.filter((row) => row.large).reduce((sum, row) => sum + row.failures, 0);
  const format = (value: number | null) => (value === null ? '--' : percentFormatter.format(value));

  return (
    <Card title={t('usage_stats.request_size_title')}>
      <div className={styles.chartWrapper} data-testid="request-size-distribution">
        <div className={styles.analyticsChips}>
          <span className={styles.analyticsChip}>
            <span className={styles.analyticsChipLabel}>{t('usage_stats.request_size_measured')}</span>
            <span className={styles.analyticsChipValue}>
              {formatCompactNumber(distribution.sampleCount)}
            </span>
          </span>
          <span className={styles.analyticsChip} title={t('usage_stats.request_size_large_hint')}>
            <span className={styles.analyticsChipLabel}>{t('usage_stats.request_size_large')}</span>
            <span className={styles.analyticsChipValue}>
              {formatCompactNumber(largeRequests)}
              {largeRequests > 0 && ` · ${format(largeFailures / largeRequests)}`}
            </span>
          </span>
          {distribution.unmeasured > 0 && (
            <span className={styles.analyticsChip} title={t('usage_stats.request_size_unmeasured_hint')}>
              <span className={styles.analyticsChipLabel}>
                {t('usage_stats.request_size_unmeasured')}
              </span>
              <span className={styles.analyticsChipValue}>
                {formatCompactNumber(distribution.unmeasured)}
              </span>
            </span>
          )}
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage_stats.request_size_bucket')}</th>
                <th>{t('usage_stats.request_size_requests')}</th>
                <th>{t('usage_stats.request_size_failures')}</th>
                <th>{t('usage_stats.request_size_failure_rate')}</th>
                <th title={t('usage_stats.request_size_websocket_share_hint')}>
                  {t('usage_stats.request_size_websocket_share')}
                </th>
                <th>{t('usage_stats.request_size_websocket_failures')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} data-request-size-bucket={row.key}>
                  <td>{row.label}</td>
                  <td>{formatCompactNumber(row.requests)}</td>
                  <td>{formatCompactNumber(row.failures)}</td>
                  <td>{format(row.failureRate)}</td>
                  <td>{format(row.websocketShare)}</td>
                  <td>{formatCompactNumber(row.websocketFailures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
