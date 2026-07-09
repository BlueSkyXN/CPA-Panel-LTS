#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

failures=0

fail() {
  printf 'LTS panel contract violation: %s\n' "$1" >&2
  failures=$((failures + 1))
}

require_path() {
  local path="$1"
  if [ ! -e "$path" ]; then
    fail "missing path: $path"
  fi
}

require_file_contains() {
  local file="$1"
  local pattern="$2"
  if [ ! -f "$file" ]; then
    fail "missing file: $file"
    return
  fi
  if ! grep -Fq -- "$pattern" "$file"; then
    fail "missing marker '$pattern' in $file"
  fi
}

require_file_not_contains() {
  local file="$1"
  local pattern="$2"
  if [ ! -f "$file" ]; then
    fail "missing file: $file"
    return
  fi
  if grep -Fq -- "$pattern" "$file"; then
    fail "unexpected marker '$pattern' in $file"
  fi
}

require_repo_contains() {
  local pattern="$1"
  if ! grep -R -F -q --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=local -- "$pattern" .; then
    fail "missing repository marker: $pattern"
  fi
}

for path in \
  src/router/MainRoutes.tsx \
  src/pages/DashboardPage.tsx \
  src/pages/DashboardPage.module.scss \
  src/pages/UsagePage.tsx \
  src/pages/UsagePage.module.scss \
  src/components/usage \
  src/components/usage/AGENTS.md \
  src/components/providers \
  src/components/providers/AmpcodeSection \
  src/components/providers/ProviderStatusBar.tsx \
  src/components/providers/hooks/useProviderRecentRequests.ts \
  src/assets/icons/amp.svg \
  src/pages/AiProvidersPage.tsx \
  src/pages/AiProvidersAmpcodeEditPage.tsx \
  src/features/providers/ProvidersWorkbenchPage.tsx \
  src/features/providers/descriptors.ts \
  src/features/providers/sheets/forms/BaseProviderForm.tsx \
  src/features/providers/sheets/forms/useConnectivityTest.ts \
  src/features/providers/sheets/forms/useModelDiscovery.ts \
  src/features/plugins/PluginsPage.tsx \
  src/features/plugins/PluginStorePage.tsx \
  src/features/plugins/PluginResourcePage.tsx \
  src/features/plugins/pluginReleaseVersions.ts \
  src/features/plugins/pluginResources.ts \
  src/features/plugins/components/PluginInstallGateModal.tsx \
  src/features/plugins/components/PluginInstallGateModal.module.scss \
  src/pages/ConfigPage.tsx \
  src/pages/ConfigPage.module.scss \
  src/components/config \
  src/components/config/VisualConfigEditor.module.scss \
  src/pages/LogsPage.tsx \
  src/pages/LogsPage.module.scss \
  src/hooks/useVisualConfig.ts \
  src/hooks/useApiKeysForModels.ts \
  src/services/api/usage.ts \
  src/services/api/config.ts \
  src/services/api/configFile.ts \
  src/services/api/models.ts \
  src/services/api/ampcode.ts \
  src/services/api/apiKeyUsage.ts \
  src/services/api/plugins.ts \
  src/services/api/logs.ts \
  src/services/api/providers.ts \
  src/services/api/authFiles.ts \
  src/services/api/oauth.ts \
  src/services/api/apiCall.ts \
  src/lts/codexRemoteCloudConnect/api.ts \
  src/pages/AuthFilesPage.tsx \
  src/pages/OAuthPage.tsx \
  src/pages/QuotaPage.tsx \
  src/features/authFiles \
  src/features/authFiles/components/AuthFileQuotaSection.tsx \
  src/features/authFiles/constants.ts \
  src/components/quota \
  src/stores/useUsageStatsStore.ts \
  src/stores/useAuthStore.ts \
  src/stores/useConfigStore.ts \
  src/stores/useModelsStore.ts \
  src/stores/useQuotaStore.ts \
  src/types/usage.ts \
  src/types/ampcode.ts \
  src/types/plugin.ts \
  src/types/authFile.ts \
  src/types/quota.ts \
  src/types/visualConfig.ts \
  src/utils/usage.ts \
  src/utils/usageIndex.ts \
  src/utils/usage \
  src/utils/recentRequests.ts \
  src/utils/quota \
  src/utils/constants.ts \
  docs/lts/panel-feature-contracts.yaml \
  docs/lts/panel-protected-deltas.yaml \
  docs/lts/sync-runbook.md \
  scripts/check-panel-feature-contracts.mjs \
  scripts/smoke-lts-panel.py \
  scripts/smoke-lts-panel-core.py \
  src/i18n/locales/en.json \
  src/i18n/locales/zh-CN.json \
  src/i18n/locales/zh-TW.json \
  src/i18n/locales/ru.json \
  .github/workflows/release.yml \
  package-lock.json
do
  require_path "$path"
done

