import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { AnalyticsSection } from '@/components/common/AnalyticsSection';
import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import type { AnalyticsBucketRange } from './analyticsBucketDrill';
import type { AnalyticsGrain, AnalyticsTimeWindow } from '@/utils/usage/analyticsBuckets';
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
  window,
  onBucketClick,
}: {
  data: UsageAnalyticsData;
  loading: boolean;
  isMobile: boolean;
  /** 当前查询窗口；随点击传入各趋势卡。 */
  window?: AnalyticsTimeWindow | null;
  /** 点击趋势图时间桶时触发；null 表示该卡不支持下钻。 */
  onBucketClick?: ((bucket: AnalyticsBucketRange) => void) | null;
}) {
  const { t } = useTranslation();
  // 四张趋势图共用同一时间粒度，切换一张图时其余同步，跨图对照无需重复操作。
  const [grain, setGrain] = useState<AnalyticsGrain>('hour');
  return (
    <div className={styles.analyticsGroups}>
      <AnalyticsSection
        title={t('analytics.group_performance')}
        description={t('analytics.group_performance_hint')}
      >
        <div className={styles.analyticsGrid}>
          <LatencyTrendChart
          data={data}
          loading={loading}
          isMobile={isMobile}
          window={window}
          grain={grain}
          onGrainChange={setGrain}
          onBucketClick={onBucketClick}
        />
          <ThroughputTrendChart
          data={data}
          loading={loading}
          isMobile={isMobile}
          window={window}
          grain={grain}
          onGrainChange={setGrain}
          onBucketClick={onBucketClick}
        />
        </div>
      </AnalyticsSection>
      <AnalyticsSection
        title={t('analytics.group_reliability')}
        description={t('analytics.group_reliability_hint')}
      >
        <div className={styles.analyticsGrid}>
          <CacheEfficiencyCard
          data={data}
          loading={loading}
          isMobile={isMobile}
          window={window}
          grain={grain}
          onGrainChange={setGrain}
          onBucketClick={onBucketClick}
        />
          <ErrorAnalysisCard
          data={data}
          loading={loading}
          isMobile={isMobile}
          window={window}
          grain={grain}
          onGrainChange={setGrain}
          onBucketClick={onBucketClick}
        />
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
