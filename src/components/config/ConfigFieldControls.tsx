import { useCodexPolicyControls } from '@/lts/codexPolicy/useCodexPolicyControls';
import { useCallback, useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleRow, FieldShell } from './ConfigFieldShells';
import type {
  PayloadFilterRule,
  PayloadParamValidationErrorCode,
  PayloadRule,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';
import {
  ApiKeysCardEditor,
  PayloadFilterRulesEditor,
  PayloadRulesEditor,
  PluginStoreAuthEditor,
  StringListEditor,
} from './VisualConfigEditorBlocks';
import type { StandardConfigFieldId } from './configNavigation';
import styles from './VisualConfigEditor.module.scss';
export type ConfigFieldsProps = {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  disabled?: boolean;
  onChange: (patch: Partial<VisualConfigValues>) => void;
};
function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

// Hand-authored controls are moved intact; the catalogue does not generate forms or serialize YAML.
export function useConfigFieldControls({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigFieldsProps): Record<StandardConfigFieldId, ReactNode> {
  const { t } = useTranslation();
  const codexControls = useCodexPolicyControls({ values, validationErrors, disabled, onChange });
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const disableImageGenerationLabelId = useId();
  const disableImageGenerationHintId = `${disableImageGenerationLabelId}-hint`;

  const keepaliveInputId = useId();
  const keepaliveHintId = `${keepaliveInputId}-hint`;
  const keepaliveErrorId = `${keepaliveInputId}-error`;
  const nonstreamKeepaliveInputId = useId();
  const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`;
  const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`;
  const isKeepaliveDisabled =
    values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' ||
    values.streaming.nonstreamKeepaliveInterval === '0';

  const portError = getValidationMessage(t, validationErrors?.port);
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const errorLogsMaxFilesError = getValidationMessage(t, validationErrors?.errorLogsMaxFiles);
  const redisUsageQueueRetentionError = getValidationMessage(
    t,
    validationErrors?.redisUsageQueueRetentionSeconds
  );
  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const transientErrorCooldownSecondsError = getValidationMessage(
    t,
    validationErrors?.transientErrorCooldownSeconds
  );
  const authAutoRefreshWorkersError = getValidationMessage(
    t,
    validationErrors?.authAutoRefreshWorkers
  );

  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );

  const handleApiKeysTextChange = useCallback(
    (apiKeysText: string) => onChange({ apiKeysText }),
    [onChange]
  );
  const handlePluginStoreSourcesChange = useCallback(
    (pluginStoreSources: string[]) => onChange({ pluginStoreSources }),
    [onChange]
  );
  const handlePluginStoreAuthChange = useCallback(
    (pluginStoreAuth: VisualConfigValues['pluginStoreAuth']) => onChange({ pluginStoreAuth }),
    [onChange]
  );
  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );
  const disableImageGenerationOptions = useMemo(
    () => [
      {
        value: 'false',
        label: t('config_management.visual.sections.network.disable_image_generation_false'),
      },
      {
        value: 'true',
        label: t('config_management.visual.sections.network.disable_image_generation_true'),
      },
      {
        value: 'chat',
        label: t('config_management.visual.sections.network.disable_image_generation_chat'),
      },
      {
        value: 'passthrough',
        label: t('config_management.visual.sections.network.disable_image_generation_passthrough'),
      },
    ],
    [t]
  );

  return {
    ...codexControls,
    host: (
      <Input
        label={t('config_management.visual.sections.server.host')}
        placeholder="0.0.0.0"
        value={values.host}
        onChange={(e) => onChange({ host: e.target.value })}
        disabled={disabled}
      />
    ),
    port: (
      <Input
        label={t('config_management.visual.sections.server.port')}
        type="number"
        placeholder="8317"
        value={values.port}
        onChange={(e) => onChange({ port: e.target.value })}
        disabled={disabled}
        error={portError}
      />
    ),
    tlsEnable: (
      <ToggleRow
        title={t('config_management.visual.sections.tls.enable')}
        description={t('config_management.visual.sections.tls.enable_desc')}
        checked={values.tlsEnable}
        disabled={disabled}
        onChange={(tlsEnable) => onChange({ tlsEnable })}
      />
    ),
    tlsCert: (
      <Input
        label={t('config_management.visual.sections.tls.cert')}
        placeholder="/path/to/cert.pem"
        value={values.tlsCert}
        onChange={(e) => onChange({ tlsCert: e.target.value })}
        disabled={disabled}
      />
    ),
    tlsKey: (
      <Input
        label={t('config_management.visual.sections.tls.key')}
        placeholder="/path/to/key.pem"
        value={values.tlsKey}
        onChange={(e) => onChange({ tlsKey: e.target.value })}
        disabled={disabled}
      />
    ),
    rmAllowRemote: (
      <ToggleRow
        title={t('config_management.visual.sections.remote.allow_remote')}
        description={t('config_management.visual.sections.remote.allow_remote_desc')}
        checked={values.rmAllowRemote}
        disabled={disabled}
        onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
      />
    ),
    rmDisableControlPanel: (
      <ToggleRow
        title={t('config_management.visual.sections.remote.disable_panel')}
        description={t('config_management.visual.sections.remote.disable_panel_desc')}
        checked={values.rmDisableControlPanel}
        disabled={disabled}
        onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
      />
    ),
    rmDisableAutoUpdatePanel: (
      <ToggleRow
        title={t('config_management.visual.sections.remote.disable_auto_update_panel')}
        description={t('config_management.visual.sections.remote.disable_auto_update_panel_desc')}
        checked={values.rmDisableAutoUpdatePanel}
        disabled={disabled}
        onChange={(rmDisableAutoUpdatePanel) => onChange({ rmDisableAutoUpdatePanel })}
      />
    ),
    rmSecretKey: (
      <Input
        label={t('config_management.visual.sections.remote.secret_key')}
        type="password"
        placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
        value={values.rmSecretKey}
        onChange={(e) => onChange({ rmSecretKey: e.target.value })}
        disabled={disabled}
      />
    ),
    rmPanelRepo: (
      <Input
        label={t('config_management.visual.sections.remote.panel_repo')}
        placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
        value={values.rmPanelRepo}
        onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
        disabled={disabled}
      />
    ),
    authDir: (
      <Input
        label={t('config_management.visual.sections.auth.auth_dir')}
        placeholder="~/.cli-proxy-api"
        value={values.authDir}
        onChange={(e) => onChange({ authDir: e.target.value })}
        disabled={disabled}
        hint={t('config_management.visual.sections.auth.auth_dir_hint')}
      />
    ),
    apiKeysText: (
      <ApiKeysCardEditor
        value={values.apiKeysText}
        disabled={disabled}
        onChange={handleApiKeysTextChange}
      />
    ),
    debug: (
      <ToggleRow
        title={t('config_management.visual.sections.system.debug')}
        description={t('config_management.visual.sections.system.debug_desc')}
        checked={values.debug}
        disabled={disabled}
        onChange={(debug) => onChange({ debug })}
      />
    ),
    commercialMode: (
      <ToggleRow
        title={t('config_management.visual.sections.system.commercial_mode')}
        description={t('config_management.visual.sections.system.commercial_mode_desc')}
        checked={values.commercialMode}
        disabled={disabled}
        onChange={(commercialMode) => onChange({ commercialMode })}
      />
    ),
    loggingToFile: (
      <ToggleRow
        title={t('config_management.visual.sections.system.logging_to_file')}
        description={t('config_management.visual.sections.system.logging_to_file_desc')}
        checked={values.loggingToFile}
        disabled={disabled}
        onChange={(loggingToFile) => onChange({ loggingToFile })}
      />
    ),
    logsMaxTotalSizeMb: (
      <Input
        label={t('config_management.visual.sections.system.logs_max_size')}
        type="number"
        placeholder="0"
        value={values.logsMaxTotalSizeMb}
        onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
        disabled={disabled}
        error={logsMaxSizeError}
      />
    ),
    errorLogsMaxFiles: (
      <Input
        label={t('config_management.visual.sections.system.error_logs_max_files')}
        type="number"
        placeholder="10"
        value={values.errorLogsMaxFiles}
        onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
        disabled={disabled}
        error={errorLogsMaxFilesError}
      />
    ),
    redisUsageQueueRetentionSeconds: (
      <Input
        label={t('config_management.visual.sections.system.redis_usage_retention')}
        type="number"
        min={1}
        max={3600}
        placeholder="60"
        value={values.redisUsageQueueRetentionSeconds}
        onChange={(e) => onChange({ redisUsageQueueRetentionSeconds: e.target.value })}
        disabled={disabled}
        hint={t('config_management.visual.sections.system.redis_usage_retention_hint')}
        error={redisUsageQueueRetentionError}
      />
    ),
    usageStatisticsEnabled: (
      <ToggleRow
        title={t('config_management.visual.sections.system.usage_statistics_enabled')}
        description={t('config_management.visual.sections.system.usage_statistics_enabled_desc')}
        checked={values.usageStatisticsEnabled}
        disabled={disabled}
        onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
      />
    ),
    antigravitySignatureCacheEnabled: (
      <ToggleRow
        title={t('config_management.visual.sections.system.antigravity_signature_cache')}
        description={t('config_management.visual.sections.system.antigravity_signature_cache_desc')}
        checked={values.antigravitySignatureCacheEnabled}
        disabled={disabled}
        onChange={(antigravitySignatureCacheEnabled) =>
          onChange({ antigravitySignatureCacheEnabled })
        }
      />
    ),
    antigravitySignatureBypassStrict: (
      <ToggleRow
        title={t('config_management.visual.sections.system.antigravity_signature_strict')}
        description={t(
          'config_management.visual.sections.system.antigravity_signature_strict_desc'
        )}
        checked={values.antigravitySignatureBypassStrict}
        disabled={disabled}
        onChange={(antigravitySignatureBypassStrict) =>
          onChange({ antigravitySignatureBypassStrict })
        }
      />
    ),
    antigravitySensitiveWords: (
      <div className={styles.fieldShell} data-testid="antigravity-sensitive-words">
        <label className={styles.fieldLabel}>
          {t('config_management.visual.sections.system.antigravity_sensitive_words')}
        </label>
        <StringListEditor
          value={values.antigravitySensitiveWords}
          disabled={disabled}
          inputAriaLabel={t(
            'config_management.visual.sections.system.antigravity_sensitive_words_label'
          )}
          placeholder={t(
            'config_management.visual.sections.system.antigravity_sensitive_words_placeholder'
          )}
          onChange={(antigravitySensitiveWords) => onChange({ antigravitySensitiveWords })}
        />
        <div className={styles.fieldHint}>
          {t('config_management.visual.sections.system.antigravity_sensitive_words_desc')}
        </div>
      </div>
    ),
    pluginsEnabled: (
      <ToggleRow
        title={t('config_management.visual.sections.system.plugins_enabled')}
        description={t('config_management.visual.sections.system.plugins_enabled_desc')}
        checked={values.pluginsEnabled}
        disabled={disabled}
        onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
      />
    ),
    pluginStoreSources: (
      <div className={styles.fieldShell}>
        <label className={styles.fieldLabel}>
          {t('config_management.visual.sections.system.plugin_store_sources_label')}
        </label>
        <StringListEditor
          value={values.pluginStoreSources}
          disabled={disabled}
          placeholder={t(
            'config_management.visual.sections.system.plugin_store_sources_placeholder'
          )}
          inputAriaLabel={t('config_management.visual.sections.system.plugin_store_sources_label')}
          onChange={handlePluginStoreSourcesChange}
        />
        <div className={styles.fieldHint}>
          {t('config_management.visual.sections.system.plugin_store_sources_hint')}
        </div>
      </div>
    ),
    pluginStoreAuth: (
      <div className={styles.fieldShell}>
        <div className={styles.fieldHint}>
          {t('config_management.visual.sections.system.plugin_store_auth_hint')}
        </div>
        <PluginStoreAuthEditor
          value={values.pluginStoreAuth}
          disabled={disabled}
          onChange={handlePluginStoreAuthChange}
        />
      </div>
    ),
    claudeHeaderUserAgent: (
      <Input
        label={t('config_management.visual.sections.headers.user_agent')}
        placeholder="claude-cli/2.1.44 (external, sdk-cli)"
        value={values.claudeHeaderUserAgent}
        onChange={(e) => onChange({ claudeHeaderUserAgent: e.target.value })}
        disabled={disabled}
      />
    ),
    claudeHeaderPackageVersion: (
      <Input
        label={t('config_management.visual.sections.headers.package_version')}
        placeholder="0.74.0"
        value={values.claudeHeaderPackageVersion}
        onChange={(e) => onChange({ claudeHeaderPackageVersion: e.target.value })}
        disabled={disabled}
      />
    ),
    claudeHeaderRuntimeVersion: (
      <Input
        label={t('config_management.visual.sections.headers.runtime_version')}
        placeholder="v24.3.0"
        value={values.claudeHeaderRuntimeVersion}
        onChange={(e) => onChange({ claudeHeaderRuntimeVersion: e.target.value })}
        disabled={disabled}
      />
    ),
    claudeHeaderOs: (
      <Input
        label={t('config_management.visual.sections.headers.os')}
        placeholder="MacOS"
        value={values.claudeHeaderOs}
        onChange={(e) => onChange({ claudeHeaderOs: e.target.value })}
        disabled={disabled}
      />
    ),
    claudeHeaderArch: (
      <Input
        label={t('config_management.visual.sections.headers.arch')}
        placeholder="arm64"
        value={values.claudeHeaderArch}
        onChange={(e) => onChange({ claudeHeaderArch: e.target.value })}
        disabled={disabled}
      />
    ),
    claudeHeaderTimeout: (
      <Input
        label={t('config_management.visual.sections.headers.timeout')}
        placeholder="600"
        value={values.claudeHeaderTimeout}
        onChange={(e) => onChange({ claudeHeaderTimeout: e.target.value })}
        disabled={disabled}
      />
    ),
    claudeHeaderStabilizeDeviceProfile: (
      <ToggleRow
        title={t('config_management.visual.sections.headers.stabilize_device')}
        description={t('config_management.visual.sections.headers.stabilize_device_desc')}
        checked={values.claudeHeaderStabilizeDeviceProfile}
        disabled={disabled}
        onChange={(claudeHeaderStabilizeDeviceProfile) =>
          onChange({ claudeHeaderStabilizeDeviceProfile })
        }
      />
    ),
    codexHeaderUserAgent: (
      <Input
        label={t('config_management.visual.sections.headers.user_agent')}
        placeholder="codex_cli_rs/0.114.0 (Mac OS 14.2.0; x86_64) vscode/1.111.0"
        value={values.codexHeaderUserAgent}
        onChange={(e) => onChange({ codexHeaderUserAgent: e.target.value })}
        disabled={disabled}
      />
    ),
    codexHeaderBetaFeatures: (
      <Input
        label={t('config_management.visual.sections.headers.beta_features')}
        placeholder="multi_agent"
        value={values.codexHeaderBetaFeatures}
        onChange={(e) => onChange({ codexHeaderBetaFeatures: e.target.value })}
        disabled={disabled}
      />
    ),
    codexIdentityConfuse: (
      <ToggleRow
        title={t('config_management.visual.sections.headers.codex_identity_confuse')}
        description={t('config_management.visual.sections.headers.codex_identity_confuse_desc')}
        checked={values.codexIdentityConfuse}
        disabled={disabled}
        onChange={(codexIdentityConfuse) => onChange({ codexIdentityConfuse })}
      />
    ),

    proxyUrl: (
      <Input
        label={t('config_management.visual.sections.network.proxy_url')}
        placeholder="socks5://user:pass@127.0.0.1:1080/"
        value={values.proxyUrl}
        onChange={(e) => onChange({ proxyUrl: e.target.value })}
        disabled={disabled}
      />
    ),
    requestRetry: (
      <Input
        label={t('config_management.visual.sections.network.request_retry')}
        type="number"
        placeholder="3"
        value={values.requestRetry}
        onChange={(e) => onChange({ requestRetry: e.target.value })}
        disabled={disabled}
        error={requestRetryError}
      />
    ),
    maxRetryCredentials: (
      <Input
        label={t('config_management.visual.sections.network.max_retry_credentials')}
        type="number"
        placeholder="0"
        value={values.maxRetryCredentials}
        onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
        disabled={disabled}
        hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
        error={maxRetryCredentialsError}
      />
    ),
    maxRetryInterval: (
      <Input
        label={t('config_management.visual.sections.network.max_retry_interval')}
        type="number"
        placeholder="30"
        value={values.maxRetryInterval}
        onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
        disabled={disabled}
        error={maxRetryIntervalError}
      />
    ),
    transientErrorCooldownSeconds: (
      <Input
        label={t('config_management.visual.sections.network.transient_error_cooldown_seconds')}
        type="number"
        placeholder="30"
        value={values.transientErrorCooldownSeconds}
        onChange={(e) => onChange({ transientErrorCooldownSeconds: e.target.value })}
        disabled={disabled}
        hint={t('config_management.visual.sections.network.transient_error_cooldown_seconds_hint')}
        error={transientErrorCooldownSecondsError}
      />
    ),
    authAutoRefreshWorkers: (
      <Input
        label={t('config_management.visual.sections.network.auth_auto_refresh_workers')}
        type="number"
        placeholder="16"
        value={values.authAutoRefreshWorkers}
        onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
        disabled={disabled}
        hint={t('config_management.visual.sections.network.auth_auto_refresh_workers_hint')}
        error={authAutoRefreshWorkersError}
      />
    ),
    routingStrategy: (
      <FieldShell
        label={t('config_management.visual.sections.network.routing_strategy')}
        labelId={routingStrategyLabelId}
        hint={t('config_management.visual.sections.network.routing_strategy_hint')}
        hintId={routingStrategyHintId}
      >
        <Select
          value={values.routingStrategy}
          options={[
            {
              value: 'round-robin',
              label: t('config_management.visual.sections.network.strategy_round_robin'),
            },
            {
              value: 'weighted-round-robin',
              label: t('config_management.visual.sections.network.strategy_weighted_round_robin'),
            },
            {
              value: 'fill-first',
              label: t('config_management.visual.sections.network.strategy_fill_first'),
            },
          ]}
          id={`${routingStrategyLabelId}-select`}
          disabled={disabled}
          ariaLabelledBy={routingStrategyLabelId}
          ariaDescribedBy={routingStrategyHintId}
          onChange={(nextValue) =>
            onChange({
              routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
            })
          }
        />
      </FieldShell>
    ),
    disableImageGeneration: (
      <FieldShell
        label={t('config_management.visual.sections.network.disable_image_generation')}
        labelId={disableImageGenerationLabelId}
        hint={t('config_management.visual.sections.network.disable_image_generation_hint')}
        hintId={disableImageGenerationHintId}
      >
        <Select
          value={values.disableImageGeneration}
          options={disableImageGenerationOptions}
          id={`${disableImageGenerationLabelId}-select`}
          disabled={disabled}
          ariaLabelledBy={disableImageGenerationLabelId}
          ariaDescribedBy={disableImageGenerationHintId}
          onChange={(nextValue) =>
            onChange({
              disableImageGeneration: nextValue as VisualConfigValues['disableImageGeneration'],
            })
          }
        />
      </FieldShell>
    ),
    gptImage2BaseModel: (
      <Input
        label={t('config_management.visual.sections.network.gpt_image_2_base_model')}
        placeholder="gpt-5.4-mini"
        value={values.gptImage2BaseModel}
        onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
        disabled={disabled}
        hint={t('config_management.visual.sections.network.gpt_image_2_base_model_hint')}
      />
    ),
    routingSessionAffinityTTL: (
      <Input
        label={t('config_management.visual.sections.network.session_affinity_ttl')}
        placeholder="1h"
        value={values.routingSessionAffinityTTL}
        onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
        disabled={disabled}
      />
    ),
    forceModelPrefix: (
      <ToggleRow
        title={t('config_management.visual.sections.network.force_model_prefix')}
        description={t('config_management.visual.sections.network.force_model_prefix_desc')}
        checked={values.forceModelPrefix}
        disabled={disabled}
        onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
      />
    ),
    passthroughHeaders: (
      <ToggleRow
        title={t('config_management.visual.sections.network.passthrough_headers')}
        description={t('config_management.visual.sections.network.passthrough_headers_desc')}
        checked={values.passthroughHeaders}
        disabled={disabled}
        onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
      />
    ),
    disableCooling: (
      <ToggleRow
        title={t('config_management.visual.sections.network.disable_cooling')}
        description={t('config_management.visual.sections.network.disable_cooling_desc')}
        checked={values.disableCooling}
        disabled={disabled}
        onChange={(disableCooling) => onChange({ disableCooling })}
      />
    ),
    routingSessionAffinity: (
      <ToggleRow
        title={t('config_management.visual.sections.network.session_affinity')}
        checked={values.routingSessionAffinity}
        disabled={disabled}
        onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
      />
    ),
    wsAuth: (
      <ToggleRow
        title={t('config_management.visual.sections.network.ws_auth')}
        description={t('config_management.visual.sections.network.ws_auth_desc')}
        checked={values.wsAuth}
        disabled={disabled}
        onChange={(wsAuth) => onChange({ wsAuth })}
      />
    ),
    enableGeminiCliEndpoint: (
      <ToggleRow
        title={t('config_management.visual.sections.network.enable_gemini_cli_endpoint')}
        description={t('config_management.visual.sections.network.enable_gemini_cli_endpoint_desc')}
        checked={values.enableGeminiCliEndpoint}
        disabled={disabled}
        onChange={(enableGeminiCliEndpoint) => onChange({ enableGeminiCliEndpoint })}
      />
    ),
    quotaSwitchProject: (
      <ToggleRow
        title={t('config_management.visual.sections.quota.switch_project')}
        description={t('config_management.visual.sections.quota.switch_project_desc')}
        checked={values.quotaSwitchProject}
        disabled={disabled}
        onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
      />
    ),
    quotaSwitchPreviewModel: (
      <ToggleRow
        title={t('config_management.visual.sections.quota.switch_preview_model')}
        description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
        checked={values.quotaSwitchPreviewModel}
        disabled={disabled}
        onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
      />
    ),
    quotaAntigravityCredits: (
      <ToggleRow
        title={t('config_management.visual.sections.quota.antigravity_credits')}
        checked={values.quotaAntigravityCredits}
        disabled={disabled}
        onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
      />
    ),
    'streaming.keepaliveSeconds': (
      <FieldShell
        label={t('config_management.visual.sections.streaming.keepalive_seconds')}
        htmlFor={keepaliveInputId}
        hint={t('config_management.visual.sections.streaming.keepalive_hint')}
        hintId={keepaliveHintId}
        error={keepaliveError}
        errorId={keepaliveErrorId}
      >
        <div className={styles.fieldControl}>
          <input
            id={keepaliveInputId}
            className="input"
            type="number"
            placeholder="0"
            value={values.streaming.keepaliveSeconds}
            onChange={(e) =>
              onChange({
                streaming: {
                  ...values.streaming,
                  keepaliveSeconds: e.target.value,
                },
              })
            }
            disabled={disabled}
          />
          {isKeepaliveDisabled ? (
            <span className={styles.inlinePill}>
              {t('config_management.visual.sections.streaming.disabled')}
            </span>
          ) : null}
        </div>
      </FieldShell>
    ),
    'streaming.bootstrapRetries': (
      <Input
        label={t('config_management.visual.sections.streaming.bootstrap_retries')}
        type="number"
        placeholder="1"
        value={values.streaming.bootstrapRetries}
        onChange={(e) =>
          onChange({
            streaming: {
              ...values.streaming,
              bootstrapRetries: e.target.value,
            },
          })
        }
        disabled={disabled}
        hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
        error={bootstrapRetriesError}
      />
    ),
    'streaming.nonstreamKeepaliveInterval': (
      <FieldShell
        label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
        htmlFor={nonstreamKeepaliveInputId}
        hint={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
        hintId={nonstreamKeepaliveHintId}
        error={nonstreamKeepaliveError}
        errorId={nonstreamKeepaliveErrorId}
      >
        <div className={styles.fieldControl}>
          <input
            id={nonstreamKeepaliveInputId}
            className="input"
            type="number"
            placeholder="0"
            value={values.streaming.nonstreamKeepaliveInterval}
            onChange={(e) =>
              onChange({
                streaming: {
                  ...values.streaming,
                  nonstreamKeepaliveInterval: e.target.value,
                },
              })
            }
            disabled={disabled}
          />
          {isNonstreamKeepaliveDisabled ? (
            <span className={styles.inlinePill}>
              {t('config_management.visual.sections.streaming.disabled')}
            </span>
          ) : null}
        </div>
      </FieldShell>
    ),
    payloadDefaultRules: (
      <PayloadRulesEditor
        value={values.payloadDefaultRules}
        disabled={disabled}
        onChange={handlePayloadDefaultRulesChange}
      />
    ),
    payloadDefaultRawRules: (
      <PayloadRulesEditor
        value={values.payloadDefaultRawRules}
        disabled={disabled}
        rawJsonValues
        onChange={handlePayloadDefaultRawRulesChange}
      />
    ),
    payloadOverrideRules: (
      <PayloadRulesEditor
        value={values.payloadOverrideRules}
        disabled={disabled}
        protocolFirst
        onChange={handlePayloadOverrideRulesChange}
      />
    ),
    payloadOverrideRawRules: (
      <PayloadRulesEditor
        value={values.payloadOverrideRawRules}
        disabled={disabled}
        protocolFirst
        rawJsonValues
        onChange={handlePayloadOverrideRawRulesChange}
      />
    ),
    payloadFilterRules: (
      <PayloadFilterRulesEditor
        value={values.payloadFilterRules}
        disabled={disabled}
        onChange={handlePayloadFilterRulesChange}
      />
    ),
  };
}