# Hard LTS contract.
require_file_contains src/router/MainRoutes.tsx "path: '/usage'"
require_file_contains src/router/MainRoutes.tsx "path: '/lts/usage'"
require_file_contains src/router/MainRoutes.tsx "path: '/lts/providers'"
require_file_contains src/router/MainRoutes.tsx "path: '/lts/ampcode'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/ampcode'"
require_file_contains src/router/MainRoutes.tsx "UsagePage"
require_file_contains src/router/MainRoutes.tsx "AiProvidersAmpcodeEditPage"
require_file_contains src/components/layout/MainLayout.tsx "path: '/usage'"
require_file_contains src/services/api/usage.ts "'/usage'"
require_file_contains src/services/api/usage.ts "'/usage/export'"
require_file_contains src/services/api/usage.ts "'/usage/import'"
require_file_contains src/stores/useUsageStatsStore.ts "usageApi.getUsage"
require_file_contains src/services/api/config.ts "'/usage-statistics-enabled'"
require_file_contains src/utils/constants.ts "USAGE: '/usage'"
require_file_contains src/services/api/ampcode.ts "'/ampcode'"
require_file_contains src/services/api/ampcode.ts "'/ampcode/upstream-api-keys'"
require_file_contains src/services/api/ampcode.ts "'/ampcode/model-mappings'"
require_file_contains src/services/api/ampcode.ts "'/ampcode/force-model-mappings'"
require_file_contains src/services/api/index.ts "export * from './usage'"
require_file_contains src/services/api/index.ts "export * from './ampcode'"
require_file_contains .github/workflows/release.yml "management.html"
require_file_contains .github/workflows/release.yml "v*-tls-*"
require_file_contains docs/lts/panel-protected-deltas.yaml "full-usage-statistics-ui"
require_file_contains docs/lts/panel-protected-deltas.yaml "cpa-core-lts-management-api-compatibility"
require_file_contains docs/lts/panel-protected-deltas.yaml "panel-release-contract"
require_file_contains docs/lts/sync-runbook.md "protected selective-port"

# Accepted upstream feature regression checks.
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/workbench'"
require_file_contains src/router/MainRoutes.tsx "ProvidersWorkbenchPage"
require_file_contains src/router/MainRoutes.tsx "path: '/plugins'"
require_file_contains src/router/MainRoutes.tsx "path: '/plugin-store'"
require_file_contains src/router/MainRoutes.tsx "path: '/plugin-pages/:pluginId/:menuIndex'"
require_file_contains src/components/layout/MainLayout.tsx "path: '/plugins'"
require_file_contains src/components/layout/MainLayout.tsx "path: '/plugin-store'"
require_file_contains src/utils/constants.ts "x-cpa-support-plugin"
require_file_contains src/stores/useAuthStore.ts "server-plugin-support-update"
require_file_contains src/stores/useAuthStore.ts "pluginSupportKnown"
require_file_contains src/stores/useAuthStore.ts "probePluginSupport"
require_file_contains src/stores/useAuthStore.ts "currentRuntimeKind"
require_file_contains src/services/api/index.ts "export * from './apiKeyUsage'"
require_file_contains src/services/api/index.ts "export * from './plugins'"
require_file_contains src/services/api/apiKeyUsage.ts "'/api-key-usage'"
require_file_contains src/services/api/plugins.ts "'/plugins'"
require_file_contains src/services/api/plugins.ts "'/plugin-store'"
require_file_contains src/services/api/plugins.ts "source_errors"
require_file_contains src/services/api/plugins.ts "auth_required"
require_file_contains src/services/api/plugins.ts "PluginStoreInstallOptions"
require_file_contains src/services/api/plugins.ts "params.set('version'"
require_file_contains src/features/plugins/pluginResources.ts "DEFAULT_PLUGIN_STORE_SOURCE_ID"
require_file_contains src/features/plugins/pluginResources.ts "isDefaultPluginStoreSource"
require_file_contains src/features/plugins/pluginReleaseVersions.ts "fetchPluginReleaseVersions"
require_file_contains src/features/plugins/pluginReleaseVersions.ts "https://api.github.com"
require_file_contains src/features/plugins/PluginStorePage.tsx "PluginInstallOptionsModal"
require_file_contains src/features/plugins/PluginStorePage.tsx "install_version_release_mode"
require_file_contains src/features/plugins/PluginStorePage.tsx "source_errors_title"
require_file_contains src/features/plugins/PluginStorePage.tsx "auth_required"
require_file_contains src/i18n/locales/en.json "plugin_store_auth"
require_file_contains src/i18n/locales/zh-CN.json "plugin_store_auth"
require_file_contains src/i18n/locales/zh-TW.json "plugin_store_auth"
require_file_contains src/i18n/locales/ru.json "plugin_store_auth"
require_file_contains src/i18n/locales/en.json "install_version_release_mode"
require_file_contains src/i18n/locales/zh-CN.json "install_version_release_mode"
require_file_contains src/i18n/locales/zh-TW.json "install_version_release_mode"
require_file_contains src/i18n/locales/ru.json "install_version_release_mode"
require_file_contains scripts/smoke-lts-panel.py "store-auth"
require_file_contains scripts/smoke-lts-panel.py "CLIPROXY_PLUGIN_STORE_TOKEN"
require_file_contains scripts/smoke-lts-panel.py "Some plugin sources failed to load"
require_file_contains src/features/plugins/components/PluginInstallGateModal.tsx "getPluginConfirmToken"
require_file_contains src/features/plugins/components/PluginInstallGateModal.tsx "buildRepositoryURL"
require_file_contains src/features/plugins/components/PluginInstallGateModal.tsx "gate_effect_runs_code"

