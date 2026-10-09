import type { UsageAnalyticsData } from '@/types/usageAnalytics';
import { CacheEfficiencyCard } from './CacheEfficiencyCard';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';
import { LatencyDistributionCard } from './LatencyDistributionCard';
import { LatencyTrendChart } from './LatencyTrendChart';
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
  return (
    <div className={styles.analyticsGrid}>
      <LatencyTrendChart data={data} loading={loading} isMobile={isMobile} />
      <CacheEfficiencyCard data={data} loading={loading} isMobile={isMobile} />
      <LatencyDistributionCard data={data} loading={loading} isMobile={isMobile} />
      <ErrorAnalysisCard data={data} loading={loading} isMobile={isMobile} />
    </div>
  );
}
