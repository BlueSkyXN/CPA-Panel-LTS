import { useEffect, useMemo } from 'react';
import { useProviderStats } from '@/components/providers/hooks/useProviderStats';
import { indexUsageDetailsByAuthIndex, indexUsageDetailsBySource } from '@/utils/usageIndex';
import type { ProviderFullUsage } from './fullUsageStatus';

/**
 * LTS: complete-usage statistics for Workbench status bars. Returns `undefined` when usage
 * statistics are disabled or unavailable so callers can fall back to recent requests.
 */
export function useProviderFullUsage(enabled: boolean) {
  const { keyStats, usageDetails, querySummary, loadKeyStats, refreshKeyStats, error } =
    useProviderStats({ enabled });
  const usageDetailsBySource = useMemo(
    () => indexUsageDetailsBySource(usageDetails, querySummary),
    [usageDetails, querySummary]
  );
  const usageDetailsByAuthIndex = useMemo(
    () => indexUsageDetailsByAuthIndex(usageDetails, querySummary),
    [usageDetails, querySummary]
  );

  useEffect(() => {
    if (enabled) void loadKeyStats().catch(() => undefined);
  }, [enabled, loadKeyStats]);

  const fullUsage = useMemo<ProviderFullUsage | undefined>(
    () =>
      enabled && !error ? { keyStats, usageDetailsBySource, usageDetailsByAuthIndex } : undefined,
    [enabled, error, keyStats, usageDetailsBySource, usageDetailsByAuthIndex]
  );

  return { fullUsage, refreshFullUsage: refreshKeyStats };
}
