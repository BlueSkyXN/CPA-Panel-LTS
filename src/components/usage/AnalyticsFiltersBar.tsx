import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore, useConfigStore } from '@/stores';
import type { CredentialInfo } from '@/types/sourceInfo';
import { normalizeAuthIndex } from '@/utils/usage';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
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
      <Button
        variant="secondary"
        size="sm"
        disabled={filters.model === undefined && !selected}
        onClick={() => onChange({})}
      >
        {t('usage_stats.clear_filters')}
      </Button>
      {current?.failed && (
        <span className={styles.note} role="status">
          {t('analytics.source_names_unavailable')}{' '}
          <Button variant="secondary" size="sm" onClick={() => setCredentials(null)}>
            {t('common.retry')}
          </Button>
        </span>
      )}
    </>
  );
}