# Shared config/logs/auth/quota regression checks.
require_file_contains src/router/MainRoutes.tsx "path: '/config'"
require_file_contains src/services/api/config.ts "'/config'"
require_file_contains src/services/api/configFile.ts "'/config.yaml'"
require_file_contains src/services/api/models.ts "/v1/models"
require_file_contains src/components/config/VisualConfigEditor.tsx "plugin_store_sources"
require_file_contains src/components/config/VisualConfigEditor.tsx "plugin_store_auth"
require_file_contains src/components/config/VisualConfigEditorBlocks.tsx "PluginStoreAuthEditor"
require_file_contains src/hooks/useVisualConfig.ts "store-sources"
require_file_contains src/hooks/useVisualConfig.ts "store-auth"
require_file_contains src/hooks/useVisualConfig.ts "parsePluginStoreAuthRules"
require_file_contains src/hooks/useVisualConfig.ts "serializePluginStoreAuthForYaml"
require_file_contains src/hooks/useVisualConfig.ts "parsePluginStoreSources"
require_file_contains src/hooks/useVisualConfig.ts "dirtyFields.has('pluginStoreSources')"
require_file_contains src/hooks/useVisualConfig.ts "dirtyFields.has('pluginStoreAuth')"
require_file_contains src/types/visualConfig.ts "pluginStoreSources"
require_file_contains src/types/visualConfig.ts "pluginStoreAuth"
require_file_contains src/types/visualConfig.ts "PluginStoreAuthRule"
require_file_contains src/pages/ConfigPage.tsx "visualBaseYaml"
require_file_contains src/pages/ConfigPage.tsx "normalizeYamlForVisualDiff"
require_file_contains src/pages/ConfigPage.tsx "applyVisualChangesToYaml"
require_file_contains src/hooks/useVisualConfig.ts "shouldWriteManagedField"
require_file_contains src/hooks/useVisualConfig.ts "hasPayloadDirtyFields"
require_file_contains src/types/visualConfig.ts "transientErrorCooldownSeconds"
require_file_contains src/hooks/useVisualConfig.ts "transient-error-cooldown-seconds"
require_file_contains src/components/config/VisualConfigEditor.tsx "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/en.json "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/zh-CN.json "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/zh-TW.json "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/ru.json "transient_error_cooldown_seconds"
require_file_contains scripts/smoke-lts-panel.py "transient-error-cooldown-seconds: -1"
require_file_contains scripts/smoke-lts-panel-core.py "transient-error-cooldown-seconds: 0"
require_file_contains docs/lts/panel-feature-contracts.yaml "transientErrorCooldownSeconds"
require_file_contains docs/lts/panel-feature-contracts.yaml "transient-error-cooldown-seconds"
require_file_contains src/components/config/VisualConfigEditorBlocks.tsx "payloadRuleRawParamRow"
require_file_contains src/components/config/VisualConfigEditorBlocks.tsx "payloadJsonInput"
require_file_contains src/components/config/VisualConfigEditor.module.scss ".payloadRuleRawParamRow"
require_file_contains src/components/config/VisualConfigEditor.module.scss ".payloadJsonInput"
require_file_contains docs/lts/panel-feature-contracts.yaml "codex-abnormal-reasoning-retry-config"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryAction"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryEnabled"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryReasoningEfforts"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryStreamBuffer"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryStreamBufferMaxBytes"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryMaxRetries"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryExhaustedBehavior"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryClientUsageAggregation"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryDeliveryPolicy"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryFallbackPolicy"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryHedgedRetryEnabled"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryHedgedRetryMode"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryHedgeDelayMs"
require_file_contains src/types/visualConfig.ts "codexAbnormalReasoningRetryRequireDistinctAuth"
require_file_contains src/hooks/useVisualConfig.ts "abnormal-reasoning-retry"
require_file_contains src/hooks/useVisualConfig.ts "action"
require_file_contains src/hooks/useVisualConfig.ts "stream-buffer-max-bytes"
require_file_contains src/hooks/useVisualConfig.ts "reasoning-efforts"
require_file_contains src/hooks/useVisualConfig.ts "max-retries"
require_file_contains src/hooks/useVisualConfig.ts "exhausted-behavior"
require_file_contains src/hooks/useVisualConfig.ts "client-usage-aggregation"
require_file_contains src/hooks/useVisualConfig.ts "delivered-only"
require_file_contains src/hooks/useVisualConfig.ts "sum-with-delivered-total"
require_file_contains src/hooks/useVisualConfig.ts "delivery-policy"
require_file_contains src/hooks/useVisualConfig.ts "best-non-special"
require_file_contains src/hooks/useVisualConfig.ts "fallback-policy"
require_file_contains src/hooks/useVisualConfig.ts "best-special"
require_file_contains src/hooks/useVisualConfig.ts "hedged-retry"
require_file_contains src/hooks/useVisualConfig.ts "quality"
require_file_contains src/hooks/useVisualConfig.ts "hedge-delay-ms"
require_file_contains src/hooks/useVisualConfig.ts "require-distinct-auth"
require_file_contains src/hooks/useVisualConfig.ts "shouldWriteCodexAbnormalReasoningRetryBlock"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_title"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_action_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_reasoning_efforts_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_max_retries_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_exhausted_behavior_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_client_usage_aggregation_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_delivery_policy_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_delivery_policy_best_non_special"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_fallback_policy_label"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_fallback_policy_best_special"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_hedged_retry_enabled"
require_file_contains src/components/config/VisualConfigEditor.tsx "codex_abnormal_reasoning_retry_hedged_retry_mode_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_title"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_title"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_title"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_title"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_action_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_action_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_action_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_action_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_exhausted_behavior_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_exhausted_behavior_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_exhausted_behavior_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_exhausted_behavior_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_client_usage_aggregation_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_client_usage_aggregation_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_client_usage_aggregation_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_client_usage_aggregation_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_delivery_policy_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_delivery_policy_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_delivery_policy_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_delivery_policy_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_fallback_policy_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_fallback_policy_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_fallback_policy_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_fallback_policy_label"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_hedged_retry_enabled"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_hedged_retry_enabled"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_hedged_retry_enabled"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_hedged_retry_enabled"
require_file_contains src/i18n/locales/en.json "codex_abnormal_reasoning_retry_hedged_retry_mode_label"
require_file_contains src/i18n/locales/zh-CN.json "codex_abnormal_reasoning_retry_hedged_retry_mode_label"
require_file_contains src/i18n/locales/zh-TW.json "codex_abnormal_reasoning_retry_hedged_retry_mode_label"
require_file_contains src/i18n/locales/ru.json "codex_abnormal_reasoning_retry_hedged_retry_mode_label"
config_locale_files=(
  src/i18n/locales/en.json
  src/i18n/locales/zh-CN.json
  src/i18n/locales/zh-TW.json
  src/i18n/locales/ru.json
)
codex_abnormal_retry_code_markers=(
  "StrategyBadge"
  "StrategyGroup"
  "ABNORMAL_RETRY_ACTION_HINT_KEYS"
  "ABNORMAL_RETRY_EXHAUSTED_BEHAVIOR_HINT_KEYS"
  "ABNORMAL_RETRY_USAGE_AGGREGATION_HINT_KEYS"
  "ABNORMAL_RETRY_DELIVERY_POLICY_HINT_KEYS"
  "ABNORMAL_RETRY_FALLBACK_POLICY_HINT_KEYS"
  "ABNORMAL_RETRY_HEDGED_MODE_HINT_KEYS"
)
for marker in "${codex_abnormal_retry_code_markers[@]}"; do
  require_file_contains docs/lts/panel-feature-contracts.yaml "$marker"
  require_file_contains src/components/config/VisualConfigEditor.tsx "$marker"
