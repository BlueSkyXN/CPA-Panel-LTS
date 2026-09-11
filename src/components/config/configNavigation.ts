import type { TFunction } from 'i18next';
import type { VisualConfigValues } from '@/types/visualConfig';
import type { FlowControlValues } from '@/lts/flowControl/model';

export type ConfigFieldId =
  | Exclude<
      keyof VisualConfigValues,
      'streaming' | 'codexAbnormalReasoningRetryEnabled' | 'flowControlVersion'
    >
  | `streaming.${keyof VisualConfigValues['streaming']}`;
export type StandardConfigFieldId = Exclude<ConfigFieldId, keyof FlowControlValues>;
export type ConfigFieldMeta = {
  labelKey: string;
  yamlKey: string;
  defaultReference?: string;
  fullWidth?: boolean;
  heading?: boolean;
  advanced?: boolean;
  aliases?: string[];
};
export const CONFIG_FIELDS = {
  host: {
    labelKey: 'config_management.visual.sections.server.host',
    yamlKey: 'host',
    fullWidth: false,
  },
  port: {
    labelKey: 'config_management.visual.sections.server.port',
    yamlKey: 'port',
    fullWidth: false,
  },
  tlsEnable: {
    labelKey: 'config_management.visual.sections.tls.enable',
    yamlKey: 'tls.enable',
    fullWidth: false,
  },
  tlsCert: {
    labelKey: 'config_management.visual.sections.tls.cert',
    yamlKey: 'tls.cert',
    fullWidth: true,
  },
  tlsKey: {
    labelKey: 'config_management.visual.sections.tls.key',
    yamlKey: 'tls.key',
    fullWidth: true,
  },
  rmAllowRemote: {
    labelKey: 'config_management.visual.sections.remote.allow_remote',
    yamlKey: 'remote-management.allow-remote',
    fullWidth: false,
  },
  rmDisableControlPanel: {
    labelKey: 'config_management.visual.sections.remote.disable_panel',
    yamlKey: 'remote-management.disable-control-panel',
    fullWidth: false,
  },
  rmDisableAutoUpdatePanel: {
    labelKey: 'config_management.visual.sections.remote.disable_auto_update_panel',
    yamlKey: 'remote-management.disable-auto-update-panel',
    fullWidth: false,
  },
  rmSecretKey: {
    labelKey: 'config_management.visual.sections.remote.secret_key',
    yamlKey: 'remote-management.secret-key',
    fullWidth: true,
  },
  rmPanelRepo: {
    labelKey: 'config_management.visual.sections.remote.panel_repo',
    yamlKey: 'remote-management.panel-github-repository',
    fullWidth: true,
  },
  authDir: {
    labelKey: 'config_management.visual.sections.auth.auth_dir',
    yamlKey: 'auth-dir',
    fullWidth: true,
  },
  apiKeysText: {
    labelKey: 'config_management.visual.api_keys.label',
    yamlKey: 'api-keys',
    fullWidth: true,
    heading: false,
  },
  debug: {
    labelKey: 'config_management.visual.sections.system.debug',
    yamlKey: 'debug',
    fullWidth: false,
  },
  commercialMode: {
    labelKey: 'config_management.visual.sections.system.commercial_mode',
    yamlKey: 'commercial-mode',
    fullWidth: false,
  },
  loggingToFile: {
    labelKey: 'config_management.visual.sections.system.logging_to_file',
    yamlKey: 'logging-to-file',
    fullWidth: false,
  },
  logsMaxTotalSizeMb: {
    labelKey: 'config_management.visual.sections.system.logs_max_size',
    yamlKey: 'logs-max-total-size-mb',
    fullWidth: false,
  },
  errorLogsMaxFiles: {
    labelKey: 'config_management.visual.sections.system.error_logs_max_files',
    yamlKey: 'error-logs-max-files',
    fullWidth: false,
  },
  redisUsageQueueRetentionSeconds: {
    labelKey: 'config_management.visual.sections.system.redis_usage_retention',
    yamlKey: 'redis-usage-queue-retention-seconds',
    aliases: ['Redis 保留时间', 'Redis 保留時間'],
    fullWidth: false,
  },
  usageStatisticsEnabled: {
    labelKey: 'config_management.visual.sections.system.usage_statistics_enabled',
    yamlKey: 'usage-statistics-enabled',
    fullWidth: false,
  },
  antigravitySignatureCacheEnabled: {
    labelKey: 'config_management.visual.sections.system.antigravity_signature_cache',
    yamlKey: 'antigravity-signature-cache-enabled',
    fullWidth: false,
  },
  antigravitySignatureBypassStrict: {
    labelKey: 'config_management.visual.sections.system.antigravity_signature_strict',
    yamlKey: 'antigravity-signature-bypass-strict',
    fullWidth: false,
  },
  antigravitySensitiveWords: {
    labelKey: 'config_management.visual.sections.system.antigravity_sensitive_words',
    yamlKey: 'antigravity.sensitive-words',
    fullWidth: true,
  },
  pluginsEnabled: {
    labelKey: 'config_management.visual.sections.system.plugins_enabled',
    yamlKey: 'plugins.enabled',
    fullWidth: false,
  },
  pluginStoreSources: {
    labelKey: 'config_management.visual.sections.system.plugin_store_sources_label',
    yamlKey: 'plugins.store-sources',
    fullWidth: true,
  },
  pluginStoreAuth: {
    labelKey: 'config_management.visual.sections.system.plugin_store_auth',
    yamlKey: 'plugins.store-auth',
    fullWidth: true,
    heading: true,
  },
  claudeHeaderUserAgent: {
    labelKey: 'config_management.visual.sections.headers.user_agent',
    yamlKey: 'claude-header-defaults.user-agent',
    fullWidth: true,
  },
  claudeHeaderPackageVersion: {
    labelKey: 'config_management.visual.sections.headers.package_version',
    yamlKey: 'claude-header-defaults.package-version',
    fullWidth: false,
  },
  claudeHeaderRuntimeVersion: {
    labelKey: 'config_management.visual.sections.headers.runtime_version',
    yamlKey: 'claude-header-defaults.runtime-version',
    fullWidth: false,
  },
  claudeHeaderOs: {
    labelKey: 'config_management.visual.sections.headers.os',
    yamlKey: 'claude-header-defaults.os',
    fullWidth: false,
  },
  claudeHeaderArch: {
    labelKey: 'config_management.visual.sections.headers.arch',
    yamlKey: 'claude-header-defaults.arch',
    fullWidth: false,
  },
  claudeHeaderTimeout: {
    labelKey: 'config_management.visual.sections.headers.timeout',
    yamlKey: 'claude-header-defaults.timeout',
    fullWidth: false,
  },
  claudeHeaderStabilizeDeviceProfile: {
    labelKey: 'config_management.visual.sections.headers.stabilize_device',
    yamlKey: 'claude-header-defaults.stabilize-device-profile',
    fullWidth: false,
  },
  codexHeaderUserAgent: {
    labelKey: 'config_management.visual.sections.headers.user_agent',
    yamlKey: 'codex-header-defaults.user-agent',
    fullWidth: true,
  },
  codexHeaderBetaFeatures: {
    labelKey: 'config_management.visual.sections.headers.beta_features',
    yamlKey: 'codex-header-defaults.beta-features',
    fullWidth: false,
  },
  codexIdentityConfuse: {
    labelKey: 'config_management.visual.sections.headers.codex_identity_confuse',
    yamlKey: 'codex.identity-confuse',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryStreamBuffer: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer',
    yamlKey: 'codex.abnormal-reasoning-retry.stream-buffer',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryHedgedRetryEnabled: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_enabled',
    yamlKey: 'codex.abnormal-reasoning-retry.hedged-retry.enabled',
    fullWidth: true,
  },
  codexAbnormalReasoningRetryRequireDistinctAuth: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_require_distinct_auth',
    yamlKey: 'codex.abnormal-reasoning-retry.hedged-retry.require-distinct-auth',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryAction: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_label',
    yamlKey: 'codex.abnormal-reasoning-retry.action',
    fullWidth: true,
  },
  codexAbnormalReasoningRetryStreamBufferMaxBytes: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label',
    yamlKey: 'codex.abnormal-reasoning-retry.stream-buffer-max-bytes',
    defaultReference: '16 MiB (16777216 bytes)',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryHedgeDelayMs: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedge_delay_ms_label',
    yamlKey: 'codex.abnormal-reasoning-retry.hedged-retry.hedge-delay-ms',
    defaultReference: '1000 ms',
    aliases: ['对冲延迟', '對沖延遲', 'hedge delay'],
    fullWidth: false,
  },
  codexAbnormalReasoningRetryHedgedRetryMode: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_label',
    yamlKey: 'codex.abnormal-reasoning-retry.hedged-retry.mode',
    fullWidth: true,
  },
  codexAbnormalReasoningRetryModelContains: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_model_contains_label',
    yamlKey: 'codex.abnormal-reasoning-retry.model-contains',
    fullWidth: true,
  },
  codexAbnormalReasoningRetryReasoningEfforts: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_efforts_label',
    yamlKey: 'codex.abnormal-reasoning-retry.reasoning-efforts',
    fullWidth: true,
  },
  codexAbnormalReasoningRetryReasoningTokens: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_tokens_label',
    yamlKey: 'codex.abnormal-reasoning-retry.reasoning-tokens',
    fullWidth: true,
  },
  codexAbnormalReasoningRetryMaxRetries: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_max_retries_label',
    yamlKey: 'codex.abnormal-reasoning-retry.max-retries',
    defaultReference: '2',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryExhaustedBehavior: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_exhausted_behavior_label',
    yamlKey: 'codex.abnormal-reasoning-retry.exhausted-behavior',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryClientUsageAggregation: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_label',
    yamlKey: 'codex.abnormal-reasoning-retry.client-usage-aggregation',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryDeliveryPolicy: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_label',
    yamlKey: 'codex.abnormal-reasoning-retry.delivery-policy',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryFallbackPolicy: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_label',
    yamlKey: 'codex.abnormal-reasoning-retry.fallback-policy',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryAuthKinds: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_kinds_label',
    yamlKey: 'codex.abnormal-reasoning-retry.auth-kinds',
    fullWidth: false,
  },
  codexAbnormalReasoningRetryAuthIds: {
    labelKey:
      'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_ids_label',
    yamlKey: 'codex.abnormal-reasoning-retry.auth-ids',
    fullWidth: true,
  },
  proxyUrl: {
    labelKey: 'config_management.visual.sections.network.proxy_url',
    yamlKey: 'proxy-url',
    fullWidth: true,
  },
  requestRetry: {
    labelKey: 'config_management.visual.sections.network.request_retry',
    yamlKey: 'request-retry',
    fullWidth: false,
  },
  maxRetryCredentials: {
    labelKey: 'config_management.visual.sections.network.max_retry_credentials',
    yamlKey: 'max-retry-credentials',
    fullWidth: false,
  },
  maxRetryInterval: {
    labelKey: 'config_management.visual.sections.network.max_retry_interval',
    yamlKey: 'max-retry-interval',
    fullWidth: false,
  },
  transientErrorCooldownSeconds: {
    labelKey: 'config_management.visual.sections.network.transient_error_cooldown_seconds',
    yamlKey: 'transient-error-cooldown-seconds',
    fullWidth: false,
  },
  authAutoRefreshWorkers: {
    labelKey: 'config_management.visual.sections.network.auth_auto_refresh_workers',
    yamlKey: 'auth-auto-refresh-workers',
    fullWidth: false,
  },
  routingStrategy: {
    labelKey: 'config_management.visual.sections.network.routing_strategy',
    yamlKey: 'routing.strategy',
    fullWidth: false,
  },
  disableImageGeneration: {
    labelKey: 'config_management.visual.sections.network.disable_image_generation',
    yamlKey: 'disable-image-generation',
    fullWidth: false,
  },
  gptImage2BaseModel: {
    labelKey: 'config_management.visual.sections.network.gpt_image_2_base_model',
    yamlKey: 'gpt-image-2-base-model',
    fullWidth: false,
  },
  routingSessionAffinityTTL: {
    labelKey: 'config_management.visual.sections.network.session_affinity_ttl',
    yamlKey: 'routing.session-affinity-ttl',
    fullWidth: false,
  },
  forceModelPrefix: {
    labelKey: 'config_management.visual.sections.network.force_model_prefix',
    yamlKey: 'force-model-prefix',
    fullWidth: false,
  },
  passthroughHeaders: {
    labelKey: 'config_management.visual.sections.network.passthrough_headers',
    yamlKey: 'passthrough-headers',
    fullWidth: false,
  },
  disableCooling: {
    labelKey: 'config_management.visual.sections.network.disable_cooling',
    yamlKey: 'disable-cooling',
    fullWidth: false,
  },
  routingSessionAffinity: {
    labelKey: 'config_management.visual.sections.network.session_affinity',
    yamlKey: 'routing.session-affinity',
    fullWidth: false,
  },
  wsAuth: {
    labelKey: 'config_management.visual.sections.network.ws_auth',
    yamlKey: 'ws-auth',
    fullWidth: false,
  },
  enableGeminiCliEndpoint: {
    labelKey: 'config_management.visual.sections.network.enable_gemini_cli_endpoint',
    yamlKey: 'enable-gemini-cli-endpoint',
    fullWidth: false,
  },
  quotaSwitchProject: {
    labelKey: 'config_management.visual.sections.quota.switch_project',
    yamlKey: 'quota-exceeded.switch-project',
    fullWidth: false,
  },
  quotaSwitchPreviewModel: {
    labelKey: 'config_management.visual.sections.quota.switch_preview_model',
    yamlKey: 'quota-exceeded.switch-preview-model',
    fullWidth: false,
  },
  quotaAntigravityCredits: {
    labelKey: 'config_management.visual.sections.quota.antigravity_credits',
    yamlKey: 'quota-exceeded.antigravity-credits',
    fullWidth: false,
  },
  'streaming.keepaliveSeconds': {
    labelKey: 'config_management.visual.sections.streaming.keepalive_seconds',
    yamlKey: 'streaming.keepalive-seconds',
    fullWidth: false,
  },
  'streaming.bootstrapRetries': {
    labelKey: 'config_management.visual.sections.streaming.bootstrap_retries',
    yamlKey: 'streaming.bootstrap-retries',
    fullWidth: false,
  },
  'streaming.nonstreamKeepaliveInterval': {
    labelKey: 'config_management.visual.sections.streaming.nonstream_keepalive',
    yamlKey: 'nonstream-keepalive-interval',
    fullWidth: false,
  },
  payloadDefaultRules: {
    labelKey: 'config_management.visual.sections.payload.default_rules',
    yamlKey: 'payload.default',
    fullWidth: true,
    heading: true,
  },
  payloadDefaultRawRules: {
    labelKey: 'config_management.visual.sections.payload.default_raw_rules',
    yamlKey: 'payload.default-raw',
    fullWidth: true,
    heading: true,
    advanced: true,
  },
  payloadOverrideRules: {
    labelKey: 'config_management.visual.sections.payload.override_rules',
    yamlKey: 'payload.override',
    fullWidth: true,
    heading: true,
  },
  payloadOverrideRawRules: {
    labelKey: 'config_management.visual.sections.payload.override_raw_rules',
    yamlKey: 'payload.override-raw',
    fullWidth: true,
    heading: true,
    advanced: true,
  },
  payloadFilterRules: {
    labelKey: 'config_management.visual.sections.payload.filter_rules',
    yamlKey: 'payload.filter',
    fullWidth: true,
    heading: true,
  },
  flowControlEnabled: {
    labelKey: 'flow_control.enabled',
    yamlKey: 'flow-control.enabled',
    fullWidth: true,
  },
  flowControlRulesText: {
    labelKey: 'flow_control.edit_policy',
    yamlKey: 'flow-control.rules',
    fullWidth: true,
  },
  flowControlMaxWaiting: {
    labelKey: 'flow_control.max_waiting',
    yamlKey: 'flow-control.queue.max-waiting',
    fullWidth: true,
  },
  flowControlMaxWaitingPerKey: {
    labelKey: 'flow_control.max_waiting_key',
    yamlKey: 'flow-control.queue.max-waiting-per-key',
    fullWidth: true,
  },
  flowControlMaxWaitMs: {
    labelKey: 'flow_control.wait_ms',
    yamlKey: 'flow-control.queue.max-wait-ms',
    fullWidth: true,
  },
  flowControlMaxBytes: {
    labelKey: 'flow_control.queue_bytes',
    yamlKey: 'flow-control.queue.max-bytes',
    fullWidth: true,
  },
  flowControlMaxBuckets: {
    labelKey: 'flow_control.max_buckets',
    yamlKey: 'flow-control.max-buckets',
    fullWidth: true,
  },
  flowControlMaxHistory: {
    labelKey: 'flow_control.max_history',
    yamlKey: 'flow-control.max-history',
    fullWidth: true,
  },
  flowControlRealtime: {
    labelKey: 'flow_control.v3_realtime',
    yamlKey: 'flow-control.observation.realtime',
    fullWidth: true,
  },
  flowControlResources: {
    labelKey: 'flow_control.v3_resources',
    yamlKey: 'flow-control.observation.resources',
    fullWidth: true,
  },
  flowControlIntervalMs: {
    labelKey: 'flow_control.v3_interval',
    yamlKey: 'flow-control.observation.interval-ms',
    fullWidth: true,
  },
  flowControlMaxObservers: {
    labelKey: 'flow_control.v3_observers',
    yamlKey: 'flow-control.observation.max-observers',
    fullWidth: true,
  },
} satisfies Record<ConfigFieldId, ConfigFieldMeta>;
export type ConfigPage = { id: string; fields: readonly ConfigFieldId[] };
export type ConfigDomain = {
  id: string;
  group: 'foundation' | 'requests' | 'features';
  pages: readonly ConfigPage[];
};
export const CONFIG_DOMAINS = [
  {
    id: 'service',
    group: 'foundation',
    pages: [
      {
        id: 'listener',
        fields: ['host', 'port', 'tlsEnable', 'tlsCert', 'tlsKey'],
      },
      {
        id: 'management',
        fields: [
          'rmAllowRemote',
          'rmSecretKey',
          'rmDisableControlPanel',
          'rmDisableAutoUpdatePanel',
          'rmPanelRepo',
        ],
      },
      {
        id: 'credentials',
        fields: ['apiKeysText', 'authDir', 'wsAuth', 'authAutoRefreshWorkers'],
      },
    ],
  },
  {
    id: 'operations',
    group: 'foundation',
    pages: [
      {
        id: 'runtime',
        fields: ['debug', 'commercialMode'],
      },
      {
        id: 'logging',
        fields: ['loggingToFile', 'logsMaxTotalSizeMb', 'errorLogsMaxFiles'],
      },
      {
        id: 'usage',
        fields: ['usageStatisticsEnabled', 'redisUsageQueueRetentionSeconds'],
      },
    ],
  },
  {
    id: 'routing',
    group: 'requests',
    pages: [
      {
        id: 'connection',
        fields: ['proxyUrl', 'passthroughHeaders'],
      },
      {
        id: 'selection',
        fields: [
          'routingStrategy',
          'forceModelPrefix',
          'routingSessionAffinity',
          'routingSessionAffinityTTL',
        ],
      },
      {
        id: 'retries',
        fields: [
          'requestRetry',
          'maxRetryCredentials',
          'maxRetryInterval',
          'transientErrorCooldownSeconds',
          'disableCooling',
        ],
      },
      {
        id: 'fallback',
        fields: ['quotaSwitchProject', 'quotaSwitchPreviewModel'],
      },
      {
        id: 'streaming',
        fields: [
          'streaming.keepaliveSeconds',
          'streaming.bootstrapRetries',
          'streaming.nonstreamKeepaliveInterval',
        ],
      },
    ],
  },
  {
    id: 'flow-control',
    group: 'requests',
    pages: [
      {
        id: 'rules',
        fields: ['flowControlEnabled', 'flowControlRulesText'],
      },
      {
        id: 'queue',
        fields: [
          'flowControlMaxWaiting',
          'flowControlMaxWaitingPerKey',
          'flowControlMaxWaitMs',
          'flowControlMaxBytes',
          'flowControlMaxBuckets',
          'flowControlMaxHistory',
        ],
      },
      {
        id: 'monitoring',
        fields: [
          'flowControlRealtime',
          'flowControlResources',
          'flowControlIntervalMs',
          'flowControlMaxObservers',
        ],
      },
    ],
  },
  {
    id: 'headers',
    group: 'features',
    pages: [
      {
        id: 'claude',
        fields: [
          'claudeHeaderUserAgent',
          'claudeHeaderPackageVersion',
          'claudeHeaderRuntimeVersion',
          'claudeHeaderOs',
          'claudeHeaderArch',
          'claudeHeaderTimeout',
          'claudeHeaderStabilizeDeviceProfile',
        ],
      },
      {
        id: 'codex',
        fields: ['codexHeaderUserAgent', 'codexHeaderBetaFeatures', 'codexIdentityConfuse'],
      },
    ],
  },
  {
    id: 'codex-policy',
    group: 'features',
    pages: [
      {
        id: 'scope',
        fields: [
          'codexAbnormalReasoningRetryAction',
          'codexAbnormalReasoningRetryModelContains',
          'codexAbnormalReasoningRetryReasoningEfforts',
          'codexAbnormalReasoningRetryReasoningTokens',
          'codexAbnormalReasoningRetryAuthKinds',
          'codexAbnormalReasoningRetryAuthIds',
        ],
      },
      {
        id: 'retry',
        fields: [
          'codexAbnormalReasoningRetryMaxRetries',
          'codexAbnormalReasoningRetryStreamBuffer',
          'codexAbnormalReasoningRetryStreamBufferMaxBytes',
        ],
      },
      {
        id: 'hedging',
        fields: [
          'codexAbnormalReasoningRetryHedgedRetryEnabled',
          'codexAbnormalReasoningRetryHedgedRetryMode',
          'codexAbnormalReasoningRetryHedgeDelayMs',
          'codexAbnormalReasoningRetryRequireDistinctAuth',
        ],
      },
      {
        id: 'delivery',
        fields: [
          'codexAbnormalReasoningRetryDeliveryPolicy',
          'codexAbnormalReasoningRetryExhaustedBehavior',
          'codexAbnormalReasoningRetryFallbackPolicy',
          'codexAbnormalReasoningRetryClientUsageAggregation',
        ],
      },
    ],
  },
  {
    id: 'compatibility',
    group: 'features',
    pages: [
      {
        id: 'antigravity',
        fields: [
          'antigravitySignatureCacheEnabled',
          'antigravitySignatureBypassStrict',
          'antigravitySensitiveWords',
          'quotaAntigravityCredits',
        ],
      },
      {
        id: 'gemini',
        fields: ['enableGeminiCliEndpoint'],
      },
      {
        id: 'images',
        fields: ['disableImageGeneration', 'gptImage2BaseModel'],
      },
    ],
  },
  {
    id: 'payload',
    group: 'requests',
    pages: [
      {
        id: 'defaults',
        fields: ['payloadDefaultRules', 'payloadDefaultRawRules'],
      },
      {
        id: 'overrides',
        fields: ['payloadOverrideRules', 'payloadOverrideRawRules'],
      },
      {
        id: 'filters',
        fields: ['payloadFilterRules'],
      },
    ],
  },
  {
    id: 'plugins',
    group: 'features',
    pages: [
      {
        id: 'runtime',
        fields: ['pluginsEnabled'],
      },
      {
        id: 'sources',
        fields: ['pluginStoreSources'],
      },
      {
        id: 'auth',
        fields: ['pluginStoreAuth'],
      },
    ],
  },
] as const satisfies readonly ConfigDomain[];
export type ConfigDomainId = (typeof CONFIG_DOMAINS)[number]['id'];
export type ConfigLocation = {
  section: ConfigDomainId;
  subsection: string;
  field?: ConfigFieldId;
  migrated?: boolean;
};
export const DEFAULT_CONFIG_LOCATION: ConfigLocation = {
  section: 'operations',
  subsection: 'runtime',
};
export const domainLabelKey = (id: string) => `config_management.editor.domains.${id}`;
export const pageLabelKey = (section: string, page: string) =>
  `config_management.editor.pages.${section}_${page}`;
