import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconBot,
  IconChartLine,
  IconFileText,
  IconInfo,
  IconKey,
  IconModelCluster,
  IconPlug,
  IconScrollText,
  IconSettings,
  IconShield,
} from '@/components/ui/icons';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi, pluginsApi } from '@/services/api';
import {
  USAGE_STATS_STALE_TIME_MS,
  useAuthStore,
  useConfigStore,
  useModelsStore,
  useUsageStatsStore,
} from '@/stores';
import type { AuthFileItem, Config, PluginListEntry } from '@/types';
import { formatCompactNumber, formatDateValue, formatPercent } from '@/utils/format';
import { getApiStats, getModelStats } from '@/utils/usage';
import styles from './CoreWorkspace.module.scss';

const DASH = '—';

type WorkspaceCardTone = 'neutral' | 'success' | 'warning' | 'danger';

type WorkspaceLink = {
  path: string;
  title: string;
  description: string;
  icon: ReactNode;
  value?: string;
  meta?: string;
  tone?: WorkspaceCardTone;
};

type ProviderScopeAction = {
  path: string;
  label: string;
};

type ProviderScope = {
  id: string;
  title: string;
  description: string;
  glyph: string;
  credentialCount: number | null;
  keyCount?: number | null;
  actions: ProviderScopeAction[];
};

const countAmpcodeConfig = (config: Config): number => {
  const ampcode = config.ampcode;
  if (!ampcode) return 0;
  return ampcode.upstreamUrl?.trim() ||
    ampcode.upstreamApiKey?.trim() ||
    (ampcode.upstreamApiKeys?.length ?? 0) > 0 ||
    (ampcode.modelMappings?.length ?? 0) > 0 ||
    ampcode.forceModelMappings === true
    ? 1
    : 0;
};

const countProviderKeys = (config: Config | null): number | null => {
  if (!config) return null;
  return (
    (config.geminiApiKeys?.length ?? 0) +
    (config.codexApiKeys?.length ?? 0) +
    countAmpcodeConfig(config) +
    (config.xaiApiKeys?.length ?? 0) +
    (config.claudeApiKeys?.length ?? 0) +
    (config.vertexApiKeys?.length ?? 0) +
    (config.openaiCompatibility?.length ?? 0)
  );
};

const countCredentialHealth = (files: AuthFileItem[] | null) => {
  if (!files) return null;
  const disabled = files.filter((file) => file.disabled).length;
  const unavailable = files.filter((file) => !file.disabled && file.unavailable).length;
  return {
    total: files.length,
    active: Math.max(files.length - disabled - unavailable, 0),
    disabled,
    unavailable,
  };
};

const formatCount = (value: number | null): string =>
  value === null ? DASH : value < 100_000 ? value.toLocaleString() : formatCompactNumber(value);

const countProviderCredentials = (
  files: AuthFileItem[] | null,
  providers: string[]
): number | null => {
  if (!files) return null;
  const accepted = new Set(providers.map((provider) => provider.toLowerCase()));
  return files.filter((file) => {
    const provider = String(file.type ?? file.provider ?? '')
      .trim()
      .toLowerCase();
    return accepted.has(provider);
  }).length;
};

