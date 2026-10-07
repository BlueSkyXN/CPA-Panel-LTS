import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { UsageQuerySession } from '@/types/usageQuery';
import type { AnalyticsTimeWindow } from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { useUsageAnalyticsDetails } from './hooks/useUsageAnalyticsDetails';
import { CacheEfficiencyCard } from './CacheEfficiencyCard';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';
import { LatencyDistributionCard } from './LatencyDistributionCard';
import { LatencyTrendChart } from './LatencyTrendChart';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageAnalyticsSectionProps {
  querySession: UsageQuerySession | null;
  legacyUsage: UsagePayload | null;
  timeWindow: AnalyticsTimeWindow | null;
  loading: boolean;
  isMobile: boolean;
  active?: boolean;
  enabled?: boolean;
}

export function UsageAnalyticsSection({
  querySession,
  legacyUsage,
  timeWindow,
  loading,
  isMobile,
  active = true,
  enabled = true,
}: UsageAnalyticsSectionProps) {
  const { t } = useTranslation();
  const {
    details,
    loading: samplesLoading,
    error,
    loadedCount,
    totalCount,
    status,
    load,
    stop,
  } = useUsageAnalyticsDetails(querySession, legacyUsage, timeWindow, { active, enabled });
  const pending = loading || samplesLoading;
  const hasSamples = details.length > 0;
  const retryable = status === 'error' || status === 'stopped';

  return (
    <section
      className={styles.analyticsSection}
      aria-label={t('usage_stats.analytics_section_title')}
    >
      <div className={styles.analyticsSectionHeader}>
        <p className={styles.analyticsSectionHint}>{t('usage_stats.analytics_section_hint')}</p>
        <div className={styles.analyticsSectionStatus} role="status" aria-live="polite">
          {loading ? (
            t('common.loading')
          ) : (
            <>
              <span>
                {t(`analytics.samples_${status}`, { count: loadedCount, total: totalCount ?? '—' })}
              </span>
              {status === 'deferred' && (
                <Button variant="secondary" size="sm" onClick={load}>
                  {t('usage_stats.analytics_load_samples')}
                </Button>
              )}
              {retryable && (
                <Button variant="secondary" size="sm" onClick={load}>
                  {t('analytics.retry_samples')}
                </Button>
              )}
              {samplesLoading && (
                <Button variant="secondary" size="sm" onClick={stop}>
                  {t('analytics.stop_samples')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
      {hasSamples && status !== 'ready' && (
        <p className={styles.analyticsNote}>{t('analytics.partial_results')}</p>
      )}
      {!pending && !hasSamples && status === 'ready' && (
        <p className={styles.hint}>{t('analytics.empty_window')}</p>
      )}
      {(hasSamples || pending) && (
        <div className={styles.analyticsGrid}>
          <LatencyTrendChart
            details={details}
            loading={pending && !hasSamples}
            isMobile={isMobile}
            timeWindow={timeWindow}
          />
          <CacheEfficiencyCard
            details={details}
            loading={pending && !hasSamples}
            isMobile={isMobile}
            timeWindow={timeWindow}
          />
          <LatencyDistributionCard
            details={details}
            loading={pending && !hasSamples}
            isMobile={isMobile}
          />
          <ErrorAnalysisCard
            details={details}
            loading={pending && !hasSamples}
            isMobile={isMobile}
            timeWindow={timeWindow}
          />
        </div>
      )}
    </section>
  );
}
