import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { UsageQuerySession } from '@/types/usageQuery';
import type { AnalyticsTimeWindow, ModelStatsSummary } from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { useUsageAnalyticsDetails } from './hooks/useUsageAnalyticsDetails';
import { CacheEfficiencyCard } from './CacheEfficiencyCard';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';
import { LatencyDistributionCard } from './LatencyDistributionCard';
import { LatencyTrendChart } from './LatencyTrendChart';
import { ModelShareCard } from './ModelShareCard';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageAnalyticsSectionProps {
  querySession: UsageQuerySession | null;
  legacyUsage: UsagePayload | null;
  timeWindow: AnalyticsTimeWindow | null;
  loading: boolean;
  isMobile: boolean;
  modelStats: ModelStatsSummary[];
  showPricing: boolean;
}

export function UsageAnalyticsSection({
  querySession,
  legacyUsage,
  timeWindow,
  loading,
  isMobile,
  modelStats,
  showPricing,
}: UsageAnalyticsSectionProps) {
  const { t } = useTranslation();
  const { details, loading: samplesLoading, error, loadedCount, needsManualLoad, load } =
    useUsageAnalyticsDetails(querySession, legacyUsage, timeWindow);

  const idle = loading && details.length === 0;

  return (
    <section className={styles.analyticsSection} aria-label={t('usage_stats.analytics_section_title')}>
      <div className={styles.analyticsSectionHeader}>
        <h2 className={styles.analyticsSectionTitle}>{t('usage_stats.analytics_section_title')}</h2>
        <p className={styles.analyticsSectionHint}>{t('usage_stats.analytics_section_hint')}</p>
        <div className={styles.analyticsSectionStatus}>
          {querySession !== null && needsManualLoad ? (
            <Button variant="secondary" size="sm" onClick={load}>
              {t('usage_stats.analytics_load_samples')}
            </Button>
          ) : (
            loadedCount > 0 && (
              <span className={styles.analyticsSampleCount}>
                {samplesLoading
                  ? t('usage_stats.analytics_samples_loading', { count: loadedCount })
                  : t('usage_stats.analytics_samples_loaded', { count: loadedCount })}
              </span>
            )
          )}
        </div>
      </div>
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}
      <div className={styles.analyticsGrid}>
        <LatencyTrendChart
          details={details}
          loading={idle}
          isMobile={isMobile}
          timeWindow={timeWindow}
        />
        <CacheEfficiencyCard
          details={details}
          loading={idle}
          isMobile={isMobile}
          timeWindow={timeWindow}
        />
        <LatencyDistributionCard details={details} loading={idle} isMobile={isMobile} />
        <ErrorAnalysisCard
          details={details}
          loading={idle}
          isMobile={isMobile}
          timeWindow={timeWindow}
        />
      </div>
      <ModelShareCard
        modelStats={modelStats}
        loading={loading}
        showPricing={showPricing}
        isMobile={isMobile}
      />
    </section>
  );
}