done
codex_abnormal_retry_style_markers=(
  "strategySummary"
  "strategyBadgeGrid"
  "fieldSelectionHint"
)
for marker in "${codex_abnormal_retry_style_markers[@]}"; do
  require_file_contains docs/lts/panel-feature-contracts.yaml "$marker"
  require_file_contains src/components/config/VisualConfigEditor.tsx "$marker"
  require_file_contains src/components/config/VisualConfigEditor.module.scss ".$marker"
done
codex_abnormal_retry_visual_i18n_markers=(
  "codex_abnormal_reasoning_retry_desc"
  "codex_abnormal_reasoning_retry_summary_title"
  "codex_abnormal_reasoning_retry_summary_desc"
  "codex_abnormal_reasoning_retry_summary_action"
  "codex_abnormal_reasoning_retry_summary_stream_buffer"
  "codex_abnormal_reasoning_retry_summary_hedged"
  "codex_abnormal_reasoning_retry_summary_distinct_auth"
  "codex_abnormal_reasoning_retry_summary_on"
  "codex_abnormal_reasoning_retry_summary_off"
  "codex_abnormal_reasoning_retry_group_switches_title"
  "codex_abnormal_reasoning_retry_group_switches_desc"
  "codex_abnormal_reasoning_retry_group_retry_title"
  "codex_abnormal_reasoning_retry_group_retry_desc"
  "codex_abnormal_reasoning_retry_group_match_title"
  "codex_abnormal_reasoning_retry_group_match_desc"
  "codex_abnormal_reasoning_retry_group_delivery_title"
  "codex_abnormal_reasoning_retry_group_delivery_desc"
  "codex_abnormal_reasoning_retry_group_scope_title"
  "codex_abnormal_reasoning_retry_group_scope_desc"
  "codex_abnormal_reasoning_retry_action_retry"
  "codex_abnormal_reasoning_retry_action_observe_only"
  "codex_abnormal_reasoning_retry_action_disabled"
  "codex_abnormal_reasoning_retry_action_retry_desc"
  "codex_abnormal_reasoning_retry_action_observe_only_desc"
  "codex_abnormal_reasoning_retry_action_disabled_desc"
  "codex_abnormal_reasoning_retry_exhausted_behavior_error"
  "codex_abnormal_reasoning_retry_exhausted_behavior_pass_through"
  "codex_abnormal_reasoning_retry_exhausted_behavior_error_desc"
  "codex_abnormal_reasoning_retry_exhausted_behavior_pass_through_desc"
  "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only"
  "codex_abnormal_reasoning_retry_client_usage_aggregation_sum"
  "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total"
  "codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only_desc"
  "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_desc"
  "codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total_desc"
  "codex_abnormal_reasoning_retry_delivery_policy_best_non_special"
  "codex_abnormal_reasoning_retry_delivery_policy_first_non_special"
  "codex_abnormal_reasoning_retry_delivery_policy_max_output"
  "codex_abnormal_reasoning_retry_delivery_policy_latest"
  "codex_abnormal_reasoning_retry_delivery_policy_best_non_special_desc"
  "codex_abnormal_reasoning_retry_delivery_policy_first_non_special_desc"
  "codex_abnormal_reasoning_retry_delivery_policy_max_output_desc"
  "codex_abnormal_reasoning_retry_delivery_policy_latest_desc"
  "codex_abnormal_reasoning_retry_fallback_policy_best_special"
  "codex_abnormal_reasoning_retry_fallback_policy_max_output_special"
  "codex_abnormal_reasoning_retry_fallback_policy_latest_special"
  "codex_abnormal_reasoning_retry_fallback_policy_best_special_desc"
  "codex_abnormal_reasoning_retry_fallback_policy_max_output_special_desc"
  "codex_abnormal_reasoning_retry_fallback_policy_latest_special_desc"
  "codex_abnormal_reasoning_retry_hedged_retry_mode_quality"
  "codex_abnormal_reasoning_retry_hedged_retry_mode_speed"
  "codex_abnormal_reasoning_retry_hedged_retry_mode_quality_desc"
  "codex_abnormal_reasoning_retry_hedged_retry_mode_speed_desc"
)
for marker in "${codex_abnormal_retry_visual_i18n_markers[@]}"; do
  require_file_contains docs/lts/panel-feature-contracts.yaml "$marker"
  require_file_contains src/components/config/VisualConfigEditor.tsx "$marker"
  for locale_file in "${config_locale_files[@]}"; do
    require_file_contains "$locale_file" "$marker"
  done
