export type PayloadParamValueType = 'string' | 'number' | 'boolean' | 'json';
export type DisableImageGenerationMode = 'false' | 'true' | 'chat' | 'passthrough';
export type PluginStoreAuthType = 'none' | 'bearer' | 'basic' | 'header' | 'github-token';
export type PluginStoreAuthApplyTo = 'registry' | 'metadata' | 'artifact';
export type CodexAbnormalReasoningRetryAction = 'retry' | 'observe-only' | 'disabled';
export type CodexAbnormalReasoningRetryExhaustedBehavior = 'error' | 'pass-through';
export type CodexAbnormalReasoningRetryClientUsageAggregation =
  | 'delivered-only'
  | 'sum'
  | 'sum-with-delivered-total';
export type CodexAbnormalReasoningRetryDeliveryPolicy =
  | 'best-non-special'
  | 'first-non-special'
  | 'max-output'
  | 'latest';
export type CodexAbnormalReasoningRetryFallbackPolicy =
  | 'best-special'
  | 'max-output-special'
  | 'latest-special';
export type CodexAbnormalReasoningRetryHedgedRetryMode = 'speed' | 'quality';
export type PayloadParamValidationErrorCode =
  | 'payload_invalid_number'
  | 'payload_invalid_boolean'
  | 'payload_invalid_json';

export type VisualConfigFieldPath =
  | 'port'
  | 'errorLogsMaxFiles'
  | 'logsMaxTotalSizeMb'
  | 'redisUsageQueueRetentionSeconds'
  | 'requestRetry'
  | 'maxRetryCredentials'
  | 'maxRetryInterval'
  | 'transientErrorCooldownSeconds'
  | 'authAutoRefreshWorkers'
  | 'codexAbnormalReasoningRetryStreamBufferMaxBytes'
  | 'codexAbnormalReasoningRetryMaxRetries'
  | 'codexAbnormalReasoningRetryHedgeDelayMs'
  | 'codexAbnormalReasoningRetryReasoningTokens'
  | 'streaming.keepaliveSeconds'
  | 'streaming.bootstrapRetries'
  | 'streaming.nonstreamKeepaliveInterval';

export type VisualConfigValidationErrorCode =
  | 'port_range'
  | 'non_negative_integer'
  | 'integer'
  | 'integer_range_1_3600';

export type VisualConfigValidationErrors = Partial<
  Record<VisualConfigFieldPath, VisualConfigValidationErrorCode>
>;

export type PayloadParamEntry = {
  id: string;
  path: string;
  valueType: PayloadParamValueType;
  value: string;
};

export type PayloadHeaderEntry = {
  id: string;
  name: string;
  value: string;
};

export type PayloadModelEntry = {
  id: string;
  name: string;
  protocol?: string;
  scope?: string;
  fromProtocol?: string;
  headers?: PayloadHeaderEntry[];
  match?: PayloadParamEntry[];
  notMatch?: PayloadParamEntry[];
  exist?: string[];
  notExist?: string[];
};

export type PayloadRule = {
  id: string;
  models: PayloadModelEntry[];
  params: PayloadParamEntry[];
};

export type PayloadFilterRule = {
  id: string;
  models: PayloadModelEntry[];
  params: string[];
};

export interface StreamingConfig {
  keepaliveSeconds: string;
  bootstrapRetries: string;
  nonstreamKeepaliveInterval: string;
}

export type PluginStoreAuthRule = {
  id: string;
  match: string;
  applyTo: PluginStoreAuthApplyTo[];
  type: PluginStoreAuthType;
  tokenEnv: string;
  usernameEnv: string;
  passwordEnv: string;
  headerName: string;
  headerValueEnv: string;
  allowInsecure: boolean;
};

