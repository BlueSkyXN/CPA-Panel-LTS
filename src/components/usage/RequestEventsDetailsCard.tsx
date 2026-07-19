import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  collectUsageDetails,
  extractLatencyMs,
  extractTotalTokens,
  formatDurationMs,
  LATENCY_SOURCE_FIELD,
  normalizeAuthIndex,
  resolveServiceTier,
  type ResolvedServiceTier,
} from '@/utils/usage';
import {
  getUsageCacheTokenCounts,
  getUsageUncachedInputTokenCount,
} from '@/utils/usage/cacheTokens';
import { normalizeReasoningEffort } from '@/utils/usage/reasoningEffort';
import { downloadBlob } from '@/utils/download';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const SERVICE_TIER_FAST_FILTER = '__service_tier_fast__';
const SERVICE_TIER_STD_FILTER = '__service_tier_std__';
const REASONING_EFFORT_LEGACY_UNKNOWN_FILTER = '__reasoning_effort_legacy_unknown__';
const REASONING_EFFORT_RAW_FILTER_PREFIX = '__reasoning_effort_raw__:';
const MAX_RENDERED_EVENTS = 500;

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  serviceTier: string | null;
  requestServiceTier: string | null;
  responseServiceTier: string | null;
  effectiveServiceTier: string | null;
  resolvedServiceTier: ResolvedServiceTier;
  serviceTierFilterValue: string;
  serviceTierLabel: string;
  serviceTierTitle: string;
  reasoningEffort: string | null;
  reasoningEffortFilterValue: string;
  reasoningEffortLabel: string;
  failed: boolean;
  latencyMs: number | null;
  inputTokens: number;
  uncachedInputTokens: number | null;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

export interface RequestEventsDetailsCardProps {
  usage: unknown;
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const getReasoningEffortFilterValue = (reasoningEffort: string | null): string => {
  if (!reasoningEffort) return REASONING_EFFORT_LEGACY_UNKNOWN_FILTER;
  return `${REASONING_EFFORT_RAW_FILTER_PREFIX}${encodeURIComponent(
    reasoningEffort.toLowerCase()
  )}`;
};

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

export function RequestEventsDetailsCard({
  usage,
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: RequestEventsDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });

