/**
 * LTS: provider status bars driven by the complete usage statistics (`/v0/management/usage`
 * via the LTS extension client, or the usage query workspace). Usage is attributed by the
 * auth index Core injects into v8 `api-keys`, falling back to API key/prefix sources.
 * Core recent-request summaries are only a fallback when full usage is unavailable.
 */
import {
  getFullUsageStatusDataForIdentity,
  getOpenAIProviderFullUsageStatusData,
  getOpenAIProviderStats,
  getStatsForIdentity,
} from '@/components/providers/utils';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { KeyStats, StatusBarData } from '@/utils/usage';
import type { UsageDetailsByAuthIndex, UsageDetailsBySource } from '@/utils/usageIndex';
import type { ProviderResource } from './types';

export interface ProviderFullUsage {
  keyStats: KeyStats;
  usageDetailsBySource: UsageDetailsBySource;
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex;
}

export interface ProviderFullUsageStatus {
  statusData: StatusBarData;
  stats: { success: number; failure: number };
}

export function resolveFullUsageStatus(
  resource: ProviderResource,
  usage: ProviderFullUsage
): ProviderFullUsageStatus {
  if (resource.brand === 'openaiCompatibility') {
    const provider = resource.raw as OpenAIProviderConfig;
    return {
      statusData: getOpenAIProviderFullUsageStatusData(
        provider,
        usage.usageDetailsBySource,
        usage.usageDetailsByAuthIndex
      ),
      stats: getOpenAIProviderStats(provider, usage.keyStats),
    };
  }
  const config = resource.raw as ProviderKeyConfig;
  const identity = { authIndex: config.authIndex, apiKey: config.apiKey, prefix: config.prefix };
  return {
    statusData: getFullUsageStatusDataForIdentity(
      identity,
      usage.usageDetailsBySource,
      usage.usageDetailsByAuthIndex
    ),
    stats: getStatsForIdentity(identity, usage.keyStats),
  };
}
