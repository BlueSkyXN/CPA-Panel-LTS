import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { authFilesApi } from '@/services/api/authFiles';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import {
  collectUsageDetails,
  extractLatencyMs,
  extractTotalTokens,
  formatCompactNumber,
  formatDurationMs,
  normalizeAuthIndex,
  normalizeUsageSourceId,
} from '@/utils/usage';
import { getUsageCacheTokenCounts } from '@/utils/usage/cacheTokens';
import { isUsageQueryView } from '@/utils/usage/queryView';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

interface CredentialRow {
  key: string;
  displayName: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
  tokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  latencyTotalMs: number;
  latencySamples: number;
}

interface CredentialEntry {
  source: string;
  auth_index: string | number | null;
  success: number;
  failure: number;
  tokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  latencyTotalMs: number;
  latencySamples: number;
}

const collectCredentialEntries = (usage: UsagePayload | null): CredentialEntry[] => {
  if (!usage) return [];
  if (isUsageQueryView(usage)) {
    return (usage.summary.groups.credentials ?? []).map((g) => {
      const latencySamples = Math.max(g.metrics.latency_samples ?? 0, 0);
      return {
        source: normalizeUsageSourceId(g.source ?? ''),
        auth_index: g.auth_index ?? '',
        success: g.metrics.success,
        failure: g.metrics.failure,
        tokens: g.metrics.tokens,
        inputTokens: g.metrics.input,
        cacheReadTokens: g.metrics.cache_read,
        latencyTotalMs: latencySamples > 0 ? g.metrics.latency_ms : 0,
        latencySamples,
      };
    });
  }
  return collectUsageDetails(usage).map((d) => {
    const { cacheReadTokens } = getUsageCacheTokenCounts(d.tokens);
    const inputTokens =
      typeof d.tokens.input_tokens === 'number' ? Math.max(d.tokens.input_tokens, 0) : 0;
    const latencyMs = extractLatencyMs(d);
    return {
      source: d.source,
      auth_index: d.auth_index,
      success: d.failed ? 0 : 1,
      failure: d.failed ? 1 : 0,
      tokens: extractTotalTokens(d, d.__modelName),
      inputTokens,
      cacheReadTokens,
      latencyTotalMs: latencyMs ?? 0,
      latencySamples: latencyMs === null ? 0 : 1,
    };
  });
};

export function CredentialStatsCard({
  usage,
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: CredentialStatsCardProps) {
  const { t, i18n } = useTranslation();
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

  const cacheRateFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: 'percent',
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );
  const cacheRateHint = t('usage_stats.model_cache_rate_hint');

  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];

    const rowMap = new Map<string, CredentialRow>();

    collectCredentialEntries(usage).forEach((entry) => {
      const sourceInfo = resolveSourceDisplay(
        entry.source ?? '',
        entry.auth_index,
        sourceInfoMap,
        authFileMap
      );
      const key = sourceInfo.identityKey ?? sourceInfo.displayName;
      const row =
        rowMap.get(key) ??
        ({
          key,
          displayName: sourceInfo.displayName,
          type: sourceInfo.type,
          success: 0,
          failure: 0,
          total: 0,
          successRate: 100,
          tokens: 0,
          inputTokens: 0,
          cacheReadTokens: 0,
          latencyTotalMs: 0,
          latencySamples: 0,
        } satisfies CredentialRow);

      row.failure += entry.failure;
      row.success += entry.success;
      row.total = row.success + row.failure;
      row.successRate = row.total > 0 ? (row.success / row.total) * 100 : 100;
      row.tokens += entry.tokens;
      row.inputTokens += entry.inputTokens;
      row.cacheReadTokens += entry.cacheReadTokens;
      row.latencyTotalMs += entry.latencyTotalMs;
      row.latencySamples += entry.latencySamples;
      rowMap.set(key, row);
    });

    return Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
  }, [authFileMap, sourceInfoMap, usage]);

  return (
    <Card title={t('usage_stats.credential_stats')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        <div className={styles.detailsScroll}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.credential_name')}</th>
                  <th>{t('usage_stats.requests_count')}</th>
                  <th>{t('usage_stats.total_tokens')}</th>
                  <th title={cacheRateHint}>{t('usage_stats.model_cache_rate')}</th>
                  <th>{t('usage_stats.avg_time')}</th>
                  <th>{t('usage_stats.success_rate')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td className={styles.modelCell}>
                      <span>{row.displayName}</span>
                      {row.type && <span className={styles.credentialType}>{row.type}</span>}
                    </td>
                    <td>
                      <span className={styles.requestCountCell}>
                        <span>{formatCompactNumber(row.total)}</span>
                        <span className={styles.requestBreakdown}>
                          (
                          <span className={styles.statSuccess}>
                            {row.success.toLocaleString()}
                          </span>{' '}
                          <span className={styles.statFailure}>
                            {row.failure.toLocaleString()}
                          </span>
                          )
                        </span>
                      </span>
                    </td>
                    <td>{formatCompactNumber(row.tokens)}</td>
                    <td title={cacheRateHint}>
                      {row.inputTokens > 0
                        ? cacheRateFormatter.format(row.cacheReadTokens / row.inputTokens)
                        : '--'}
                    </td>
                    <td>
                      {formatDurationMs(
                        row.latencySamples > 0 ? row.latencyTotalMs / row.latencySamples : null
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          row.successRate >= 95
                            ? styles.statSuccess
                            : row.successRate >= 80
                              ? styles.statNeutral
                              : styles.statFailure
                        }
                      >
                        {row.successRate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