  const [modelFilter, setModelFilter] = useState(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState(ALL_FILTER);
  const [serviceTierFilter, setServiceTierFilter] = useState(ALL_FILTER);
  const [reasoningEffortFilter, setReasoningEffortFilter] = useState(ALL_FILTER);
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());

  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString(),
          });
        });
        setAuthFileMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const rows = useMemo<RequestEventRow[]>(() => {
    const details = collectUsageDetails(usage);

    const baseRows = details.map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${sourceRaw || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const serviceTier = detail.service_tier ?? null;
      const requestServiceTier = detail.request_service_tier ?? null;
      const responseServiceTier = detail.response_service_tier ?? null;
      const effectiveServiceTier = detail.effective_service_tier ?? null;
      const resolvedServiceTier = resolveServiceTier({
        serviceTier,
        requestServiceTier,
        responseServiceTier,
        effectiveServiceTier,
      });
      const serviceTierFilterValue =
        resolvedServiceTier.tier === 'fast' ? SERVICE_TIER_FAST_FILTER : SERVICE_TIER_STD_FILTER;
      const serviceTierLabel =
        resolvedServiceTier.tier === 'fast'
          ? t('usage_stats.request_events_tier_fast')
          : t('usage_stats.request_events_tier_standard');
      const serviceTierTitle = t(
        `usage_stats.request_events_tier_tooltip_${resolvedServiceTier.evidence}`,
        { tier: serviceTierLabel }
      );
      const reasoningEffort = normalizeReasoningEffort(detail.reasoning_effort);
      const reasoningEffortFilterValue = getReasoningEffortFilterValue(reasoningEffort);
      const reasoningEffortLabel =
        reasoningEffort ?? t('usage_stats.request_events_effort_legacy_unknown');
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const uncachedInputTokens = getUsageUncachedInputTokenCount(detail.tokens);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(detail.tokens);
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );
      const latencyMs = extractLatencyMs(detail);

      return {
        id: `${timestamp}-${model}-${sourceKey}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        model,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        serviceTier,
        requestServiceTier,
        responseServiceTier,
        effectiveServiceTier,
        resolvedServiceTier,
        serviceTierFilterValue,
        serviceTierLabel,
        serviceTierTitle,
        reasoningEffort,
        reasoningEffortFilterValue,
        reasoningEffortLabel,
        failed: detail.failed === true,
        latencyMs,
        inputTokens,
        uncachedInputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    baseRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const buildDisambiguatedSourceLabel = (row: RequestEventRow) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row.source;
      }

      if (row.authIndex !== '-') {
        return `${row.source} · ${row.authIndex}`;
      }

      if (row.sourceRaw !== '-' && row.sourceRaw !== row.source) {
        return `${row.source} · ${row.sourceRaw}`;
      }

      if (row.sourceType) {
        return `${row.source} · ${row.sourceType}`;
      }

      return `${row.source} · ${row.sourceKey}`;
    };

    return baseRows
      .map((row) => ({
        ...row,
        source: buildDisambiguatedSourceLabel(row),
      }))
      .sort((a, b) => b.timestampMs - a.timestampMs);
  }, [authFileMap, i18n.language, sourceInfoMap, t, usage]);

  const hasLatencyData = useMemo(() => rows.some((row) => row.latencyMs !== null), [rows]);

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.model))).map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [rows, t]
  );

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    rows.forEach((row) => {
      if (!optionMap.has(row.sourceKey)) {
        optionMap.set(row.sourceKey, row.source);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [rows, t]);

  const authIndexOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.authIndex))).map((authIndex) => ({
        value: authIndex,
        label: authIndex,
      })),
    ],
    [rows, t]
  );

  const serviceTierOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      { value: SERVICE_TIER_FAST_FILTER, label: t('usage_stats.request_events_tier_fast') },
      { value: SERVICE_TIER_STD_FILTER, label: t('usage_stats.request_events_tier_standard') },
    ],
    [t]
  );

  const reasoningEffortOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    rows.forEach((row) => {
      if (!optionMap.has(row.reasoningEffortFilterValue)) {
        optionMap.set(row.reasoningEffortFilterValue, row.reasoningEffortLabel);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries())
        .sort(([, left], [, right]) => left.localeCompare(right, i18n.language))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [i18n.language, rows, t]);

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
  );
  const sourceOptionSet = useMemo(
    () => new Set(sourceOptions.map((option) => option.value)),
    [sourceOptions]
  );
  const authIndexOptionSet = useMemo(
    () => new Set(authIndexOptions.map((option) => option.value)),
    [authIndexOptions]
  );
  const serviceTierOptionSet = useMemo(
    () => new Set(serviceTierOptions.map((option) => option.value)),
    [serviceTierOptions]
  );
  const reasoningEffortOptionSet = useMemo(
    () => new Set(reasoningEffortOptions.map((option) => option.value)),
    [reasoningEffortOptions]
  );

  const effectiveModelFilter = modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER;
  const effectiveSourceFilter = sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER;
  const effectiveAuthIndexFilter = authIndexOptionSet.has(authIndexFilter)
    ? authIndexFilter
    : ALL_FILTER;
  const effectiveServiceTierFilter = serviceTierOptionSet.has(serviceTierFilter)
    ? serviceTierFilter
    : ALL_FILTER;
  const effectiveReasoningEffortFilter = reasoningEffortOptionSet.has(reasoningEffortFilter)
    ? reasoningEffortFilter
    : ALL_FILTER;

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER || row.model === effectiveModelFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.sourceKey === effectiveSourceFilter;
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_FILTER || row.authIndex === effectiveAuthIndexFilter;
        const serviceTierMatched =
          effectiveServiceTierFilter === ALL_FILTER ||
          row.serviceTierFilterValue === effectiveServiceTierFilter;
        const reasoningEffortMatched =
          effectiveReasoningEffortFilter === ALL_FILTER ||
          row.reasoningEffortFilterValue === effectiveReasoningEffortFilter;
        return (
          modelMatched &&
          sourceMatched &&
          authIndexMatched &&
          serviceTierMatched &&
          reasoningEffortMatched
        );
      }),
    [
      effectiveAuthIndexFilter,
      effectiveModelFilter,
      effectiveReasoningEffortFilter,
      effectiveServiceTierFilter,
      effectiveSourceFilter,
      rows,
    ]
  );

  const renderedRows = useMemo(() => filteredRows.slice(0, MAX_RENDERED_EVENTS), [filteredRows]);

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveAuthIndexFilter !== ALL_FILTER ||
    effectiveServiceTierFilter !== ALL_FILTER ||
    effectiveReasoningEffortFilter !== ALL_FILTER;

  const handleClearFilters = () => {
    setModelFilter(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setAuthIndexFilter(ALL_FILTER);
    setServiceTierFilter(ALL_FILTER);
    setReasoningEffortFilter(ALL_FILTER);
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'model',
      'source',
      'source_raw',
      'auth_index',
      'service_tier',
      'request_service_tier',
      'response_service_tier',
      'effective_service_tier',
      'resolved_service_tier',
      'service_tier_evidence',
      'reasoning_effort',
      'result',
      ...(hasLatencyData ? ['latency_ms'] : []),
      'input_tokens',
      'uncached_input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'cache_read_tokens',
      'cache_creation_tokens',
      'total_tokens',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.source,
        row.sourceRaw,
        row.authIndex,
        row.serviceTier ?? '',
        row.requestServiceTier ?? '',
        row.responseServiceTier ?? '',
        row.effectiveServiceTier ?? '',
        row.resolvedServiceTier.tier,
        row.resolvedServiceTier.evidence,
        row.reasoningEffort ?? '',
        row.failed ? 'failed' : 'success',
        ...(hasLatencyData ? [row.latencyMs ?? ''] : []),
        row.inputTokens,
        row.uncachedInputTokens ?? '',
        row.outputTokens,
        row.reasoningTokens,
        row.cacheReadTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
        row.totalTokens,
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      source: row.source,
      source_raw: row.sourceRaw,
      auth_index: row.authIndex,
      service_tier: row.serviceTier,
      request_service_tier: row.requestServiceTier,
      response_service_tier: row.responseServiceTier,
      effective_service_tier: row.effectiveServiceTier,
      resolved_service_tier: row.resolvedServiceTier.tier,
      service_tier_evidence: row.resolvedServiceTier.evidence,
      reasoning_effort: row.reasoningEffort,
      failed: row.failed,
      ...(hasLatencyData && row.latencyMs !== null ? { latency_ms: row.latencyMs } : {}),
      tokens: {
        input_tokens: row.inputTokens,
        ...(row.uncachedInputTokens !== null
          ? { uncached_input_tokens: row.uncachedInputTokens }
          : {}),
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cacheReadTokens,
        cache_read_tokens: row.cacheReadTokens,
        cache_creation_tokens: row.cacheWriteTokens,
        total_tokens: row.totalTokens,
      },
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
    });
  };

  return (
    <Card
      title={t('usage_stats.request_events_title')}
      extra={
        <div className={styles.requestEventsActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
          >
            {t('usage_stats.clear_filters')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
          >
            {t('usage_stats.export_csv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportJson}
            disabled={filteredRows.length === 0}
          >
            {t('usage_stats.export_json')}
          </Button>
        </div>
      }
    >
      <div className={styles.requestEventsToolbar}>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_model')}
          </span>
          <Select
            value={effectiveModelFilter}
            options={modelOptions}
            onChange={setModelFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_model')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_source')}
          </span>
          <Select
            value={effectiveSourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_source')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_auth_index')}
          </span>
          <Select
            value={effectiveAuthIndexFilter}
            options={authIndexOptions}
            onChange={setAuthIndexFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_auth_index')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_tier')}
          </span>
          <Select
            value={effectiveServiceTierFilter}
            options={serviceTierOptions}
            onChange={setServiceTierFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_tier')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_effort')}
          </span>
          <Select
            value={effectiveReasoningEffortFilter}
            options={reasoningEffortOptions}
            onChange={setReasoningEffortFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_effort')}
            fullWidth={false}
          />
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          <div className={styles.requestEventsMeta}>
            <span>{t('usage_stats.request_events_count', { count: filteredRows.length })}</span>
            {hasLatencyData && <span className={styles.requestEventsLimitHint}>{latencyHint}</span>}
            {filteredRows.length > MAX_RENDERED_EVENTS && (
              <span className={styles.requestEventsLimitHint}>
                {t('usage_stats.request_events_limit_hint', {
                  shown: MAX_RENDERED_EVENTS,
                  total: filteredRows.length,
                })}
              </span>
            )}
          </div>

          <div className={styles.requestEventsTableWrapper}>
            <table className={`${styles.table} ${styles.requestEventsTable}`}>
              <thead>
                <tr>
                  <th>{t('usage_stats.request_events_timestamp')}</th>
                  <th>{t('usage_stats.model_name')}</th>
                  <th>{t('usage_stats.request_events_source')}</th>
                  <th>{t('usage_stats.request_events_auth_index')}</th>
                  <th>{t('usage_stats.request_events_tier')}</th>
                  <th>{t('usage_stats.request_events_result')}</th>
                  {hasLatencyData && <th title={latencyHint}>{t('usage_stats.time')}</th>}
                  <th>{t('usage_stats.request_events_effort')}</th>
                  <th>{t('usage_stats.input_tokens')}</th>
                  <th>{t('usage_stats.output_tokens')}</th>
                  <th>{t('usage_stats.reasoning_tokens')}</th>
                  <th>{t('usage_stats.cache_read_tokens')}</th>
                  <th>{t('usage_stats.cache_write_tokens')}</th>
                  <th>{t('usage_stats.total_tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => (
                  <tr key={row.id}>
                    <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                      {row.timestampLabel}
                    </td>
                    <td className={styles.modelCell}>{row.model}</td>
                    <td className={styles.requestEventsSourceCell} title={row.source}>
                      <span>{row.source}</span>
                      {row.sourceType && (
                        <span className={styles.credentialType}>{row.sourceType}</span>
                      )}
                    </td>
                    <td className={styles.requestEventsAuthIndex} title={row.authIndex}>
                      {row.authIndex}
                    </td>
                    <td>
                      <span
                        className={`${styles.requestEventsTierBadge} ${
                          row.resolvedServiceTier.tier === 'fast'
                            ? styles.requestEventsTierFast
                            : styles.requestEventsTierStd
                        }`}
                        title={row.serviceTierTitle}
                        aria-label={row.serviceTierTitle}
                      >
                        {row.serviceTierLabel}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          row.failed
                            ? styles.requestEventsResultFailed
                            : styles.requestEventsResultSuccess
                        }
                      >
                        {row.failed ? t('stats.failure') : t('stats.success')}
                      </span>
                    </td>
                    {hasLatencyData && (
                      <td className={styles.durationCell}>{formatDurationMs(row.latencyMs)}</td>
                    )}
                    <td>
                      <span
                        className={
                          row.reasoningEffort === null
                            ? styles.requestEventsEffortEmpty
                            : styles.requestEventsEffortBadge
                        }
                        title={row.reasoningEffort ?? undefined}
                      >
                        {row.reasoningEffortLabel}
                      </span>
                    </td>
                    <td>{row.inputTokens.toLocaleString()}</td>
                    <td>{row.outputTokens.toLocaleString()}</td>
                    <td>{row.reasoningTokens.toLocaleString()}</td>
                    <td>{row.cacheReadTokens.toLocaleString()}</td>
                    <td>{row.cacheWriteTokens.toLocaleString()}</td>
                    <td>{row.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
