import { createElement, useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore } from '@/stores';
import { usageApi } from '@/services/api/usage';
import { downloadBlob } from '@/utils/download';
import { loadModelPrices, saveModelPrices, type ModelPrice } from '@/utils/usage';
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
  modelPrices: Record<string, ModelPrice>;
  setModelPrices: (prices: Record<string, ModelPrice>) => void;
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

  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadUsage = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  useEffect(() => {
    void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {});
    setModelPrices(loadModelPrices());
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
      showNotification(t('usage_stats.import_invalid'), 'error');
      return;
    }

    const summaryItems = [
      t('usage_stats.import_review_summary', {
        version: preflight.version ?? '-',
        details: preflight.detailCount,
      }),
      t('usage_stats.import_review_cache_summary', {
        legacy: preflight.legacyCacheAliasCount,
        canonical: preflight.canonicalCacheWriteCount,
      }),
      t('usage_stats.import_review_duplicates', { count: preflight.duplicateCount }),
      t('usage_stats.import_review_overlaps', { count: preflight.overlapCount }),
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
          : null,
        createElement(
          'p',
          {
            style: {
              margin: 0,
              padding: '0.75rem',
              borderRadius: '0.5rem',
              background: 'var(--warning-bg, rgba(245, 158, 11, 0.12))',
              color: 'var(--warning-text, var(--warning-color, #92400e))',
              border: '1px solid var(--warning-border, rgba(245, 158, 11, 0.28))',
            },
          },
          t('usage_stats.import_review_warning')
        )
      ),
      confirmText: t('usage_stats.import_review_confirm'),
      variant: 'primary',
      onConfirm: async () => {
        setImporting(true);
        try {
          const result = await usageApi.importUsage(payload);
          showNotification(
            t('usage_stats.import_success', {
              added: result?.added ?? 0,
              skipped: result?.skipped ?? 0,
              total: result?.total_requests ?? 0,
              failed: result?.failed_requests ?? 0,
            }),
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
          const message = err instanceof Error ? err.message : '';
          showNotification(
            `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
            'error'
          );
        } finally {
          setImporting(false);
        }
      },
    });
  };

  const handleSetModelPrices = useCallback((prices: Record<string, ModelPrice>) => {
    setModelPrices(prices);
    saveModelPrices(prices);
  }, []);

  const usage = usageSnapshot as UsagePayload | null;
  const error = storeError || '';
  const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null;

  return {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices: handleSetModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  };
}
