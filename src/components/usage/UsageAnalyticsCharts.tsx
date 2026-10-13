import { useTranslation } from 'react-i18next';
import { AnalyticsSection } from '@/components/common/AnalyticsSection';
import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { CacheEfficiencyCard } from './CacheEfficiencyCard';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';
import { LatencyDistributionCard } from './LatencyDistributionCard';
import { LatencyTrendChart } from './LatencyTrendChart';
import { RequestSizeDistributionCard } from './RequestSizeDistributionCard';
import { ThroughputTrendChart } from './ThroughputTrendChart';
import styles from '@/pages/UsagePage.module.scss';

export function UsageAnalyticsCharts({
  data,
  loading,
  isMobile,
}: {
  data: UsageAnalyticsData;
  loading: boolean;
  isMobile: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.analyticsGroups}>
      <AnalyticsSection
        title={t('analytics.group_performance')}
        description={t('analytics.group_performance_hint')}
      >
        <div className={styles.analyticsGrid}>
          <LatencyTrendChart data={data} loading={loading} isMobile={isMobile} />
          <ThroughputTrendChart data={data} loading={loading} isMobile={isMobile} />
        </div>
      </AnalyticsSection>
      <AnalyticsSection
        title={t('analytics.group_reliability')}
        description={t('analytics.group_reliability_hint')}
      >
        <div className={styles.analyticsGrid}>
          <CacheEfficiencyCard data={data} loading={loading} isMobile={isMobile} />
          <ErrorAnalysisCard data={data} loading={loading} isMobile={isMobile} />
        </div>
      </AnalyticsSection>
      <AnalyticsSection
        title={t('analytics.group_distribution')}
        description={t('analytics.group_distribution_hint')}
      >
        <div className={styles.analyticsGrid}>
          <LatencyDistributionCard data={data} loading={loading} isMobile={isMobile} />
          <RequestSizeDistributionCard data={data} loading={loading} />
        </div>
      </AnalyticsSection>
    </div>
  );
}
