import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AmpcodeSection,
  ClaudeSection,
  CodexSection,
  GeminiSection,
  OpenAISection,
  VertexSection,
  ProviderNav,
  useProviderStats,
} from '@/components/providers';
import {
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ampcodeApi, getOpenAIProviderMutationIndex, providersApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { indexUsageDetailsByAuthIndex, indexUsageDetailsBySource } from '@/utils/usageIndex';
import styles from './AiProvidersPage.module.scss';

export function AiProvidersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const refreshProviders = useConfigStore((state) => state.refreshProviders);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid());
  const [error, setError] = useState('');

  const geminiKeys = config?.geminiApiKeys ?? [];
  const codexConfigs = config?.codexApiKeys ?? [];
  const claudeConfigs = config?.claudeApiKeys ?? [];
  const vertexConfigs = config?.vertexApiKeys ?? [];
  const openaiProviders = config?.openaiCompatibility ?? [];

  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);

  const disableControls = connectionStatus !== 'connected' || loading;
  const isSwitching = Boolean(configSwitchingKey);

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const {
    keyStats,
    usageDetails,
    querySummary,
    loadKeyStats,
    refreshKeyStats,
    error: usageError,
  } = useProviderStats({
    enabled: isCurrentLayer,
  });
  const usageDetailsBySource = useMemo(
    () => indexUsageDetailsBySource(usageDetails, querySummary),
    [usageDetails, querySummary]
  );
  const usageDetailsByAuthIndex = useMemo(
    () => indexUsageDetailsByAuthIndex(usageDetails, querySummary),
    [usageDetails, querySummary]
  );

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const loadRequest = useRef(0);
  const loadConfigs = useCallback(async () => {
    const request = ++loadRequest.current;
    const generation = apiClient.getConnectionGeneration();
    const isCurrent = () =>
      request === loadRequest.current && apiClient.isCurrentConnection(generation);
    setLoading(true);
    setError('');
    try {
      const [data, ampcodeResult] = await Promise.all([
        refreshProviders(),
        ampcodeApi
          .getAmpcode()
          .then((value) => ({ value }))
          .catch(() => null),
      ]);
      if (!isCurrent() || !data) return;
      if (ampcodeResult && useConfigStore.getState().config === data)
        updateConfigValue('ampcode', ampcodeResult.value);
    } catch (err) {
      if (isCurrent()) setError(getErrorMessage(err) || t('notification.refresh_failed'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [refreshProviders, t, updateConfigValue]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadKeyStats().catch(() => {});
  }, [isCurrentLayer, loadKeyStats]);

  useHeaderRefresh(refreshKeyStats, isCurrentLayer);

  const openEditor = useCallback(
    (path: string) => {
      navigate(path, { state: { fromAiProviders: true } });
    },
    [navigate]
  );

  const runProviderMutation = async (
    action: () => Promise<unknown>,
    successKey: string,
    failureKey: string
  ) => {
    const generation = apiClient.getConnectionGeneration();
    try {
      await action();
      if (apiClient.isCurrentConnection(generation)) showNotification(t(successKey), 'success');
    } catch (err) {
      if (apiClient.isCurrentConnection(generation))
        showNotification(`${t(failureKey)}: ${getErrorMessage(err)}`, 'error');
    } finally {
      if (apiClient.isCurrentConnection(generation)) await loadConfigs();
    }
  };

  const deleteGemini = async (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.gemini_delete_title', { defaultValue: 'Delete Gemini Key' }),
      message: t('ai_providers.gemini_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () =>
        runProviderMutation(
          () => providersApi.deleteGeminiKey(entry.apiKey, entry.baseUrl, entry),
          'notification.gemini_key_deleted',
          'notification.delete_failed'
        ),
    });
  };

  const setConfigEnabled = async (
    provider: 'gemini' | 'codex' | 'claude' | 'vertex',
    index: number,
    enabled: boolean
  ) => {
    const source =
      provider === 'gemini'
        ? geminiKeys
        : provider === 'codex'
          ? codexConfigs
          : provider === 'claude'
            ? claudeConfigs
            : vertexConfigs;
    const current = source[index];
    if (!current) return;
    setConfigSwitchingKey(`${provider}:${current.apiKey}`);
    const next = {
      ...current,
      excludedModels: enabled
        ? withoutDisableAllModelsRule(current.excludedModels)
        : withDisableAllModelsRule(current.excludedModels),
    };
    try {
      await runProviderMutation(
        () => {
          if (provider === 'gemini')
            return providersApi.updateGeminiKey(current.apiKey, current.baseUrl, next, current);
          if (provider === 'codex')
            return providersApi.updateCodexConfig(current.apiKey, current.baseUrl, next, current);
          if (provider === 'claude')
            return providersApi.updateClaudeConfig(current.apiKey, current.baseUrl, next, current);
          return providersApi.updateVertexConfig(current.apiKey, current.baseUrl, next, current);
        },
        enabled ? 'notification.config_enabled' : 'notification.config_disabled',
        'notification.update_failed'
      );
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const setOpenAIProviderEnabled = async (index: number, enabled: boolean) => {
    const current = openaiProviders[index];
    if (!current) return;
    const mutationIndex = getOpenAIProviderMutationIndex(current, index);
    setConfigSwitchingKey(`openai:${current.name}:${index}`);
    try {
      await runProviderMutation(
        () => providersApi.updateOpenAIProviderDisabled(mutationIndex, !enabled, current),
        enabled ? 'notification.config_enabled' : 'notification.config_disabled',
        'notification.update_failed'
      );
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const deleteProviderEntry = async (type: 'codex' | 'claude', index: number) => {
    const entry = (type === 'codex' ? codexConfigs : claudeConfigs)[index];
    if (!entry) return;
    showConfirmation({
      title: t(`ai_providers.${type}_delete_title`, {
        defaultValue: `Delete ${type === 'codex' ? 'Codex' : 'Claude'} Config`,
      }),
      message: t(`ai_providers.${type}_delete_confirm`),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () =>
        runProviderMutation(
          () =>
            type === 'codex'
              ? providersApi.deleteCodexConfig(entry.apiKey, entry.baseUrl, entry)
              : providersApi.deleteClaudeConfig(entry.apiKey, entry.baseUrl, entry),
          `notification.${type}_config_deleted`,
          'notification.delete_failed'
        ),
    });
  };

  const deleteVertex = async (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.vertex_delete_title', { defaultValue: 'Delete Vertex Config' }),
      message: t('ai_providers.vertex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () =>
        runProviderMutation(
          () => providersApi.deleteVertexConfig(entry.apiKey, entry.baseUrl, entry),
          'notification.vertex_config_deleted',
          'notification.delete_failed'
        ),
    });
  };

  const deleteOpenai = async (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    const mutationIndex = getOpenAIProviderMutationIndex(entry, index);
    showConfirmation({
      title: t('ai_providers.openai_delete_title', { defaultValue: 'Delete OpenAI Provider' }),
      message: t('ai_providers.openai_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () =>
        runProviderMutation(
          () => providersApi.deleteOpenAIProvider(mutationIndex, entry),
          'notification.openai_provider_deleted',
          'notification.delete_failed'
        ),
    });
  };

  return (
    <div className={styles.container}>
      {usageError && (
        <div role="alert">
          {t('usage_stats.loading_error')}: {usageError}
        </div>
      )}
      <h1 className={styles.pageTitle}>{t('ai_providers.title')}</h1>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <div id="provider-gemini">
          <GeminiSection
            configs={geminiKeys}
            keyStats={keyStats}
            usageDetailsBySource={usageDetailsBySource}
            usageDetailsByAuthIndex={usageDetailsByAuthIndex}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/legacy/gemini/new')}
            onEdit={(index) => openEditor(`/ai-providers/legacy/gemini/${index}`)}
            onDelete={deleteGemini}
            onToggle={(index, enabled) => void setConfigEnabled('gemini', index, enabled)}
          />
        </div>

        <div id="provider-codex">
          <CodexSection
            configs={codexConfigs}
            keyStats={keyStats}
            usageDetailsBySource={usageDetailsBySource}
            usageDetailsByAuthIndex={usageDetailsByAuthIndex}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/legacy/codex/new')}
            onEdit={(index) => openEditor(`/ai-providers/legacy/codex/${index}`)}
            onDelete={(index) => void deleteProviderEntry('codex', index)}
            onToggle={(index, enabled) => void setConfigEnabled('codex', index, enabled)}
          />
        </div>

        <div id="provider-claude">
          <ClaudeSection
            configs={claudeConfigs}
            keyStats={keyStats}
            usageDetailsBySource={usageDetailsBySource}
            usageDetailsByAuthIndex={usageDetailsByAuthIndex}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/legacy/claude/new')}
            onEdit={(index) => openEditor(`/ai-providers/legacy/claude/${index}`)}
            onDelete={(index) => void deleteProviderEntry('claude', index)}
            onToggle={(index, enabled) => void setConfigEnabled('claude', index, enabled)}
          />
        </div>

        <div id="provider-vertex">
          <VertexSection
            configs={vertexConfigs}
            keyStats={keyStats}
            usageDetailsBySource={usageDetailsBySource}
            usageDetailsByAuthIndex={usageDetailsByAuthIndex}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/legacy/vertex/new')}
            onEdit={(index) => openEditor(`/ai-providers/legacy/vertex/${index}`)}
            onDelete={deleteVertex}
            onToggle={(index, enabled) => void setConfigEnabled('vertex', index, enabled)}
          />
        </div>

        <div id="provider-ampcode">
          <AmpcodeSection
            config={config?.ampcode}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onEdit={() => openEditor('/ai-providers/legacy/ampcode')}
          />
        </div>

        <div id="provider-openai">
          <OpenAISection
            configs={openaiProviders}
            keyStats={keyStats}
            usageDetailsBySource={usageDetailsBySource}
            usageDetailsByAuthIndex={usageDetailsByAuthIndex}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/legacy/openai/new')}
            onEdit={(index) => openEditor(`/ai-providers/legacy/openai/${index}`)}
            onDelete={deleteOpenai}
            onToggle={(index, enabled) => void setOpenAIProviderEnabled(index, enabled)}
          />
        </div>
      </div>

      <ProviderNav />
    </div>
  );
}