export function CoreWorkspace() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const serverRuntimeKind = useAuthStore((state) => state.serverRuntimeKind);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const pluginSupportKnown = useAuthStore((state) => state.pluginSupportKnown);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const usage = useUsageStatsStore((state) => state.usage);
  const usageLoading = useUsageStatsStore((state) => state.loading);
  const usageError = useUsageStatsStore((state) => state.error);
  const usageLastRefreshedAt = useUsageStatsStore((state) => state.lastRefreshedAt);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const resolveApiKeysForModels = useApiKeysForModels();

  const [authFiles, setAuthFiles] = useState<AuthFileItem[] | null>(null);
  const [authFilesLoading, setAuthFilesLoading] = useState(false);
  const [plugins, setPlugins] = useState<PluginListEntry[] | null>(null);

  const connected = connectionStatus === 'connected';

  const loadAuthFiles = useCallback(async () => {
    if (!connected) {
      setAuthFiles(null);
      return;
    }
    setAuthFilesLoading(true);
    try {
      const response = await authFilesApi.list();
      setAuthFiles(response.files);
    } catch {
      setAuthFiles(null);
    } finally {
      setAuthFilesLoading(false);
    }
  }, [connected]);

  const loadModels = useCallback(
    async (forceRefresh = false) => {
      if (!connected || !apiBase) return;
      try {
        const apiKeys = await resolveApiKeysForModels({ force: forceRefresh });
        await fetchModels(apiBase, apiKeys[0], forceRefresh);
      } catch {
        return;
      }
    },
    [apiBase, connected, fetchModels, resolveApiKeysForModels]
  );

  const loadPlugins = useCallback(async () => {
    if (!connected || !supportsPlugin) {
      setPlugins(null);
      return;
    }
    try {
      const response = await pluginsApi.list();
      setPlugins(response.plugins);
    } catch {
      setPlugins(null);
    }
  }, [connected, supportsPlugin]);

  const refresh = useCallback(async () => {
    if (!connected) return;
    await Promise.allSettled([
      fetchConfig(undefined, true),
      loadAuthFiles(),
      loadModels(true),
      loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS }),
      loadPlugins(),
    ]);
  }, [connected, fetchConfig, loadAuthFiles, loadModels, loadPlugins, loadUsageStats]);

  useHeaderRefresh(refresh, connected);

  useEffect(() => {
    if (!connected) return;
    void Promise.allSettled([
      fetchConfig(),
      loadAuthFiles(),
      loadModels(),
      loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }),
      loadPlugins(),
    ]);
  }, [connected, fetchConfig, loadAuthFiles, loadModels, loadPlugins, loadUsageStats]);

  const credentialHealth = useMemo(() => countCredentialHealth(authFiles), [authFiles]);
  const providerKeyCount = useMemo(() => countProviderKeys(config), [config]);
  const apiStats = useMemo(() => getApiStats(usage), [usage]);
  const modelStats = useMemo(() => getModelStats(usage), [usage]);
  const requestCount = useMemo(
    () => apiStats.reduce((total, item) => total + item.totalRequests, 0),
    [apiStats]
  );
  const tokenCount = useMemo(
    () => apiStats.reduce((total, item) => total + item.totalTokens, 0),
    [apiStats]
  );
  const successCount = useMemo(
    () => apiStats.reduce((total, item) => total + item.successCount, 0),
    [apiStats]
  );
  const successRate = requestCount > 0 ? (successCount / requestCount) * 100 : null;
  const effectivePlugins = plugins?.filter((plugin) => plugin.effectiveEnabled).length ?? null;
  const configuredPlugins = plugins?.filter((plugin) => plugin.configured).length ?? null;
  const runtimeLabel = t(`core_workspace.runtime_${serverRuntimeKind}`);
  const versionLabel = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : DASH;
  const buildLabel = formatDateValue(serverBuildDate, i18n.language) || DASH;
  const providerScopes: ProviderScope[] = [
    {
      id: 'claude',
      title: t('core_workspace.provider_claude_code'),
      description: t('core_workspace.provider_claude_code_desc'),
      glyph: 'CC',
      credentialCount: countProviderCredentials(authFiles, ['claude', 'anthropic']),
      keyCount: config?.claudeApiKeys?.length ?? null,
      actions: [
        { path: '/oauth?provider=anthropic', label: t('core_workspace.action_oauth') },
        { path: '/auth-files?provider=claude', label: t('core_workspace.action_credentials') },
        { path: '/ai-providers?provider=claudeApi', label: t('core_workspace.action_api_keys') },
        { path: '/quota?provider=claude', label: t('core_workspace.action_quota') },
        {
          path: '/config?section=system&subsection=headers',
          label: t('core_workspace.action_behavior'),
        },
      ],
    },
    {
      id: 'codex',
      title: t('core_workspace.provider_codex'),
      description: t('core_workspace.provider_codex_desc'),
      glyph: 'CX',
      credentialCount: countProviderCredentials(authFiles, ['codex']),
      keyCount: config?.codexApiKeys?.length ?? null,
      actions: [
        { path: '/oauth?provider=codex', label: t('core_workspace.action_oauth') },
        { path: '/auth-files?provider=codex', label: t('core_workspace.action_credentials') },
        { path: '/ai-providers?provider=codex', label: t('core_workspace.action_api_keys') },
        { path: '/quota?provider=codex', label: t('core_workspace.action_quota') },
        {
          path: '/config?section=system&subsection=headers',
          label: t('core_workspace.action_behavior'),
        },
      ],
    },
    {
      id: 'gemini',
      title: t('core_workspace.provider_gemini_cli'),
      description: t('core_workspace.provider_gemini_cli_desc'),
      glyph: 'GM',
      credentialCount: countProviderCredentials(authFiles, ['gemini', 'gemini-cli']),
      keyCount: config?.geminiApiKeys?.length ?? null,
      actions: [
        { path: '/oauth?provider=gemini-cli', label: t('core_workspace.action_oauth') },
        { path: '/auth-files?provider=gemini-cli', label: t('core_workspace.action_credentials') },
        { path: '/ai-providers?provider=gemini', label: t('core_workspace.action_api_keys') },
        { path: '/quota?provider=gemini-cli', label: t('core_workspace.action_quota') },
      ],
    },
    {
      id: 'antigravity',
      title: t('core_workspace.provider_antigravity'),
      description: t('core_workspace.provider_antigravity_desc'),
      glyph: 'AG',
      credentialCount: countProviderCredentials(authFiles, ['antigravity']),
      actions: [
        { path: '/oauth?provider=antigravity', label: t('core_workspace.action_oauth') },
        { path: '/auth-files?provider=antigravity', label: t('core_workspace.action_credentials') },
        { path: '/quota?provider=antigravity', label: t('core_workspace.action_quota') },
        {
          path: '/config?section=system&subsection=runtime',
          label: t('core_workspace.action_behavior'),
        },
      ],
    },
    {
      id: 'kimi',
      title: t('core_workspace.provider_kimi'),
      description: t('core_workspace.provider_kimi_desc'),
      glyph: 'KM',
      credentialCount: countProviderCredentials(authFiles, ['kimi']),
      actions: [
        { path: '/oauth?provider=kimi', label: t('core_workspace.action_oauth') },
        { path: '/auth-files?provider=kimi', label: t('core_workspace.action_credentials') },
        { path: '/quota?provider=kimi', label: t('core_workspace.action_quota') },
      ],
    },
    {
      id: 'xai',
      title: t('core_workspace.provider_xai'),
      description: t('core_workspace.provider_xai_desc'),
      glyph: 'xAI',
      credentialCount: countProviderCredentials(authFiles, ['xai', 'grok']),
      keyCount: config?.xaiApiKeys?.length ?? null,
      actions: [
        { path: '/oauth?provider=xai', label: t('core_workspace.action_oauth') },
        { path: '/auth-files?provider=xai', label: t('core_workspace.action_credentials') },
        { path: '/ai-providers?provider=xai', label: t('core_workspace.action_api_keys') },
        { path: '/quota?provider=xai', label: t('core_workspace.action_quota') },
      ],
    },
    {
      id: 'iflow',
      title: t('core_workspace.provider_iflow'),
      description: t('core_workspace.provider_iflow_desc'),
      glyph: 'IF',
      credentialCount: countProviderCredentials(authFiles, ['iflow']),
      actions: [
        { path: '/auth-files?provider=iflow', label: t('core_workspace.action_credentials') },
      ],
    },
    {
      id: 'pools',
      title: t('core_workspace.provider_api_pools'),
      description: t('core_workspace.provider_api_pools_desc'),
      glyph: 'API',
      credentialCount: null,
      keyCount: providerKeyCount,
      actions: [
        { path: '/ai-providers', label: t('core_workspace.action_all_pools') },
        { path: '/ai-providers?provider=vertex', label: 'Vertex' },
        { path: '/ai-providers?provider=openaiCompatibility', label: 'OpenAI Compatible' },
        { path: '/ai-providers/legacy/ampcode', label: 'Ampcode' },
      ],
    },
  ];

  const gatewayLinks: WorkspaceLink[] = [
    {
      path: '/ai-providers',
      title: t('nav.ai_providers'),
      description: t('core_workspace.providers_desc'),
      icon: <IconBot size={22} />,
      value: formatCount(providerKeyCount),
      meta: t('core_workspace.provider_keys_meta'),
    },
    {
      path: '/auth-files',
      title: t('nav.auth_files'),
      description: t('core_workspace.auth_files_desc'),
      icon: <IconFileText size={22} />,
      value: formatCount(credentialHealth?.total ?? null),
      meta: credentialHealth
        ? t('core_workspace.credentials_meta', {
            active: credentialHealth.active,
            attention: credentialHealth.disabled + credentialHealth.unavailable,
          })
        : t('core_workspace.credentials_meta_unavailable'),
      tone:
        credentialHealth && credentialHealth.disabled + credentialHealth.unavailable > 0
          ? 'warning'
          : 'neutral',
    },
    {
      path: '/oauth',
      title: t('nav.oauth'),
      description: t('core_workspace.oauth_desc'),
      icon: <IconShield size={22} />,
      meta: t('core_workspace.oauth_meta'),
    },
    {
      path: '/config',
      title: t('nav.config_management'),
      description: t('core_workspace.config_desc'),
      icon: <IconSettings size={22} />,
      value: formatCount(config?.apiKeys?.length ?? null),
      meta: t('core_workspace.management_keys_meta'),
    },
  ];

  const observeLinks: WorkspaceLink[] = [
    {
      path: '/usage',
      title: t('nav.usage_stats'),
      description: t('core_workspace.usage_desc'),
      icon: <IconChartLine size={22} />,
      value: usageLoading && !usage ? DASH : formatCount(requestCount),
      meta: usageError
        ? t('core_workspace.usage_unavailable')
        : t('core_workspace.usage_meta', {
            tokens: formatCount(tokenCount),
            rate: successRate === null ? DASH : formatPercent(successRate),
          }),
      tone: usageError ? 'warning' : 'neutral',
    },
    {
      path: '/quota',
      title: t('nav.quota_management'),
      description: t('core_workspace.quota_desc'),
      icon: <IconKey size={22} />,
      value: formatCount(credentialHealth?.total ?? null),
      meta: t('core_workspace.quota_meta'),
    },
    {
      path: '/logs',
      title: t('nav.logs'),
      description: t('core_workspace.logs_desc'),
      icon: <IconScrollText size={22} />,
      meta:
        serverRuntimeKind === 'home'
          ? t('core_workspace.logs_home_meta')
          : config?.loggingToFile
            ? t('core_workspace.logs_ready_meta')
            : t('core_workspace.logs_config_meta'),
      tone: serverRuntimeKind !== 'home' && config && !config.loggingToFile ? 'warning' : 'neutral',
    },
    {
      path: '/system',
      title: t('nav.system_info'),
      description: t('core_workspace.system_desc'),
      icon: <IconInfo size={22} />,
      value: versionLabel,
      meta: buildLabel,
    },
  ];

  const pluginLinks: WorkspaceLink[] = supportsPlugin
    ? [
        {
          path: '/plugins',
          title: t('nav.plugins'),
          description: t('core_workspace.plugins_desc'),
          icon: <IconPlug size={22} />,
          value: formatCount(effectivePlugins),
          meta:
            plugins === null
              ? t('core_workspace.plugins_meta_unavailable')
              : t('core_workspace.plugins_meta', {
                  active: effectivePlugins ?? 0,
                  configured: configuredPlugins ?? 0,
                }),
        },
        {
          path: '/plugin-store',
          title: t('nav.plugin_store'),
          description: t('core_workspace.plugin_store_desc'),
          icon: <IconModelCluster size={22} />,
          meta: t('core_workspace.plugin_store_meta'),
        },
      ]
    : [];

  const summaryCards = [
    {
      label: t('core_workspace.summary_credentials'),
      value:
        authFilesLoading && authFiles === null
          ? DASH
          : formatCount(credentialHealth?.total ?? null),
      meta: credentialHealth
        ? t('core_workspace.summary_credentials_meta', { active: credentialHealth.active })
        : t('core_workspace.summary_unavailable'),
    },
    {
      label: t('core_workspace.summary_models'),
      value: modelsLoading || modelsError ? DASH : formatCount(models.length),
      meta: modelsError
        ? t('core_workspace.summary_unavailable')
        : t('core_workspace.summary_models_meta'),
    },
    {
      label: t('core_workspace.summary_requests'),
      value: usageLoading && !usage ? DASH : formatCount(requestCount),
      meta:
        usageLastRefreshedAt === null
          ? t('core_workspace.summary_unavailable')
          : t('core_workspace.summary_requests_meta', {
              models: modelStats.length,
            }),
    },
    {
      label: t('core_workspace.summary_success_rate'),
      value: successRate === null ? DASH : formatPercent(successRate),
      meta: t('core_workspace.summary_success_rate_meta'),
    },
  ];

  const renderWorkspaceCard = (item: WorkspaceLink) => (
    <Link
      key={item.path}
      to={item.path}
      className={styles.workspaceCard}
      data-tone={item.tone ?? 'neutral'}
    >
      <span className={styles.cardIcon}>{item.icon}</span>
      <span className={styles.cardBody}>
        <span className={styles.cardTitleRow}>
          <span className={styles.cardTitle}>{item.title}</span>
          {item.value !== undefined ? (
            <strong className={styles.cardValue}>{item.value}</strong>
          ) : null}
        </span>
        <span className={styles.cardDescription}>{item.description}</span>
        {item.meta ? <span className={styles.cardMeta}>{item.meta}</span> : null}
      </span>
      <span className={styles.cardArrow} aria-hidden="true">
        →
      </span>
    </Link>
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{t('core_workspace.eyebrow')}</span>
          <h1 className={styles.title}>{t('core_workspace.title')}</h1>
          <p className={styles.description}>{t('core_workspace.description')}</p>
          <div className={styles.scopeRow}>
            <span className={styles.scopeBadge}>{t('core_workspace.scope_core')}</span>
            <span className={styles.scopeText}>{t('core_workspace.scope_hint')}</span>
          </div>
        </div>

        <div className={styles.identityCard}>
          <div className={styles.identityTop}>
            <span className={styles.identityLabel}>{t('core_workspace.current_core')}</span>
            <span className={styles.connectionBadge} data-status={connectionStatus}>
              <i aria-hidden="true" />
              {t(`core_workspace.connection_${connectionStatus}`)}
            </span>
          </div>
          <strong className={styles.identityVersion}>{versionLabel}</strong>
          <dl className={styles.identityList}>
            <div>
              <dt>{t('core_workspace.runtime_label')}</dt>
              <dd>{runtimeLabel}</dd>
            </div>
            <div>
              <dt>{t('core_workspace.endpoint_label')}</dt>
              <dd title={apiBase}>{apiBase || DASH}</dd>
            </div>
            <div>
              <dt>{t('core_workspace.build_label')}</dt>
              <dd>{buildLabel}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.summaryGrid} aria-label={t('core_workspace.summary_aria')}>
        {summaryCards.map((item) => (
          <article key={item.label} className={styles.summaryCard}>
            <span className={styles.summaryLabel}>{item.label}</span>
            <strong className={styles.summaryValue}>{item.value}</strong>
            <span className={styles.summaryMeta}>{item.meta}</span>
          </article>
        ))}
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionIndex}>01</span>
          <div>
            <h2>{t('core_workspace.provider_scopes_title')}</h2>
            <p>{t('core_workspace.provider_scopes_desc')}</p>
          </div>
        </header>
        <div className={styles.providerScopeGrid}>
          {providerScopes.map((provider) => (
            <article
              key={provider.id}
              className={styles.providerScopeCard}
              data-provider={provider.id}
            >
              <div className={styles.providerScopeHead}>
                <span className={styles.providerGlyph}>{provider.glyph}</span>
                <div>
                  <h3>{provider.title}</h3>
                  <p>{provider.description}</p>
                </div>
              </div>
              <div className={styles.providerScopeStats}>
                {provider.id !== 'pools' ? (
                  <span>
                    <strong>{formatCount(provider.credentialCount)}</strong>
                    {t('core_workspace.provider_credentials')}
                  </span>
                ) : null}
                {provider.keyCount !== undefined ? (
                  <span>
                    <strong>{formatCount(provider.keyCount ?? null)}</strong>
                    {t('core_workspace.provider_keys')}
                  </span>
                ) : null}
              </div>
              <div className={styles.providerScopeActions}>
                {provider.actions.map((action) => (
                  <Link key={`${provider.id}-${action.path}`} to={action.path}>
                    {action.label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionIndex}>02</span>
          <div>
            <h2>{t('core_workspace.gateway_title')}</h2>
            <p>{t('core_workspace.gateway_desc')}</p>
          </div>
        </header>
        <div className={styles.cardGrid}>{gatewayLinks.map(renderWorkspaceCard)}</div>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <span className={styles.sectionIndex}>03</span>
          <div>
            <h2>{t('core_workspace.observe_title')}</h2>
            <p>{t('core_workspace.observe_desc')}</p>
          </div>
        </header>
        <div className={styles.cardGrid}>{observeLinks.map(renderWorkspaceCard)}</div>
      </section>

      {supportsPlugin ? (
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionIndex}>04</span>
            <div>
              <h2>{t('core_workspace.extend_title')}</h2>
              <p>{t('core_workspace.extend_desc')}</p>
            </div>
          </header>
          <div className={styles.cardGrid}>{pluginLinks.map(renderWorkspaceCard)}</div>
        </section>
      ) : pluginSupportKnown && config?.pluginsEnabled ? (
        <Link to="/plugins" className={styles.pluginNotice}>
          <span className={styles.cardIcon}>
            <IconPlug size={22} />
          </span>
          <span>
            <strong>{t('core_workspace.plugins_runtime_title')}</strong>
            <small>{t('core_workspace.plugins_runtime_desc')}</small>
          </span>
          <span className={styles.cardArrow} aria-hidden="true">
            →
          </span>
        </Link>
      ) : null}
    </div>
  );
}