export const fieldTargetId = (id: ConfigFieldId) => `config-field-${id}`;

export function locateConfigField(field: string): ConfigLocation | undefined {
  for (const domain of CONFIG_DOMAINS)
    for (const page of domain.pages) {
      if ((page.fields as readonly string[]).includes(field))
        return { section: domain.id, subsection: page.id, field: field as ConfigFieldId };
    }
}
const LEGACY_LOCATIONS: Record<string, [ConfigDomainId, string]> = {
  server: ['service', 'listener'],
  'server/server-listener': ['service', 'listener'],
  'server/server-tls': ['service', 'listener'],
  auth: ['service', 'management'],
  'auth/auth-remote': ['service', 'management'],
  'auth/auth-credentials': ['service', 'credentials'],
  system: ['operations', 'runtime'],
  'system/runtime': ['operations', 'runtime'],
  'system/plugins': ['plugins', 'runtime'],
  'system/headers': ['headers', 'claude'],
  'system/network': ['routing', 'connection'],
  quota: ['routing', 'fallback'],
  streaming: ['routing', 'streaming'],
  'payload/payload-defaults': ['payload', 'defaults'],
  'payload/payload-overrides': ['payload', 'overrides'],
  'payload/payload-filters': ['payload', 'filters'],
};
export function resolveConfigLocation(
  section?: string | null,
  subsection?: string | null,
  field?: string | null
): ConfigLocation {
  const legacy = LEGACY_LOCATIONS[`${section}/${subsection}`] ?? LEGACY_LOCATIONS[section ?? ''];
  let location: ConfigLocation;
  if (legacy) location = { section: legacy[0], subsection: legacy[1], migrated: true };
  else {
    const domain = CONFIG_DOMAINS.find((d) => d.id === section);
    location = domain
      ? {
          section: domain.id,
          subsection: domain.pages.find((p) => p.id === subsection)?.id ?? domain.pages[0].id,
        }
      : { ...DEFAULT_CONFIG_LOCATION };
  }
  const target = field ? locateConfigField(field) : undefined;
  return target ? { ...target, migrated: location.migrated } : location;
}
export function isConfigNavigationChange(
  current: { pathname: string; search: string; hash: string },
  next: { pathname: string; search: string; hash: string }
) {
  if (
    current.pathname !== next.pathname ||
    current.pathname !== '/config' ||
    current.hash !== next.hash
  )
    return false;
  const strip = (search: string) => {
    const params = new URLSearchParams(search);
    ['section', 'subsection', 'field'].forEach((key) => params.delete(key));
    params.sort();
    return params.toString();
  };
  return strip(current.search) === strip(next.search);
}
export type ConfigSearchResult = {
  field: ConfigFieldId;
  location: ConfigLocation;
  label: string;
  yamlKey: string;
  score: number;
};
export function searchConfigFields(query: string, t: TFunction): ConfigSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const words = needle.split(/\s+/);
  return (Object.entries(CONFIG_FIELDS) as [ConfigFieldId, ConfigFieldMeta][])
    .flatMap(([field, meta]) => {
      const label = String(t(meta.labelKey));
      const labels = [
        label,
        String(t(meta.labelKey, { lng: 'en' })),
        String(t(meta.labelKey, { lng: 'zh-CN' })),
      ].map((s) => s.toLocaleLowerCase());
      const keys = meta.yamlKey.toLowerCase();
      const haystack = [
        keys,
        ...labels,
        ...(meta.aliases ?? []).map((s) => s.toLocaleLowerCase()),
      ].join(' ');
      if (!words.every((word) => haystack.includes(word))) return [];
      const location = locateConfigField(field)!;
      return [
        {
          field,
          location,
          label,
          yamlKey: meta.yamlKey,
          score: keys === needle ? 0 : labels.includes(needle) ? 1 : keys.includes(needle) ? 2 : 3,
        },
      ];
    })
    .sort((a, b) => a.score - b.score);
}
