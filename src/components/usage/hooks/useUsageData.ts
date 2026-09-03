import { createElement, useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore } from '@/stores';
import { usageApi } from '@/services/api/usage';
import {
  getUsageImportErrorCode,
  getUsageImportErrorTranslationKey,
  isMigratedV1UsageImportReceipt,
  isMigratedV2UsageImportReceipt,
} from '@/services/api/usageImportContract';
import { downloadBlob } from '@/utils/download';
import {
  createDefaultPriceProfileV3,
  loadPriceProfileV3,
  normalizePriceProfileV3,
  savePriceProfileV3,
  type PriceProfileLoadSource,
  type PriceProfileV3,
} from '@/utils/usage';
import { analyzeUsageImport } from '@/utils/usage/importPreflight';

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  priceProfile: PriceProfileV3;
  priceProfileSource: PriceProfileLoadSource;
  priceProfileWarnings: string[];
  setPriceProfile: (profile: PriceProfileV3) => boolean;
  loadUsage: () => Promise<void>;
  handleExport: () => Promise<void>;
  handleImport: () => void;
  handleImportChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importing: boolean;
}

export function useUsageData(): UseUsageDataReturn {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const usageSnapshot = useUsageStatsStore((state) => state.usage);
  const loading = useUsageStatsStore((state) => state.loading);
  const storeError = useUsageStatsStore((state) => state.error);
  const lastRefreshedAtTs = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [priceProfile, setPriceProfileState] = useState<PriceProfileV3>(
    createDefaultPriceProfileV3
  );
  const [priceProfileSource, setPriceProfileSource] = useState<PriceProfileLoadSource>('default');
  const [priceProfileWarnings, setPriceProfileWarnings] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadUsage = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  useEffect(() => {
    void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
    const loaded = loadPriceProfileV3();
    setPriceProfileState(loaded.profile);
    setPriceProfileSource(loaded.source);
    setPriceProfileWarnings(loaded.warnings);
  }, [loadUsageStats]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await usageApi.exportUsage();
      const exportedAt =
        typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date();
      const safeTimestamp = Number.isNaN(exportedAt.getTime())
        ? new Date().toISOString()
        : exportedAt.toISOString();
      const filename = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`;
      downloadBlob({
        filename,
        blob: new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' }),
      });
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleImport = () => {
    importInputRef.current?.click();
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    let payload: unknown = null;
    try {
      const text = await file.text();
      try {
        payload = JSON.parse(text);
      } catch {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(
        `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    } finally {
      setImporting(false);
    }

    const preflight = analyzeUsageImport(payload, usageSnapshot);
    if (!preflight.valid) {
      const issue = preflight.issues[0];
      showNotification(
        issue ? t(getUsageImportErrorTranslationKey(issue)) : t('usage_stats.import_invalid'),
        'error'
      );
      return;
    }

    const summaryItems = [
      t('usage_stats.import_review_summary', {
        version: preflight.version ?? '-',
        details: preflight.detailCount,
      }),
      t('usage_stats.import_review_duplicates', { count: preflight.duplicateCount }),
      t('usage_stats.import_review_overlaps', { count: preflight.overlapCount }),
      t('usage_stats.import_review_uncertain_identities', {
        count: preflight.uncertainIdentityCount,
      }),
    ];

    showConfirmation({
      title: t('usage_stats.import_review_title'),
      message: createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        createElement('p', { style: { margin: 0 } }, t('usage_stats.import_review_intro')),
        createElement(
          'ul',
          { style: { margin: 0, paddingLeft: '1.25rem' } },
          summaryItems.map((item, index) => createElement('li', { key: index }, item))
        ),
        !preflight.currentUsageAvailable
          ? createElement(
              'p',
              { style: { margin: 0 } },
              t('usage_stats.import_review_current_unavailable')
            )
          : null
      ),
      confirmText: t('usage_stats.import_review_confirm'),
      variant: 'primary',
      onConfirm: async () => {
        setImporting(true);
        try {
          const result = await usageApi.importUsage(payload);
          showNotification(
            t(
              isMigratedV1UsageImportReceipt(result)
                ? 'usage_stats.import_success_migrated_v1'
                : isMigratedV2UsageImportReceipt(result)
                  ? 'usage_stats.import_success_migrated_v2'
                  : 'usage_stats.import_success',
              {
                added: result.added,
                skipped: result.skipped,
                total: result.total_requests,
                failed: result.failed_requests,
                schemaVersion: result.schema_version,
              }
            ),
            'success'
          );
          try {
            await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '';
            showNotification(
              `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
              'error'
            );
          }
        } catch (err: unknown) {
          const code = getUsageImportErrorCode(err);
          if (code) {
            showNotification(t(getUsageImportErrorTranslationKey(code)), 'error');
          } else {
            const message = err instanceof Error ? err.message : '';
            showNotification(
              `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
              'error'
            );
          }
        } finally {
          setImporting(false);
        }
      },
    });
  };

  const handleSetPriceProfile = useCallback(
    (profile: PriceProfileV3) => {
      const normalized = normalizePriceProfileV3(profile);
      if (!savePriceProfileV3(normalized.profile)) {
        showNotification(t('usage_stats.pricing_profile_save_failed'), 'error');
        return false;
      }
      setPriceProfileState(normalized.profile);
      setPriceProfileSource('v3');
      setPriceProfileWarnings(normalized.warnings);
      return true;
    },
    [showNotification, t]
  );

  const usage = usageSnapshot as UsagePayload | null;
  const error = storeError || '';
  const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null;

  return {
    usage,
    loading,
    error,
    lastRefreshedAt,
    priceProfile,
    priceProfileSource,
    priceProfileWarnings,
    setPriceProfile: handleSetPriceProfile,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  };
}
