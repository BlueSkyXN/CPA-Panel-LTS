import { useTranslation } from 'react-i18next';
import { AnalyticsSection } from '@/components/common/AnalyticsSection';
import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import type { AnalyticsBucketRange } from './analyticsBucketDrill';
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
  onBucketClick,
}: {
  data: UsageAnalyticsData;
  loading: boolean;
  isMobile: boolean;
  /** 点击趋势图时间桶时触发；null 表示该卡不支持下钻。 */
  onBucketClick?: ((bucket: AnalyticsBucketRange) => void) | null;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.analyticsGroups}>
      <AnalyticsSection
        title={t('analytics.group_performance')}
        description={t('analytics.group_performance_hint')}
      >
        <div className={styles.analyticsGrid}>
          <LatencyTrendChart data={data} loading={loading} isMobile={isMobile} onBucketClick={onBucketClick} />
          <ThroughputTrendChart data={data} loading={loading} isMobile={isMobile} onBucketClick={onBucketClick} />
        </div>
      </AnalyticsSection>
      <AnalyticsSection
        title={t('analytics.group_reliability')}
        description={t('analytics.group_reliability_hint')}
      >
        <div className={styles.analyticsGrid}>
          <CacheEfficiencyCard data={data} loading={loading} isMobile={isMobile} onBucketClick={onBucketClick} />
          <ErrorAnalysisCard data={data} loading={loading} isMobile={isMobile} onBucketClick={onBucketClick} />
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