done
require_file_contains scripts/smoke-lts-panel.py "client-usage-aggregation: sum-with-delivered-total"
require_file_contains scripts/smoke-lts-panel.py "action: retry"
require_file_contains scripts/smoke-lts-panel.py "delivery-policy: max-output"
require_file_contains scripts/smoke-lts-panel.py "fallback-policy: max-output-special"
require_file_contains scripts/smoke-lts-panel.py "mode: speed"
require_file_contains scripts/smoke-lts-panel-core.py "client-usage-aggregation: sum-with-delivered-total"
require_file_contains scripts/smoke-lts-panel-core.py "action: retry"
require_file_contains scripts/smoke-lts-panel-core.py "delivery-policy: max-output"
require_file_contains scripts/smoke-lts-panel-core.py "fallback-policy: max-output-special"
require_file_contains scripts/smoke-lts-panel-core.py "mode: speed"
require_file_contains src/services/api/logs.ts "cursor?: string"
require_file_contains src/services/api/logs.ts "latestAfter"
require_file_contains src/services/api/logs.ts "nextCursor"
require_file_contains src/services/api/logs.ts "cursorReset"
require_file_contains src/services/api/logs.ts "'/logs'"
require_file_contains src/services/api/logs.ts "'/request-error-logs'"
require_file_contains src/services/api/logs.ts "/request-log-by-id"
require_file_contains src/pages/LogsPage.tsx "buildLogsQuery"
require_file_contains src/pages/LogsPage.tsx "LogPosition"
require_file_contains src/pages/LogsPage.tsx "cursorReset"
require_file_contains src/pages/LogsPage.tsx "fullscreenLogs"
require_file_contains src/pages/LogsPage.tsx "logs-fullscreen-active"
require_file_contains src/pages/LogsPage.tsx "openErrorLog"
require_file_contains src/pages/LogsPage.tsx "copySelectedErrorLog"
require_file_contains src/pages/LogsPage.tsx "downloadErrorLog"
require_file_contains src/pages/LogsPage.tsx "downloadRequestLog"
require_file_contains src/pages/LogsPage.module.scss ".logCardFullscreen"
require_file_contains src/pages/LogsPage.module.scss ".logPanelFullscreen"
require_file_contains src/services/api/authFiles.ts "'/auth-files'"
require_file_contains src/services/api/authFiles.ts "'/auth-files/status'"
require_file_contains src/services/api/authFiles.ts "'/auth-files/fields'"
require_file_contains src/services/api/authFiles.ts "/auth-files/models"
require_file_contains src/services/api/authFiles.ts "normalizeBatchUploadResponse"
require_file_contains src/services/api/authFiles.ts "normalizeBatchDeleteResponse"
require_file_contains src/services/api/authFiles.ts "AUTH_FILE_INVALID_JSON_OBJECT_ERROR"
require_file_contains src/pages/AuthFilesPage.tsx "CodexRemoteCloudConnectEnvironmentsModal"
require_file_contains src/pages/AuthFilesPage.tsx "useCodexRemoteCloudConnectEnvironments"
require_file_contains src/features/authFiles/components/AuthFileCard.tsx "CodexRemoteCloudConnectAuthFileAction"
require_file_contains src/features/authFiles/components/AuthFileCard.tsx "CodexRemoteCloudConnectAuthFileSummary"
require_file_contains src/features/authFiles/components/AuthFileCard.tsx "onShowCodexRemoteCloudConnectEnvironments"
require_file_contains src/lts/codexRemoteCloudConnect/AuthFileCardAction.tsx "codexRemoteCloudConnectEnvironmentHeaderButton"
require_file_contains src/lts/codexRemoteCloudConnect/AuthFileCardAction.tsx "codex_remote_cloud_connect_environment_card_summary"
require_file_contains src/lts/i18n/en.lts.json "codex_remote_cloud_connect_environment_button"
require_file_contains src/lts/i18n/zh-CN.lts.json "codex_remote_cloud_connect_environment_button"
require_file_contains src/lts/i18n/zh-TW.lts.json "codex_remote_cloud_connect_environment_button"
require_file_contains src/lts/i18n/ru.lts.json "codex_remote_cloud_connect_environment_button"
require_file_contains src/services/api/oauth.ts "'xai'"
require_file_contains src/services/api/oauth.ts "WEBUI_SUPPORTED"
require_file_contains src/services/api/oauth.ts "/get-auth-status"
require_file_contains src/services/api/oauth.ts "'/oauth-callback'"
require_file_contains src/services/api/apiCall.ts "'/api-call'"
require_file_contains src/features/authFiles/constants.ts "QUOTA_PROVIDER_TYPES"
require_file_contains src/features/authFiles/constants.ts "OAUTH_PROVIDER_PRESETS"
require_file_contains src/features/authFiles/constants.ts "xai"
require_file_contains src/features/authFiles/constants.ts "AUTH_FILE_WEBSOCKET_PROVIDERS"
require_file_contains src/features/authFiles/constants.ts "supportsAuthFileWebsockets"
require_file_contains src/features/authFiles/components/AuthFilesPrefixProxyEditorModal.tsx "supportsAuthFileWebsockets"
require_file_contains src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts "supportsAuthFileWebsockets"
require_file_contains src/i18n/locales/en.json "websockets_label"
require_file_contains src/i18n/locales/zh-CN.json "websockets_label"
require_file_contains src/i18n/locales/zh-TW.json "websockets_label"
require_file_contains src/i18n/locales/ru.json "websockets_label"
require_file_contains src/features/authFiles/components/AuthFileQuotaSection.tsx "XAI_CONFIG"
require_file_contains src/features/authFiles/components/AuthFileQuotaSection.tsx "CODEX_CONFIG"
require_file_contains src/components/quota/quotaConfigs.ts "CODEX_CONFIG"
require_file_contains src/lts/codexQuota/config.ts "resetCodexQuota"
require_file_contains src/lts/codexQuota/config.ts "CODEX_RATE_LIMIT_RESET_CREDITS_URL"
require_file_contains src/lts/codexQuota/config.ts "CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL"
require_file_contains src/lts/codexQuota/config.ts "weekly_estimate_usd_inline"
require_file_contains src/lts/codexQuota/config.ts "analytics_backend_now"
require_file_contains src/lts/codexQuota/config.ts "formatCodexUsdAmount"
require_file_contains src/lts/codexQuota/config.ts "CodexResetCreditsDetailsButton"
require_file_contains src/lts/codexQuota/config.ts "rateLimitResetCredits"
require_file_contains src/lts/codexQuota/config.ts "codexPlanItem"
require_file_contains src/lts/codexQuota/config.ts "CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS"
require_file_contains src/lts/codexQuota/resetConfirmation.ts "showCodexQuotaResetConfirmation"
require_file_contains src/lts/codexQuota/ResetCreditsDetails.tsx "CodexResetCreditsDetailsButton"
require_file_contains src/lts/codexQuota/ResetCreditsDetails.tsx "LTS-owned reset credit details dialog"
require_file_contains src/lts/codexQuota/resetCredits.ts "getCodexRateLimitResetCreditsInfo"
require_file_contains src/lts/codexQuota/resetCredits.ts "sortCodexResetCredits"
require_file_contains src/lts/codexQuota/styles.module.scss ".codexDetails[open] .codexDetailsChevron"
require_file_contains src/lts/codexQuota/styles.module.scss ".codexPlanItem"
require_file_contains src/lts/codexQuota/styles.module.scss ".codexResetCreditCard"
require_file_contains src/pages/QuotaPage.module.scss ".codexDetailsSurface"
require_file_contains src/pages/AuthFilesPage.module.scss ".codexDetailsSurface"
require_file_not_contains src/pages/QuotaPage.module.scss ".codexDetailsSummary"
require_file_not_contains src/pages/AuthFilesPage.module.scss ".codexDetailsSummary"
require_file_contains scripts/smoke-lts-panel.py "Est weekly 0.31 USD"
require_file_contains scripts/smoke-lts-panel.py "rate-limit-reset-credits"
require_file_contains src/lts/i18n/en.lts.json "weekly_estimate_usd_inline"
require_file_contains src/lts/i18n/zh-CN.lts.json "weekly_estimate_usd_inline"
require_file_contains src/lts/i18n/zh-TW.lts.json "weekly_estimate_usd_inline"
require_file_contains src/lts/i18n/ru.lts.json "weekly_estimate_usd_inline"
require_file_contains src/lts/i18n/en.lts.json "analytics_backend_now"
require_file_contains src/lts/i18n/zh-CN.lts.json "analytics_backend_now"
require_file_contains src/lts/i18n/zh-TW.lts.json "analytics_backend_now"
require_file_contains src/lts/i18n/ru.lts.json "analytics_backend_now"
require_file_contains src/lts/i18n/en.lts.json "reset_credits_details_button"
require_file_contains src/lts/i18n/zh-CN.lts.json "reset_credits_details_button"
require_file_contains src/lts/i18n/zh-TW.lts.json "reset_credits_details_button"
require_file_contains src/lts/i18n/ru.lts.json "reset_credits_details_button"
require_file_contains src/lts/i18n/en.lts.json "credits_unit"
require_file_contains src/lts/i18n/zh-CN.lts.json "credits_unit"
require_file_contains src/lts/i18n/zh-TW.lts.json "credits_unit"
require_file_contains src/lts/i18n/ru.lts.json "credits_unit"
require_file_contains src/components/quota/quotaConfigs.ts "XAI_CONFIG"
require_file_contains src/components/quota/quotaConfigs.ts "fetchXaiQuota"
require_file_contains src/components/quota/quotaConfigs.ts "XAI_BILLING_WEEKLY_URL"
require_file_contains src/components/quota/quotaConfigs.ts "XAI_BILLING_MONTHLY_URL"
require_file_contains src/components/quota/quotaConfigs.ts "batchConcurrency"
require_file_contains src/stores/useQuotaStore.ts "setXaiQuota"
require_file_contains src/types/quota.ts "XaiQuotaState"
require_file_contains src/pages/DashboardPage.tsx "useConfigStore"
require_file_contains src/pages/DashboardPage.tsx "fetchConfig"
require_file_contains src/pages/DashboardPage.tsx "countAmpcodeConfig"
require_file_contains src/pages/DashboardPage.tsx "config.ampcode"
require_file_contains src/pages/DashboardPage.tsx "ampcode: providerStats.ampcode"
require_file_contains src/stores/useModelsStore.ts "modelsApi.fetchModels"
require_file_contains src/i18n/locales/en.json "A:{{ampcode}}"
require_file_contains src/i18n/locales/zh-CN.json "A:{{ampcode}}"
require_file_contains src/i18n/locales/zh-TW.json "A:{{ampcode}}"
require_file_contains src/i18n/locales/ru.json "A:{{ampcode}}"

