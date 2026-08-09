/**
 * Quota management page - coordinates the six LTS quota sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useCountUp, useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from '@/components/quota';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import type { QuotaProviderType } from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

type QuotaTabId = 'all' | QuotaProviderType;

const QUOTA_PROVIDERS = [
  { id: 'claude', config: CLAUDE_CONFIG },
  { id: 'antigravity', config: ANTIGRAVITY_CONFIG },
  { id: 'codex', config: CODEX_CONFIG },
  { id: 'xai', config: XAI_CONFIG },
  { id: 'gemini-cli', config: GEMINI_CLI_CONFIG },
  { id: 'kimi', config: KIMI_CONFIG },
] as const;

const QUOTA_TAB_IDS: string[] = ['all', ...QUOTA_PROVIDERS.map(({ id }) => id)];

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeProvider, setActiveProvider] = useState<QuotaTabId>('all');

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected';

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    QUOTA_PROVIDERS.forEach(({ id, config }) => {
      const count = files.filter((file) => config.filterFn(file)).length;
      counts[id] = count;
      counts.all += count;
    });
    return counts;
  }, [files]);

  const quotaByProvider = useMemo(
    () => ({
      antigravity: antigravityQuota,
      claude: claudeQuota,
      codex: codexQuota,
      'gemini-cli': geminiCliQuota,
      kimi: kimiQuota,
      xai: xaiQuota,
    }),
    [antigravityQuota, claudeQuota, codexQuota, geminiCliQuota, kimiQuota, xaiQuota]
  );

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;

    QUOTA_PROVIDERS.forEach(({ id, config }) => {
      files.filter((file) => config.filterFn(file)).forEach((file) => {
        const status = quotaByProvider[id][file.name]?.status;
        if (status === 'success') loaded += 1;
        if (status === 'error') attention += 1;
      });
    });

    return { loadedCount: loaded, attentionCount: attention };
  }, [files, quotaByProvider]);

  const displayLoadedCount = useCountUp(loadedCount);
  const showProvider = (provider: QuotaProviderType) =>
    activeProvider === 'all' || activeProvider === provider;

  return (
    <div className={styles.container} ref={revealRef}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle} data-reveal>
          {t('quota_management.title')}
        </h1>
        <p className={styles.description} data-reveal>
          {t('quota_management.description')}
        </p>
        <p className={styles.pageMeta} data-reveal>
          <span className={styles.metaTotal}>
            {t('quota_management.meta_credentials', { count: providerCounts.all })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={loadedCount > 0 ? styles.metaLoaded : styles.metaMuted}>
            {t('quota_management.meta_loaded', { count: displayLoadedCount })}
          </span>
          {attentionCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>
                {t('quota_management.meta_attention', { count: attentionCount })}
              </span>
            </>
          )}
        </p>
      </header>

      <div className={styles.providerTabs} data-reveal>
        <ProviderTabs
          types={QUOTA_TAB_IDS}
          counts={providerCounts}
          active={activeProvider}
          resolvedTheme={resolvedTheme}
          onChange={(provider) => setActiveProvider(provider as QuotaTabId)}
        />
      </div>

      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      <div hidden={!showProvider('claude')}>
        <QuotaSection
          config={CLAUDE_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      </div>
      <div hidden={!showProvider('antigravity')}>
        <QuotaSection
          config={ANTIGRAVITY_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      </div>
      <div hidden={!showProvider('codex')}>
        <QuotaSection
          config={CODEX_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      </div>
      <div hidden={!showProvider('xai')}>
        <QuotaSection
          config={XAI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      </div>
      <div hidden={!showProvider('gemini-cli')}>
        <QuotaSection
          config={GEMINI_CLI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      </div>
      <div hidden={!showProvider('kimi')}>
        <QuotaSection
          config={KIMI_CONFIG}
          files={files}
          loading={loading}
          disabled={disableControls}
        />
      </div>
    </div>
  );
}
