import type { UsageQueryFilter, UsageQueryIdentity } from '@/types/usageQuery';
import type { CredentialInfo } from '@/types/sourceInfo';
import { isRecord } from '@/utils/helpers';
import { normalizeAuthIndex, normalizeUsageSourceId, type UsageDetail } from '@/utils/usage';
import { resolveSourceDisplay, type SourceInfoMap } from '@/utils/sourceResolver';

export interface AnalyticsSourceSelection {
  value: string;
  label: string;
  identities: UsageQueryIdentity[];
}

export interface AnalyticsFilters {
  model?: string;
  source?: AnalyticsSourceSelection;
}

export interface AnalyticsFilterOptions {
  models: string[];
  identities: UsageQueryIdentity[];
}

const identityKey = (identity: UsageQueryIdentity) =>
  JSON.stringify([identity.source, identity.auth_index]);

export function normalizedAnalyticsIdentity(identity: UsageQueryIdentity): UsageQueryIdentity {
  return { source: normalizeUsageSourceId(identity.source), auth_index: identity.auth_index };
}

export function buildAnalyticsSources(
  identities: UsageQueryIdentity[],
  sourceInfo: SourceInfoMap,
  authFiles: Map<string, CredentialInfo>
): AnalyticsSourceSelection[] {
  const sources = new Map<string, AnalyticsSourceSelection>();
  for (const raw of identities) {
    const identity = normalizedAnalyticsIdentity(raw);
    const info = resolveSourceDisplay(identity.source, identity.auth_index, sourceInfo, authFiles);
    const value = info.identityKey ?? `source:${identity.source}`;
    const existing = sources.get(value);
    if (existing) {
      if (!existing.identities.some((item) => identityKey(item) === identityKey(identity)))
        existing.identities.push(identity);
    } else {
      sources.set(value, { value, label: info.displayName, identities: [identity] });
    }
  }
  const labels = new Map<string, number>();
  for (const source of sources.values())
    labels.set(source.label, (labels.get(source.label) ?? 0) + 1);
  return [...sources.values()]
    .map((source) => ({
      ...source,
      label:
        (labels.get(source.label) ?? 0) > 1
          ? `${source.label} · ${source.identities.map((id) => id.auth_index || id.source).join(', ')}`
          : source.label,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function analyticsQueryFilter(
  filters: AnalyticsFilters,
  options: AnalyticsFilterOptions
): { filter: UsageQueryFilter; empty: boolean } {
  const filter: UsageQueryFilter = {};
  if (filters.model !== undefined) filter.model = filters.model;
  if (filters.source) {
    const selected = new Set(filters.source.identities.map(identityKey));
    filter.identities = options.identities.filter((id) =>
      selected.has(identityKey(normalizedAnalyticsIdentity(id)))
    );
    if (!filter.identities.length) return { filter, empty: true };
  }
  return { filter, empty: false };
}

export function matchesAnalyticsFilters(detail: UsageDetail, filters: AnalyticsFilters): boolean {
  if (filters.model !== undefined && detail.__modelName !== filters.model) return false;
  return (
    !filters.source ||
    filters.source.identities.some(
      (id) =>
        id.source === detail.source &&
        id.auth_index === (normalizeAuthIndex(detail.auth_index) ?? '')
    )
  );
}

export function legacyAnalyticsOptions(usage: unknown): AnalyticsFilterOptions {
  const models = new Set<string>();
  const identities = new Map<string, UsageQueryIdentity>();
  if (isRecord(usage) && isRecord(usage.apis)) {
    for (const api of Object.values(usage.apis)) {
      if (!isRecord(api) || !isRecord(api.models)) continue;
      for (const [model, data] of Object.entries(api.models)) {
        if (!isRecord(data) || !Array.isArray(data.details)) continue;
        for (const detail of data.details) {
          if (!isRecord(detail) || typeof detail.timestamp !== 'string') continue;
          models.add(model);
          const identity = {
            source: typeof detail.source === 'string' ? detail.source : '',
            auth_index:
              normalizeAuthIndex(detail.auth_index ?? detail.authIndex ?? detail.AuthIndex) ?? '',
          };
          identities.set(identityKey(identity), identity);
        }
      }
    }
  }
  return { models: [...models].sort(), identities: [...identities.values()] };
}

export function readAnalyticsNavigationState(state: unknown): AnalyticsFilters | null {
  if (!isRecord(state) || !isRecord(state.analyticsFilters)) return null;
  const filters = state.analyticsFilters;
  if (filters.model !== undefined && typeof filters.model !== 'string') return null;
  if (filters.source !== undefined) {
    const source = filters.source;
    if (
      !isRecord(source) ||
      typeof source.value !== 'string' ||
      typeof source.label !== 'string' ||
      !Array.isArray(source.identities) ||
      source.identities.length === 0 ||
      !source.identities.every(
        (id) => isRecord(id) && typeof id.source === 'string' && typeof id.auth_index === 'string'
      )
    )
      return null;
  }
  return filters as unknown as AnalyticsFilters;
}