# Behavior-oriented OpenAI Compatibility preservation checks.
require_file_contains scripts/smoke-lts-panel.py "assert_provider_mutation_payloads"
require_file_contains scripts/smoke-lts-panel.py "x-lts-unknown-provider"
require_file_contains scripts/smoke-lts-panel.py "x-lts-entry-note"
require_file_contains scripts/smoke-lts-panel.py "x-lts-model-note"
require_file_contains scripts/smoke-lts-panel.py "dropped provider unknown fields"
require_file_contains scripts/smoke-lts-panel.py "dropped model unknown field"
require_file_contains scripts/smoke-lts-panel.py "OpenAI Compatibility PUT payload must not write response-only auth-index"
require_file_contains scripts/smoke-lts-panel.py "openrouter-a"
require_file_contains scripts/smoke-lts-panel.py "openrouter-b"
require_file_contains scripts/smoke-lts-panel.py "openrouter.ai/api/v1/chat/completions"
require_file_contains scripts/smoke-lts-panel.py "openrouter.ai/api/v1/models"
require_file_contains scripts/smoke-lts-panel.py "openai/smoke-discovered"
require_file_contains scripts/smoke-lts-panel-core.py "Provider write smoke persisted response-only auth-index"

# Smoke coverage markers.
require_file_contains package.json "\"smoke:lts\""
require_file_contains package.json "\"smoke:lts:core\""
require_file_contains scripts/check-panel-feature-contracts.mjs "panel-feature-contracts.yaml"
require_file_contains scripts/smoke-lts-panel.py "LTS panel browser smoke"
require_file_contains scripts/smoke-lts-panel.py "assert_request_not_seen"
require_file_contains scripts/smoke-lts-panel.py "/v0/management/nodes"
require_file_contains scripts/smoke-lts-panel.py "run_logs_runtime_smoke"
require_file_contains scripts/smoke-lts-panel.py "run_home_logs_runtime_smoke"
require_file_contains scripts/smoke-lts-panel.py "build_home_logs_payload"
require_file_contains scripts/smoke-lts-panel.py "home_ip=10.99.0.7"
require_file_contains scripts/smoke-lts-panel.py "run_quota_runtime_smoke"
require_file_contains scripts/smoke-lts-panel.py "codex-smoke-auth"
require_file_contains scripts/smoke-lts-panel.py "xai-smoke-auth"
require_file_contains scripts/smoke-lts-panel.py "assert_api_call_url_seen"
require_file_contains scripts/smoke-lts-panel.py "daily-workspace-usage-counts"
require_file_contains scripts/smoke-lts-panel.py "rate-limit-reset-credits/consume"
require_file_contains scripts/smoke-lts-panel.py "cli-chat-proxy.grok.com/v1/billing"
require_file_contains scripts/smoke-lts-panel-core.py "MANAGEMENT_PASSWORD"
require_file_contains scripts/smoke-lts-panel-core.py "WRITABLE_PATH"
require_file_contains scripts/smoke-lts-panel-core.py "--include-plugin-store"
require_file_contains scripts/smoke-lts-panel-core.py "--no-write-smoke"
require_file_contains scripts/smoke-lts-panel-core.py "run_write_smoke"
require_file_contains scripts/smoke-lts-panel-core.py "run_auth_files_write_smoke"
require_file_contains scripts/smoke-lts-panel-core.py "run_plugin_config_smoke"
require_file_contains scripts/smoke-lts-panel-core.py "run_browser_provider_workbench_smoke"
require_file_contains scripts/smoke-lts-panel-core.py "run_browser_real_core_logs_smoke"