export type VisualConfigValues = {
  host: string;
  port: string;
  tlsEnable: boolean;
  tlsCert: string;
  tlsKey: string;
  rmAllowRemote: boolean;
  rmSecretKey: string;
  rmDisableControlPanel: boolean;
  rmDisableAutoUpdatePanel: boolean;
  rmPanelRepo: string;
  authDir: string;
  apiKeysText: string;
  pluginsEnabled: boolean;
  pluginStoreSources: string[];
  pluginStoreAuth: PluginStoreAuthRule[];
  debug: boolean;
  commercialMode: boolean;
  loggingToFile: boolean;
  logsMaxTotalSizeMb: string;
  errorLogsMaxFiles: string;
  usageStatisticsEnabled: boolean;
  redisUsageQueueRetentionSeconds: string;
  proxyUrl: string;
  forceModelPrefix: boolean;
  passthroughHeaders: boolean;
  requestRetry: string;
  maxRetryCredentials: string;
  maxRetryInterval: string;
  transientErrorCooldownSeconds: string;
  disableCooling: boolean;
  disableImageGeneration: DisableImageGenerationMode;
  gptImage2BaseModel: string;
  authAutoRefreshWorkers: string;
  quotaSwitchProject: boolean;
  quotaSwitchPreviewModel: boolean;
  quotaAntigravityCredits: boolean;
  routingStrategy: 'round-robin' | 'fill-first';
  routingSessionAffinity: boolean;
  routingSessionAffinityTTL: string;
  wsAuth: boolean;
  enableGeminiCliEndpoint: boolean;
  antigravitySignatureCacheEnabled: boolean;
  antigravitySignatureBypassStrict: boolean;
  claudeHeaderUserAgent: string;
  claudeHeaderPackageVersion: string;
  claudeHeaderRuntimeVersion: string;
  claudeHeaderOs: string;
  claudeHeaderArch: string;
  claudeHeaderTimeout: string;
  claudeHeaderStabilizeDeviceProfile: boolean;
  codexHeaderUserAgent: string;
  codexHeaderBetaFeatures: string;
  codexIdentityConfuse: boolean;
  codexAbnormalReasoningRetryAction: CodexAbnormalReasoningRetryAction;
  codexAbnormalReasoningRetryEnabled: boolean;
  codexAbnormalReasoningRetryModelContains: string[];
  codexAbnormalReasoningRetryReasoningEfforts: string[];
  codexAbnormalReasoningRetryReasoningTokens: string[];
  codexAbnormalReasoningRetryAuthKinds: string[];
  codexAbnormalReasoningRetryAuthIds: string[];
  codexAbnormalReasoningRetryStreamBuffer: boolean;
  codexAbnormalReasoningRetryStreamBufferMaxBytes: string;
  codexAbnormalReasoningRetryMaxRetries: string;
  codexAbnormalReasoningRetryExhaustedBehavior: CodexAbnormalReasoningRetryExhaustedBehavior;
  codexAbnormalReasoningRetryClientUsageAggregation: CodexAbnormalReasoningRetryClientUsageAggregation;
  codexAbnormalReasoningRetryDeliveryPolicy: CodexAbnormalReasoningRetryDeliveryPolicy;
  codexAbnormalReasoningRetryFallbackPolicy: CodexAbnormalReasoningRetryFallbackPolicy;
  codexAbnormalReasoningRetryHedgedRetryEnabled: boolean;
  codexAbnormalReasoningRetryHedgedRetryMode: CodexAbnormalReasoningRetryHedgedRetryMode;
  codexAbnormalReasoningRetryHedgeDelayMs: string;
  codexAbnormalReasoningRetryRequireDistinctAuth: boolean;
  payloadDefaultRules: PayloadRule[];
  payloadDefaultRawRules: PayloadRule[];
  payloadOverrideRules: PayloadRule[];
  payloadOverrideRawRules: PayloadRule[];
  payloadFilterRules: PayloadFilterRule[];
  streaming: StreamingConfig;
};

export const makeClientId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const DEFAULT_VISUAL_VALUES: VisualConfigValues = {
  host: '',
  port: '',
  tlsEnable: false,
  tlsCert: '',
  tlsKey: '',
  rmAllowRemote: false,
  rmSecretKey: '',
  rmDisableControlPanel: false,
  rmDisableAutoUpdatePanel: false,
  rmPanelRepo: '',
  authDir: '',
  apiKeysText: '',
  pluginsEnabled: false,
  pluginStoreSources: [],
  pluginStoreAuth: [],
  debug: false,
  commercialMode: false,
  loggingToFile: false,
  logsMaxTotalSizeMb: '',
  errorLogsMaxFiles: '',
  usageStatisticsEnabled: false,
  redisUsageQueueRetentionSeconds: '',
  proxyUrl: '',
  forceModelPrefix: false,
  passthroughHeaders: false,
  requestRetry: '',
  maxRetryCredentials: '',
  maxRetryInterval: '',
  transientErrorCooldownSeconds: '',
  disableCooling: false,
  disableImageGeneration: 'false',
  gptImage2BaseModel: '',
  authAutoRefreshWorkers: '',
  quotaSwitchProject: true,
  quotaSwitchPreviewModel: true,
  quotaAntigravityCredits: false,
  routingStrategy: 'round-robin',
  routingSessionAffinity: false,
  routingSessionAffinityTTL: '',
  wsAuth: false,
  enableGeminiCliEndpoint: false,
  antigravitySignatureCacheEnabled: true,
  antigravitySignatureBypassStrict: false,
  claudeHeaderUserAgent: '',
  claudeHeaderPackageVersion: '',
  claudeHeaderRuntimeVersion: '',
  claudeHeaderOs: '',
  claudeHeaderArch: '',
  claudeHeaderTimeout: '',
  claudeHeaderStabilizeDeviceProfile: false,
  codexHeaderUserAgent: '',
  codexHeaderBetaFeatures: '',
  codexIdentityConfuse: false,
  codexAbnormalReasoningRetryAction: 'disabled',
  codexAbnormalReasoningRetryEnabled: false,
  codexAbnormalReasoningRetryModelContains: ['gpt-5.5'],
  codexAbnormalReasoningRetryReasoningEfforts: [],
  codexAbnormalReasoningRetryReasoningTokens: ['516', '1034'],
  codexAbnormalReasoningRetryAuthKinds: ['oauth'],
  codexAbnormalReasoningRetryAuthIds: [],
  codexAbnormalReasoningRetryStreamBuffer: true,
  codexAbnormalReasoningRetryStreamBufferMaxBytes: '16777216',
  codexAbnormalReasoningRetryMaxRetries: '2',
  codexAbnormalReasoningRetryExhaustedBehavior: 'error',
  codexAbnormalReasoningRetryClientUsageAggregation: 'delivered-only',
  codexAbnormalReasoningRetryDeliveryPolicy: 'best-non-special',
  codexAbnormalReasoningRetryFallbackPolicy: 'best-special',
  codexAbnormalReasoningRetryHedgedRetryEnabled: false,
  codexAbnormalReasoningRetryHedgedRetryMode: 'quality',
  codexAbnormalReasoningRetryHedgeDelayMs: '1000',
  codexAbnormalReasoningRetryRequireDistinctAuth: true,
  payloadDefaultRules: [],
  payloadDefaultRawRules: [],
  payloadOverrideRules: [],
  payloadOverrideRawRules: [],
  payloadFilterRules: [],
  streaming: {
    keepaliveSeconds: '',
    bootstrapRetries: '',
    nonstreamKeepaliveInterval: '',
  },
};
