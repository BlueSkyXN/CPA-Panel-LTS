import { useProviderStats } from '@/components/providers/hooks/useProviderStats';
import type { KeyStats, UsageDetail } from '@/utils/usage';

export type UseAuthFilesStatsResult = {
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loadKeyStats: () => Promise<void>;
  refreshKeyStats: () => Promise<void>;
};

export function useAuthFilesStats(): UseAuthFilesStatsResult {
  return useProviderStats({ autoRefresh: false });
}