require_repo_contains "CPA-Core-LTS"
require_repo_contains "usage-statistics-enabled"
require_repo_contains "management.html"
require_repo_contains "x-cpa-support-plugin"

node scripts/check-panel-feature-contracts.mjs

if ! node <<'NODE'
const fs = require('node:fs');

const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
        ? deepMerge(out[k], v)
        : v;
  }
  return out;
};

const locales = ['en', 'zh-CN', 'zh-TW', 'ru'];

const collectKeys = (files, regex) => {
  const keys = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(source))) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
};

const codexQuotaKeys = collectKeys(
  [
    'src/lts/codexQuota/config.ts',
    'src/lts/codexQuota/resetConfirmation.ts',
    'src/components/quota/QuotaSection.tsx',
    'src/features/authFiles/components/AuthFileQuotaSection.tsx',
  ],
  /codex_quota\.([A-Za-z0-9_]+)/g
);

const remoteCloudConnectKeys = collectKeys(
  [
    'src/lts/codexRemoteCloudConnect/AuthFileCardAction.tsx',
    'src/features/authFiles/components/AuthFileCard.tsx',
    'src/lts/codexRemoteCloudConnect/CodexRemoteCloudConnectEnvironmentsModal.tsx',
    'src/lts/codexRemoteCloudConnect/CodexRemoteCloudConnectEnvironmentDeleteDetails.tsx',
    'src/lts/codexRemoteCloudConnect/useCodexRemoteCloudConnectEnvironments.ts',
  ],
  /auth_files\.([A-Za-z0-9_]+)/g
).filter((key) => !/(?:_$|advice_$|reason_$|view_$)/.test(key));

