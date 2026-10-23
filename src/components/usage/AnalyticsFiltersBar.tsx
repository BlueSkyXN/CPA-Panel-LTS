import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore, useConfigStore } from '@/stores';
import type { CredentialInfo } from '@/types/sourceInfo';
import { normalizeAuthIndex } from '@/utils/usage';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import { isServiceTierFlow } from '@/utils/usage/serviceTier';
import {
  buildAnalyticsSources,
  type AnalyticsFilterOptions,
  type AnalyticsFilters,
} from '@/utils/usage/analyticsFilters';
import styles from '@/pages/AnalyticsPage.module.scss';

const ALL = '__all__';

export function AnalyticsFiltersBar({
  options,
  filters,
  onChange,
  active,
}: {
  options: AnalyticsFilterOptions | null;
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
  active: boolean;
}) {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const scope = useAuthStore((state) => JSON.stringify([state.apiBase, state.managementKey]));
  const [credentials, setCredentials] = useState<{
    scope: string;
    files: Map<string, CredentialInfo>;
    failed: boolean;
  } | null>(null);
  const current = credentials?.scope === scope ? credentials : null;
  useEffect(() => {
    if (!active || current) return;
    let cancelled = false;
    void authFilesApi
      .list()
      .then((response) => {
        if (cancelled) return;
        const files = new Map<string, CredentialInfo>();
        for (const file of response.files) {
          const key = normalizeAuthIndex(file.auth_index ?? file.authIndex);
          if (key)
            files.set(key, {
              name: file.name || key,
              type: String(file.type || file.provider || ''),
            });
        }
        setCredentials({ scope, files, failed: false });
      })
      .catch(() => {
        if (!cancelled) setCredentials({ scope, files: new Map(), failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [active, current, scope]);
  const sources = useMemo(
    () =>
      buildAnalyticsSources(
        options?.identities ?? [],
        buildSourceInfoMap(config ?? {}),
        current?.files ?? new Map()
      ),
    [options, config, current]
  );
  const selected = filters.source;
  const sourceOptions =
    selected && !sources.some((source) => source.value === selected.value)
      ? [selected, ...sources]
      : sources;
  const models = [
    ...new Set([
      ...(options?.models ?? []),
      ...(filters.model !== undefined ? [filters.model] : []),
    ]),
  ].sort();
  const efforts = [
    ...new Set(
      [...(options?.efforts ?? []), ...(filters.effort !== undefined ? [filters.effort] : [])].map(
        (effort) => effort.trim().toLowerCase()
      )
    ),
  ].sort();
  const activeFilterCount =
    Number(filters.model !== undefined) +
    Number(!!selected) +
    Number(filters.tier !== undefined) +
    Number(filters.effort !== undefined);
  // 逐个可移除的条件标签：下钻到达本页时直接看到当前生效的条件并单独撤销。
  const tierLabels: Record<string, string> = {
    fast: t('usage_stats.request_events_tier_fast'),
    std: t('usage_stats.request_events_tier_standard'),
    fast_to_std: t('usage_stats.request_events_tier_fast_to_std'),
    std_to_fast: t('usage_stats.request_events_tier_std_to_fast'),
  };
  const removableTags = [
    filters.model !== undefined
      ? {
          key: 'model',
          label: `${t('usage_stats.request_events_filter_model')}: ${filters.model || '—'}`,
          remove: () => onChange({ ...filters, model: undefined }),
        }
      : null,
    selected
      ? {
          key: 'source',
          label: `${t('usage_stats.request_events_filter_source')}: ${selected.label}`,
          remove: () => onChange({ ...filters, source: undefined }),
        }
      : null,
    filters.tier !== undefined
      ? {
          key: 'tier',
          label: `${t('usage_stats.request_events_filter_tier')}: ${tierLabels[filters.tier] ?? filters.tier}`,
          remove: () => onChange({ ...filters, tier: undefined }),
        }
      : null,
    filters.effort !== undefined
      ? {
          key: 'effort',
          label: `${t('usage_stats.request_events_filter_effort')}: ${
            filters.effort || t('usage_stats.request_events_effort_legacy_unknown')
          }`,
          remove: () => onChange({ ...filters, effort: undefined }),
        }
      : null,
  ].filter((tag): tag is { key: string; label: string; remove: () => void } => tag !== null);
  return (
    <>
      <div className={styles.filterField}>
        <span>{t('usage_stats.request_events_filter_model')}</span>
        <Select
          value={filters.model === undefined ? ALL : `model:${filters.model}`}
          options={[
            { value: ALL, label: t('usage_stats.filter_all') },
            ...models.map((model) => ({ value: `model:${model}`, label: model || '—' })),
          ]}
          onChange={(value) =>
            onChange({ ...filters, model: value === ALL ? undefined : value.slice(6) })
          }
          ariaLabel={t('usage_stats.request_events_filter_model')}
        />
      </div>
      <div className={styles.filterField}>
        <span>{t('usage_stats.request_events_filter_source')}</span>
        <Select
          value={selected?.value ?? ALL}
          options={[{ value: ALL, label: t('usage_stats.filter_all') }, ...sourceOptions]}
          onChange={(value) =>
            onChange({ ...filters, source: sourceOptions.find((source) => source.value === value) })
          }
          ariaLabel={t('usage_stats.request_events_filter_source')}
        />
      </div>
      <div className={styles.filterField}>
        <span>{t('usage_stats.request_events_filter_tier')}</span>
        <Select
          value={filters.tier ?? ALL}
          options={[
            { value: ALL, label: t('usage_stats.filter_all') },
            { value: 'fast', label: t('usage_stats.request_events_tier_fast') },
            { value: 'std', label: t('usage_stats.request_events_tier_standard') },
            { value: 'fast_to_std', label: t('usage_stats.request_events_tier_fast_to_std') },
            { value: 'std_to_fast', label: t('usage_stats.request_events_tier_std_to_fast') },
          ]}
          onChange={(value) =>
            onChange({ ...filters, tier: isServiceTierFlow(value) ? value : undefined })
          }
          ariaLabel={t('usage_stats.request_events_filter_tier')}
        />
      </div>
      <div className={styles.filterField}>
        <span>{t('usage_stats.request_events_filter_effort')}</span>
        <Select
          value={filters.effort === undefined ? ALL : `effort:${filters.effort}`}
          options={[
            { value: ALL, label: t('usage_stats.filter_all') },
            ...efforts.map((effort) => ({
              value: `effort:${effort}`,
              label: effort || t('usage_stats.request_events_effort_legacy_unknown'),
            })),
          ]}
          onChange={(value) =>
            onChange({ ...filters, effort: value === ALL ? undefined : value.slice(7) })
          }
          ariaLabel={t('usage_stats.request_events_filter_effort')}
        />
      </div>
      <div className={styles.filterActions}>
        <span>{t('analytics.active_filters', { count: activeFilterCount })}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={activeFilterCount === 0}
          onClick={() => onChange({})}
        >
          {t('usage_stats.clear_filters')}
        </Button>
      </div>
      {removableTags.length > 0 && (
        <ul className={styles.filterTags} data-testid="analytics-filter-tags">
          {removableTags.map((tag) => (
            <li key={tag.key}>
              <span>{tag.label}</span>
              <button
                type="button"
                onClick={tag.remove}
                aria-label={t('analytics.remove_filter', { filter: tag.label })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {current?.failed && (
        <span className={styles.filterMessage} role="status">
          {t('analytics.source_names_unavailable')}{' '}
          <Button variant="secondary" size="sm" onClick={() => setCredentials(null)}>
            {t('common.retry')}
          </Button>
        </span>
      )}
    </>
  );
}
