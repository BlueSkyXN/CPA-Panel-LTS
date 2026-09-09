import type { UsageDetail } from '@/utils/usage';
import { normalizeAuthIndex } from '@/utils/usage';
import type { UsageQuerySummary } from '@/types/usageQuery';

export interface UsageQueryStatusIndex { kind: 'usage-query-status'; summary: UsageQuerySummary }
export type UsageDetailsBySource = Map<string, UsageDetail[]> | UsageQueryStatusIndex;
export type UsageDetailsByAuthIndex = Map<string, UsageDetail[]> | UsageQueryStatusIndex;
export const isUsageQueryStatusIndex = (index: UsageDetailsBySource): index is UsageQueryStatusIndex => !(index instanceof Map);

const EMPTY_USAGE_DETAILS: UsageDetail[] = [];

export function indexUsageDetailsBySource(usageDetails: UsageDetail[], summary?: UsageQuerySummary | null): UsageDetailsBySource {
  if (summary) return { kind: 'usage-query-status', summary };
  const map: UsageDetailsBySource = new Map();

  usageDetails.forEach((detail) => {
    const sourceId = detail.source;
    if (!sourceId) return;

    const bucket = map.get(sourceId);
    if (bucket) {
      bucket.push(detail);
    } else {
      map.set(sourceId, [detail]);
    }
  });

  return map;
}

export function indexUsageDetailsByAuthIndex(usageDetails: UsageDetail[], summary?: UsageQuerySummary | null): UsageDetailsByAuthIndex {
  if (summary) return { kind: 'usage-query-status', summary };
  const map: UsageDetailsByAuthIndex = new Map();

  usageDetails.forEach((detail) => {
    const authIndexKey = normalizeAuthIndex(detail.auth_index);
    if (!authIndexKey) return;

    const bucket = map.get(authIndexKey);
    if (bucket) {
      bucket.push(detail);
    } else {
      map.set(authIndexKey, [detail]);
    }
  });

  return map;
}

export function collectUsageDetailsForCandidates(
  usageDetailsBySource: UsageDetailsBySource,
  candidates: Iterable<string>
): UsageDetail[] {
  if (isUsageQueryStatusIndex(usageDetailsBySource)) throw new Error('A status summary is not a detail index');
  return collectUsageDetailsForKeys(usageDetailsBySource, candidates);
}

export function collectUsageDetailsForAuthIndices(
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex,
  authIndices: Iterable<string>
): UsageDetail[] {
  if (isUsageQueryStatusIndex(usageDetailsByAuthIndex)) throw new Error('A status summary is not a detail index');
  return collectUsageDetailsForKeys(usageDetailsByAuthIndex, authIndices);
}

function collectUsageDetailsForKeys(
  usageDetailsByKey: Map<string, UsageDetail[]>,
  keys: Iterable<string>
): UsageDetail[] {
  let firstDetails: UsageDetail[] | null = null;
  let merged: UsageDetail[] | null = null;

  for (const key of keys) {
    const details = usageDetailsByKey.get(key);
    if (!details || details.length === 0) continue;

    if (!firstDetails) {
      firstDetails = details;
      continue;
    }

    if (!merged) {
      merged = [...firstDetails];
    }
    for (const detail of details) {
      merged.push(detail);
    }
  }

  return merged ?? firstDetails ?? EMPTY_USAGE_DETAILS;
}