const failures = [];

for (const locale of locales) {
  // Codex locale keys are isolated into the LTS overlay (src/lts/i18n/*.lts.json) and
  // merged onto the shared catalog at runtime via i18n.addResourceBundle; mirror that here so
  // the check validates the effective merged catalog (base general keys + LTS codex keys).
  const base = JSON.parse(fs.readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
  const overlay = JSON.parse(fs.readFileSync(`src/lts/i18n/${locale}.lts.json`, 'utf8'));
  const catalog = deepMerge(base, overlay);
  const codexQuota = catalog.codex_quota || {};
  const authFiles = catalog.auth_files || {};

  const missingCodexQuota = codexQuotaKeys.filter((key) => !(key in codexQuota));
  const missingRemoteCloudConnect = remoteCloudConnectKeys.filter((key) => !(key in authFiles));

  if (missingCodexQuota.length > 0) {
    failures.push(`${locale} missing codex_quota keys: ${missingCodexQuota.join(', ')}`);
  }
  if (missingRemoteCloudConnect.length > 0) {
    failures.push(
      `${locale} missing auth_files remote cloud connect keys: ${missingRemoteCloudConnect.join(', ')}`
    );
  }
}

if (failures.length > 0) {
  failures.forEach((message) => console.error(message));
  process.exit(1);
}
NODE
then
  fail "missing Codex quota or remote cloud connect locale keys"
fi

for lockfile in bun.lock yarn.lock pnpm-lock.yaml; do
  if [ -e "$lockfile" ]; then
    fail "unexpected secondary package-manager lockfile: $lockfile"
  fi
done

if [ "$failures" -ne 0 ]; then
  printf 'LTS panel contract check failed with %s violation(s).\n' "$failures" >&2
  exit 1
fi

printf 'LTS panel contract check passed.\n'
