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

require_repo_not_contains() {
  local pattern="$1"
  if git grep -I -F -q -e "$pattern" -- . \
    ':(exclude)scripts/check-lts-panel-contract.sh' \
    ':(exclude)dist/**' \
    ':(exclude)local/**'; then
    fail "unexpected repository marker: $pattern"
  fi
}

for path in \
  src/router/MainRoutes.tsx \
  src/features/dashboard/DashboardPage.tsx \
  src/features/dashboard/dashboard.module.scss \
  src/features/dashboard/hooks/useDashboardOverview.ts \
  src/hooks/motion.ts \
  src/pages/UsagePage.tsx \
  src/pages/UsagePage.module.scss \
  src/pages/UsagePricingPage.tsx \
  src/pages/UsagePricingPage.module.scss \
  src/components/usage \
  src/components/usage/AGENTS.md \
  src/components/usage/PricingEntryCard.tsx \
  src/components/usage/PresetPricingCatalog.tsx \
  src/components/usage/PresetPricingCatalog.module.scss \
  src/components/usage/presetPricingCatalogUtils.ts \
  src/components/usage/PresetPricingCatalog.test.mjs \
  src/components/providers \
  src/components/providers/AmpcodeSection \
  src/components/providers/ProviderStatusBar.tsx \
  src/components/providers/hooks/useProviderRecentRequests.ts \
  src/components/layout/CommandPalette.tsx \
  src/components/layout/CoreScopeRail.tsx \
  src/components/layout/MainLayout.tsx \
  src/components/layout/SidebarNavigation.tsx \
  src/components/layout/sidebarNavigationModel.ts \
  src/assets/icons/amp.svg \
  src/pages/AiProvidersPage.tsx \
  src/pages/CoreWorkspace.tsx \
  src/pages/CoreWorkspace.module.scss \
  src/pages/AiProvidersAmpcodeEditPage.tsx \
  src/assets/icons/claudeapi.png \
  src/assets/icons/grok.svg \
  src/assets/icons/grok-dark.svg \
  src/assets/icons/code0.png \
  src/assets/icons/fenno-ai.png \
  src/assets/icons/qiniu-cloud.png \
  src/assets/icons/infistar.png \
  src/features/providers/ProvidersWorkbenchPage.tsx \
  src/features/providers/descriptors.ts \
  src/features/providers/code0.ts \
  src/features/providers/fennoAI.ts \
  src/features/providers/qiniuCloud.ts \
  src/features/providers/infistar.ts \
  src/features/providers/claudeApi.ts \
  src/features/providers/sponsorDefinitions.ts \
  src/features/providers/sponsorMutationRecovery.ts \
  src/features/providers/sheets/forms/BaseProviderForm.tsx \
  src/features/providers/sheets/forms/SponsorProviderForm.tsx \
  src/features/providers/sheets/forms/useConnectivityTest.ts \
  src/features/providers/sheets/forms/useModelDiscovery.ts \
  src/features/providers/xaiApiKeyProvider.test.mjs \
  src/features/providers/providerIntegrity.test.mjs \
  src/services/api/client.test.mjs \
  src/features/plugins/PluginsPage.tsx \
  src/features/plugins/PluginStorePage.tsx \
  src/features/plugins/PluginResourcePage.tsx \
  src/features/plugins/PluginRuntimeUnavailable.tsx \
  src/features/plugins/PluginRuntimeUnavailable.module.scss \
  src/features/plugins/pluginReleaseVersions.ts \
  src/features/plugins/pluginResources.ts \
  src/features/plugins/pluginConfigDraft.ts \
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
  src/services/api/antigravitySubscription.ts \
  src/lts/codexRemoteCloudConnect/api.ts \
  src/pages/AuthFilesPage.tsx \
  src/pages/AuthFilesOAuthExcludedEditPage.tsx \
  src/pages/AuthFilesOAuthModelAliasEditPage.tsx \
  src/pages/OAuthPage.tsx \
  src/components/modelAlias \
  src/pages/QuotaPage.tsx \
  src/features/authFiles \
  src/utils/credentialWeight.ts \
  src/hooks/useUnsavedChangesGuard.ts \
  src/features/authFiles/components/AuthFileQuotaSection.tsx \
  src/features/authFiles/constants.ts \
  src/components/quota \
  src/stores/useUsageStatsStore.ts \
  src/stores/useAuthStore.ts \
  src/stores/useConfigStore.ts \
  src/stores/useModelsStore.ts \
  src/stores/useQuotaStore.ts \
  src/stores/useThemeStore.ts \
  src/stores/useWorkspaceStore.ts \
  src/stores/themeWorkspace.test.mjs \
  src/types/usage.ts \
  src/types/ampcode.ts \
  src/types/auth.ts \
  src/types/plugin.ts \
  src/types/authFile.ts \
  src/types/oauth.ts \
  src/types/quota.ts \
  src/types/visualConfig.ts \
  src/utils/usage.ts \
  src/utils/usageIndex.ts \
  src/utils/usage \
  src/utils/usage/cacheTokens.test.mjs \
  src/utils/usage/modelPrices.ts \
  src/utils/usage/modelPrices.test.mjs \
  src/utils/usage/importPreflight.ts \
  src/utils/usage/importPreflight.test.mjs \
  src/utils/usage/reasoningEffort.ts \
  src/utils/usage/reasoningEffort.test.mjs \
  src/utils/usage/pricing/index.ts \
  src/utils/usage/pricing/index.test.mjs \
  src/utils/usage/pricing/catalog.ts \
  src/utils/usage/pricing/storage.ts \
  src/utils/usage/pricing/storage.test.mjs \
  src/utils/usage/pricing/usagePricing.ts \
  src/utils/usage/pricing/usagePricing.test.mjs \
  src/utils/usage/pricing/usageAggregation.test.mjs \
  src/utils/recentRequests.ts \
  src/utils/quota \
  src/utils/constants.ts \
  src/styles/layout.scss \
  src/styles/next.scss \
  src/styles/themes.scss \
  docs/lts/panel-feature-contracts.yaml \
  docs/lts/panel-protected-deltas.yaml \
  docs/lts/sync-runbook.md \
  scripts/check-panel-feature-contracts.mjs \
  scripts/smoke-lts-panel.py \
  scripts/smoke-lts-panel-core.py \
  .github/workflows/lts-panel-contract.yml \
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
require_file_contains src/router/MainRoutes.tsx "path: '/core'"
require_file_contains src/router/MainRoutes.tsx "path: '/core/workspace'"
require_file_contains src/router/MainRoutes.tsx "path: '/usage/pricing'"
require_file_contains src/router/MainRoutes.tsx "path: '/lts/usage'"
require_file_contains src/router/MainRoutes.tsx "path: '/lts/providers'"
require_file_contains src/router/MainRoutes.tsx "path: '/lts/ampcode'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/workbench'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/legacy'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/legacy/ampcode'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/gemini/*'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/codex/*'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/claude/*'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/vertex/*'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/openai/*'"
require_file_contains src/router/MainRoutes.tsx "path: '/ai-providers/ampcode'"
require_file_contains src/router/MainRoutes.tsx "to=\"/ai-providers\""
require_file_contains src/router/MainRoutes.tsx "to=\"/ai-providers/legacy"
require_file_contains src/router/MainRoutes.tsx "to=\"/ai-providers/legacy/ampcode"
require_file_contains src/router/MainRoutes.tsx "path: '/auth-files/oauth-excluded'"
require_file_contains src/router/MainRoutes.tsx "path: '/auth-files/oauth-model-alias'"
require_file_contains src/router/MainRoutes.tsx "path: '/oauth'"
require_file_contains src/router/MainRoutes.tsx "UsagePage"
require_file_contains src/router/MainRoutes.tsx "AiProvidersAmpcodeEditPage"
require_file_contains src/components/layout/MainLayout.tsx "path: '/usage'"
require_file_contains src/components/layout/MainLayout.tsx "path: '/ai-providers/legacy'"
require_file_contains src/components/layout/MainLayout.tsx "nav.provider_legacy"
require_file_contains src/components/layout/MainLayout.tsx "data-workspace-layout"
require_file_contains src/components/layout/MainLayout.tsx 'sidebar-mode-${effectiveSidebarMode}'
require_file_contains src/components/layout/MainLayout.tsx "CommandPalette"
require_file_contains src/components/layout/MainLayout.tsx "CoreScopeRail"
require_file_contains src/stores/useThemeStore.ts "normalizeTheme"
require_file_contains src/stores/useThemeStore.ts "version: 3"
require_file_contains src/stores/useThemeStore.ts "removeAttribute('data-theme')"
require_file_contains src/stores/useWorkspaceStore.ts "normalizeWorkspaceLayout"
require_file_contains src/stores/useWorkspaceStore.ts "version: 1"
require_file_contains src/types/common.ts "Theme = 'white' | 'mist'"
require_file_contains src/types/common.ts "WorkspaceLayout = 'tower' | 'studio' | 'console'"
require_file_contains src/styles/themes.scss "[data-theme='mist']"
require_file_contains src/components/layout/CommandPalette.tsx "FOCUSABLE_SELECTOR"
require_file_contains src/components/layout/CommandPalette.tsx "event.key === 'Tab'"
require_file_contains src/stores/themeWorkspace.test.mjs "permanently migrates removed and invalid themes to white"
require_file_contains src/stores/themeWorkspace.test.mjs "keeps only the three supported workspace layouts"
require_file_contains scripts/smoke-lts-panel.py "Legacy paper theme did not migrate permanently to white"
require_file_contains scripts/smoke-lts-panel.py "Studio workspace did not persist"
require_file_contains scripts/smoke-lts-panel.py "Command palette allowed Tab focus to escape the modal"
require_file_not_contains src/styles/themes.scss "[data-theme='dark']"
require_file_not_contains src/components/layout/MainLayout.tsx "theme.paper"
require_file_not_contains src/components/layout/MainLayout.tsx "theme.dark"
require_file_not_contains src/components/layout/MainLayout.tsx "theme.auto"
require_file_not_contains src/stores/useThemeStore.ts "cycleTheme"
require_file_not_contains src/stores/useThemeStore.ts "prefers-color-scheme"
require_file_contains src/services/api/usage.ts "'/usage'"
require_file_contains src/services/api/usage.ts "'/usage/export'"
require_file_contains src/services/api/usage.ts "'/usage/import'"
require_file_contains src/stores/useUsageStatsStore.ts "usageApi.getUsage"
require_file_contains src/services/api/config.ts "'/usage-statistics-enabled'"
require_file_contains src/utils/constants.ts "USAGE: '/usage'"
require_file_contains src/utils/usage.ts "service_tier"
require_file_contains src/utils/usage.ts "request_service_tier"
require_file_contains src/utils/usage.ts "outbound_service_tier"
require_file_contains src/utils/usage.ts "response_service_tier"
require_file_contains src/utils/usage.ts "effective_service_tier"
require_file_contains src/utils/usage.ts "ttfb_ms"
require_file_contains src/utils/usage.ts "timing_version"
require_file_contains src/utils/usage.ts "ttft_ms"
require_file_contains src/utils/usage.ts "ttfa_ms"
require_file_contains src/utils/usage/performance.ts "extractTTFBMs"
require_file_contains src/utils/usage/performance.ts "extractTTFTMs"
require_file_contains src/utils/usage/performance.ts "extractTTFAMs"
require_file_contains src/utils/usage/performance.ts "calculateOutputTps"
require_file_contains src/utils/usage/performance.ts "calculateAverageTps"
require_file_contains src/utils/usage/performance.ts "calculateVisibleAverageTps"
require_file_contains src/utils/usage/performance.ts "calculateReasoningRatio"
require_file_contains src/utils/usage/performance.ts "summarizeUsagePerformance"
require_file_contains src/utils/usage.ts "resolveUsageTotalTokens"
require_file_contains src/utils/usage/cacheTokens.ts "resolveCacheWriteUnitPrice"
require_file_contains src/utils/usage/cacheTokens.ts "getUsageNonCacheReadInputTokenCount"
require_file_contains src/utils/usage/cacheTokens.test.mjs "non-cache-read input"
require_file_not_contains src/utils/usage.ts "cache_tokens?:"
require_file_not_contains src/utils/usage.ts "cache_write_tokens?:"
require_file_not_contains src/utils/usage/cacheTokens.ts "record.cache_tokens"
require_file_not_contains src/utils/usage/cacheTokens.ts "record.cache_write_tokens"
require_file_contains src/utils/usage/modelPrices.ts "normalizePersistedModelPrices"
require_file_contains src/utils/usage.ts "reasoning_effort"
require_file_not_contains src/utils/usage.ts "UsageThinking"
require_file_not_contains src/utils/usage.ts "normalizeUsageThinking"
require_file_contains src/utils/usage/importPreflight.ts "analyzeUsageImport"
require_file_contains src/utils/usage/importPreflight.ts "usage_version_unsupported"
require_file_contains src/utils/usage/importPreflight.ts "usage_shape_invalid"
require_file_contains src/utils/usage/importPreflight.ts "usage_v1_token_contract_invalid"
require_file_contains src/utils/usage/importPreflight.ts "usage_v1_cache_semantics_ambiguous"
require_file_contains src/utils/usage/importPreflight.ts "usage_v2_token_contract_invalid"
require_file_contains src/utils/usage/importPreflight.ts "usage_v1_timing_semantics_ambiguous"
require_file_contains src/utils/usage/importPreflight.ts "usage_v2_timing_semantics_ambiguous"
require_file_contains src/utils/usage/importPreflight.ts "usage_v3_token_contract_invalid"
require_file_contains src/utils/usage/importPreflight.ts "usage_v3_timing_contract_invalid"
require_file_contains src/utils/usage/importPreflight.ts "usage_aggregate_overflow"
require_file_contains src/utils/usage/importPreflight.ts "uncertainIdentityCount"
require_file_contains src/services/api/usageImportContract.ts "USAGE_IMPORT_ERROR_CODES"
require_file_contains src/services/api/usageImportContract.ts "schema_version"
require_file_contains src/services/api/usageImportContract.ts "migrated_from_version"
require_file_contains src/services/api/usageImportContract.ts "v1_uncached_input_tokens_to_v2"
require_file_contains src/services/api/usageImportContract.ts "v2_timing_contract_to_v3"
require_file_contains src/services/api/usageImportContract.ts "migrations"
require_file_contains src/components/usage/hooks/useUsageData.ts "getUsageImportErrorTranslationKey"
require_file_contains src/components/usage/hooks/useUsageData.ts "import_success_migrated_v1"
for locale in en zh-CN zh-TW ru; do
  for marker in \
    import_error_usage_version_unsupported \
    import_error_usage_shape_invalid \
    import_error_usage_v1_token_contract_invalid \
    import_error_usage_v1_cache_semantics_ambiguous \
    import_error_usage_v2_token_contract_invalid \
    import_error_usage_v1_timing_semantics_ambiguous \
    import_error_usage_v2_timing_semantics_ambiguous \
    import_error_usage_v3_token_contract_invalid \
    import_error_usage_v3_timing_contract_invalid \
    import_error_usage_aggregate_overflow; do
    require_file_contains "src/i18n/locales/${locale}.json" "${marker}"
  done
  require_file_contains "src/i18n/locales/${locale}.json" "import_success_migrated_v1"
  require_file_contains "src/i18n/locales/${locale}.json" "import_review_uncertain_identities"
done
require_file_contains src/utils/usage/reasoningEffort.ts "normalizeReasoningEffort"
require_file_contains src/utils/usage/serviceTier.ts "resolveServiceTier"
require_file_contains src/utils/usage/serviceTier.ts "ServiceTierEvidence"
require_file_contains src/utils/usage/serviceTier.test.mjs "unknown response blocks fallback"
require_repo_not_contains "billing_basis"
require_repo_not_contains "BillingBasis"
require_repo_not_contains "billingBasis"
require_repo_not_contains "CHATGPT_CREDIT_CATALOG"
require_file_contains src/utils/usage/pricing/index.ts "PRICE_CATALOG"
require_file_contains src/utils/usage/pricing/index.ts "aggregateCostEstimateCoverage"
require_file_contains src/utils/usage/pricing/index.ts "getLocalEstimateCoverageDisplay"
require_file_contains src/utils/usage/pricing/index.ts "isLocalEstimateComplete"
require_file_contains src/utils/usage/pricing/catalog.ts "PRICE_CATALOG"
require_file_contains src/utils/usage/pricing/catalog.ts "glm-5.2"
require_file_contains src/utils/usage/pricing/catalog.ts "ZAI_PRICING_SOURCE_URL"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-k3"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-k3-256k"
require_file_contains src/utils/usage/pricing/catalog.ts "k3-256k"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-k2.7-code"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-k2.7-code-highspeed"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-for-coding"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-for-coding-highspee"
require_file_contains src/utils/usage/pricing/catalog.ts "kimi-for-coding-highspeed"
require_file_contains src/utils/usage/pricing/catalog.ts "KIMI_PRICING_SOURCE_URL"
require_file_contains src/utils/usage/pricing/catalog.ts "grok-4.5"
require_file_contains src/utils/usage/pricing/catalog.ts "grok-4.6"
require_file_contains src/utils/usage/pricing/catalog.ts "XAI_PRICING_SOURCE_URL"
require_file_contains src/utils/usage/pricing/catalog.ts "XAI_GROK_46_PRICING_SOURCE_URL"
require_file_contains src/utils/usage/pricing/catalog.ts "XAI_LONG_CONTEXT_INPUT_TOKEN_THRESHOLD"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-haiku-4-5-20251001"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-haiku-4-5"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-sonnet-4-5-20250929"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-sonnet-4-5"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-sonnet-4-6"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-sonnet-5"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-opus-4-5-20251101"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-opus-4-5"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-opus-4-6"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-opus-4-7"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-opus-4-8"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-opus-5"
require_file_contains src/utils/usage/pricing/catalog.ts "claude-fable-5"
require_file_contains src/utils/usage/pricing/catalog.ts "ANTHROPIC_PRICING_SOURCE_URL"
require_file_contains src/utils/usage/pricing/catalog.ts "ANTHROPIC_MODEL_IDS_SOURCE_URL"
require_file_contains src/utils/usage/pricing/storage.ts "PRICE_PROFILE_STORAGE_KEY"
require_file_contains src/utils/usage/pricing/storage.ts "cli-proxy-model-prices-v3"
require_file_contains src/utils/usage/pricing/usagePricing.ts "estimateUsageDetailCost"
require_file_contains src/utils/usage.ts "calculatePricingCoverage"
require_file_contains src/utils/usage.ts "analyzeUsagePricing"
require_file_contains src/utils/usage/pricing/usageAggregation.test.mjs "hourly, and daily pricing share one amount"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "calculateCostEstimate"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_cost_estimate"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "estimated_cost_usd"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "pricing_status"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "data-request-cost-status"
require_file_contains src/components/usage/RequestEventsDetailsCard.test.mjs "renders the current local USD estimate"
require_file_contains package.json "RequestEventsDetailsCard.test.mjs"
require_file_contains src/pages/UsagePage.tsx "PricingEntryCard"
require_file_contains src/pages/UsagePricingPage.tsx "usage-pricing-page"
require_file_contains src/pages/UsagePricingPage.tsx "pricing-model-row"
require_file_contains src/pages/UsagePricingPage.tsx "PresetPricingCatalog"
require_file_contains src/components/usage/PresetPricingCatalog.tsx "PRICE_CATALOG"
require_file_contains src/components/usage/PresetPricingCatalog.tsx "preset-pricing-catalog"
require_file_contains src/components/usage/presetPricingCatalogUtils.ts "getCatalogExplicitFastRates"
require_file_contains src/components/usage/presetPricingCatalogUtils.ts "getCatalogSourceLinks"
require_file_contains src/components/usage/PresetPricingCatalog.test.mjs "explicit Fast catalog cards expose every rate"
require_file_contains package.json "test:usage-pricing-v3"
require_file_contains package.json "test:usage-pricing-catalog"
require_file_contains package.json "test:usage-pricing-storage"
require_file_contains package.json "test:usage-performance"
require_file_contains package.json "test:usage-pricing-integration"
require_file_contains scripts/smoke-lts-panel.py "run_usage_pricing_smoke"
require_file_contains scripts/smoke-lts-panel.py "run_usage_pricing_empty_catalog_smoke"
require_file_contains scripts/smoke-lts-panel.py "cli-proxy-model-prices-v3"
require_file_contains scripts/smoke-lts-panel.py "Fast long context unsupported"
require_file_contains scripts/smoke-lts-panel-core.py "build_service_tier_usage_snapshot"
require_file_contains scripts/smoke-lts-panel-core.py "outbound_service_tier"
require_file_contains scripts/smoke-lts-panel-core.py "effective_service_tier"
require_file_contains scripts/smoke-lts-panel-core.py '"/usage/pricing"'
require_file_not_contains src/utils/usage/reasoningEffort.ts "GPT56_ULTRA_WIRE_MODELS"
require_file_not_contains src/utils/usage/reasoningEffort.ts "isGPT56UltraWireModel"
require_file_not_contains src/utils/usage/reasoningEffort.ts "max-ultra-wire"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "service_tier"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "outbound_service_tier"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "resolved_service_tier"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "service_tier_evidence"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_filter_tier"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "reasoning_effort"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_filter_effort"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_ttfb"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_ttft"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_ttfa"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_output_tps"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_average_tps"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "data-performance-summary"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_visible_average_tps"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_reasoning_ratio"
require_file_contains src/utils/usage.ts "__apiBucket"
require_file_contains src/pages/UsagePage.tsx "requestApiKeys={config?.apiKeys"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_events_request_key"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_identity_type"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "request_key_hint"
require_file_contains src/components/usage/RequestEventsDetailsCard.test.mjs "without exposing the raw credential"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "getUsageNonCacheReadInputTokenCount"
require_file_contains src/components/usage/RequestEventsDetailsCard.tsx "non_cache_read_input_tokens"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "uncached_input_tokens"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "thinking_intensity"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "thinking_mode"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "thinking_level"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "thinking_budget"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "max-ultra-wire"
require_file_not_contains src/components/usage/RequestEventsDetailsCard.tsx "requestEventsThinking"
require_file_not_contains src/pages/UsagePage.module.scss "requestEventsThinking"
require_file_contains src/i18n/locales/en.json "request_events_filter_tier"
require_file_contains src/i18n/locales/zh-CN.json "request_events_filter_tier"
require_file_contains src/i18n/locales/zh-TW.json "request_events_filter_tier"
require_file_contains src/i18n/locales/ru.json "request_events_filter_tier"
require_file_contains src/i18n/locales/en.json "request_events_ttfb"
require_file_contains src/i18n/locales/zh-CN.json "request_events_ttfb"
require_file_contains src/i18n/locales/zh-TW.json "request_events_ttfb"
require_file_contains src/i18n/locales/ru.json "request_events_ttfb"
require_file_contains src/i18n/locales/en.json "request_events_ttft"
require_file_contains src/i18n/locales/zh-CN.json "request_events_ttft"
require_file_contains src/i18n/locales/zh-TW.json "request_events_ttft"
require_file_contains src/i18n/locales/ru.json "request_events_ttft"
require_file_contains src/i18n/locales/en.json "request_events_ttfa"
require_file_contains src/i18n/locales/zh-CN.json "request_events_ttfa"
require_file_contains src/i18n/locales/zh-TW.json "request_events_ttfa"
require_file_contains src/i18n/locales/ru.json "request_events_ttfa"
require_file_contains src/i18n/locales/en.json "pricing_browser_notice"
require_file_contains src/i18n/locales/zh-CN.json "pricing_browser_notice"
require_file_contains src/i18n/locales/zh-TW.json "pricing_browser_notice"
require_file_contains src/i18n/locales/ru.json "pricing_browser_notice"
require_file_contains src/i18n/locales/en.json "pricing_cost_incomplete"
require_file_contains src/i18n/locales/zh-CN.json "pricing_cost_incomplete"
require_file_contains src/i18n/locales/zh-TW.json "pricing_cost_incomplete"
require_file_contains src/i18n/locales/ru.json "pricing_cost_incomplete"
require_file_contains src/i18n/locales/en.json "pricing_catalog_table_label"
require_file_contains src/i18n/locales/zh-CN.json "pricing_catalog_table_label"
require_file_contains src/i18n/locales/zh-TW.json "pricing_catalog_table_label"
require_file_contains src/i18n/locales/ru.json "pricing_catalog_table_label"
require_file_contains src/i18n/locales/en.json "pricing_catalog_fast_explicit_summary"
require_file_contains src/i18n/locales/zh-CN.json "pricing_catalog_fast_explicit_summary"
require_file_contains src/i18n/locales/zh-TW.json "pricing_catalog_fast_explicit_summary"
require_file_contains src/i18n/locales/ru.json "pricing_catalog_fast_explicit_summary"
require_file_contains src/i18n/locales/en.json "pricing_catalog_verified_as_of"
require_file_contains src/i18n/locales/zh-CN.json "pricing_catalog_verified_as_of"
require_file_contains src/i18n/locales/zh-TW.json "pricing_catalog_verified_as_of"
require_file_contains src/i18n/locales/ru.json "pricing_catalog_verified_as_of"
require_file_contains src/i18n/locales/en.json '"pricing_source"'
require_file_contains src/i18n/locales/zh-CN.json '"pricing_source"'
require_file_contains src/i18n/locales/zh-TW.json '"pricing_source"'
require_file_contains src/i18n/locales/ru.json '"pricing_source"'
require_file_contains src/i18n/locales/en.json "request_events_filter_effort"
require_file_contains src/i18n/locales/zh-CN.json "request_events_filter_effort"
require_file_contains src/i18n/locales/zh-TW.json "request_events_filter_effort"
require_file_contains src/i18n/locales/ru.json "request_events_filter_effort"
require_file_contains src/i18n/locales/en.json "request_events_request_key"
require_file_contains src/i18n/locales/zh-CN.json "request_events_request_key"
require_file_contains src/i18n/locales/zh-TW.json "request_events_request_key"
require_file_contains src/i18n/locales/ru.json "request_events_request_key"
require_file_not_contains src/i18n/locales/en.json "request_events_effort_max_ultra_wire"
require_file_not_contains src/i18n/locales/zh-CN.json "request_events_effort_max_ultra_wire"
require_file_not_contains src/i18n/locales/zh-TW.json "request_events_effort_max_ultra_wire"
require_file_not_contains src/i18n/locales/ru.json "request_events_effort_max_ultra_wire"
require_file_contains src/services/api/ampcode.ts "'/ampcode'"
require_file_contains src/services/api/ampcode.ts "'/ampcode/upstream-api-keys'"
require_file_contains src/services/api/ampcode.ts "'/ampcode/model-mappings'"
require_file_contains src/services/api/ampcode.ts "'/ampcode/force-model-mappings'"
require_file_contains src/services/api/index.ts "export * from './usage'"
require_file_contains src/services/api/index.ts "export * from './ampcode'"
require_file_contains .github/workflows/release.yml "management.html"
require_file_contains .github/workflows/release.yml "v*-lts-*"
require_file_contains docs/lts/panel-protected-deltas.yaml "full-usage-statistics-ui"
require_file_contains docs/lts/panel-protected-deltas.yaml "cpa-core-lts-management-api-compatibility"
require_file_contains docs/lts/panel-protected-deltas.yaml "panel-release-contract"
require_file_contains docs/lts/sync-runbook.md "protected selective-port"
require_file_contains docs/lts/panel-feature-contracts.yaml "npm run test:usage-cache"

# Accepted upstream feature regression checks.
require_file_contains src/router/MainRoutes.tsx "ProvidersWorkbenchPage"
require_file_contains src/services/api/providers.ts "mutateLatestProviderList"
require_file_contains src/services/api/providers.ts "replaceLatestProviderRecord"
require_file_contains src/services/api/providers.ts "createXAIConfig"
require_file_contains src/services/api/providers.ts "updateXAIConfig"
require_file_contains src/services/api/providers.ts "deleteXAIConfig"
require_file_contains src/services/api/providers.ts "'xai-api-key'"
require_file_contains src/services/api/transformers.ts "xaiApiKeys"
require_file_contains src/features/providers/descriptors.ts "id: 'xai'"
require_file_contains src/features/providers/adapters.ts "xaiToResource"
require_file_contains src/features/providers/useProviderWorkbench.ts "case 'xai'"
require_file_contains src/features/providers/sheets/forms/BaseProviderForm.tsx "XAI_API_BASE_URL"
require_file_contains src/features/providers/sheets/forms/useModelDiscovery.ts "'xai'"
require_file_contains src/features/providers/sheets/forms/useConnectivityTest.ts "brand !== 'xai'"
require_file_contains src/features/providers/xaiApiKeyProvider.test.mjs "preserves unknown fields"
require_file_contains scripts/smoke-lts-panel.py "xAI provider payload wrote response-only auth-index"
require_file_contains scripts/smoke-lts-panel.py "created xAI resource using the Core contract"
require_file_contains scripts/smoke-lts-panel-core.py "BROWSER provider workbench xAI create"
require_file_contains src/i18n/locales/en.json '"xai": "xAI"'
require_file_contains src/i18n/locales/zh-CN.json '"xai": "xAI"'
require_file_contains src/i18n/locales/zh-TW.json '"xai": "xAI"'
require_file_contains src/i18n/locales/ru.json '"xai": "xAI"'

# Core-backed deferred contracts accepted as narrow LTS adaptations.
require_file_contains src/services/api/providers.ts "'interactions-api-key'"
require_file_contains src/features/providers/descriptors.ts "id: 'interactions'"
require_file_contains src/components/providers/utils.ts "buildInteractionsEndpoint"
require_file_contains src/components/providers/utils.ts "INTERACTIONS_API_REVISION"
require_file_contains src/components/providers/utils.ts "gemini-interactions"
require_file_contains src/features/providers/providerIntegrity.test.mjs "manages Interactions API resources through the Core contract"
require_file_contains scripts/smoke-lts-panel-core.py "BROWSER provider workbench Interactions API weight round-trip"
require_file_contains src/i18n/locales/en.json '"interactions": "Interactions API"'
require_file_contains src/i18n/locales/zh-CN.json '"interactions": "Interactions API"'
require_file_contains src/i18n/locales/zh-TW.json '"interactions": "Interactions API"'
require_file_contains src/i18n/locales/ru.json '"interactions": "Interactions API"'
require_file_contains src/types/visualConfig.ts "weighted-round-robin"
require_file_contains src/utils/credentialWeight.ts "MAX_CREDENTIAL_WEIGHT"
require_file_contains src/utils/credentialWeight.ts "validateCredentialWeightText"
require_file_contains src/services/api/providers.ts "payload.weight"
require_file_contains src/services/api/authFiles.ts "weight?: number | null"
require_file_contains src/utils/quota/upstreamQuotaPort.test.mjs "accepts WRR strategy aliases and enforces credential weight bounds"
require_file_contains src/features/providers/providerIntegrity.test.mjs "round-trips credential weights without dropping provider fields"
require_file_contains scripts/smoke-lts-panel-core.py "BROWSER visual save and reload weighted-round-robin"
require_file_contains scripts/smoke-lts-panel-core.py "Auth file credential weight round-tripped through Core"
require_file_contains src/i18n/locales/en.json '"weight_label"'
require_file_contains src/i18n/locales/zh-CN.json '"weight_label"'
require_file_contains src/i18n/locales/zh-TW.json '"weight_label"'
require_file_contains src/i18n/locales/ru.json '"weight_label"'
require_file_contains src/i18n/locales/en.json '"provider_legacy": "LTS Provider Status"'
require_file_contains src/i18n/locales/zh-CN.json '"provider_legacy": "LTS 提供商状态"'
require_file_contains src/i18n/locales/zh-TW.json '"provider_legacy": "LTS 提供商狀態"'
require_file_contains src/i18n/locales/ru.json '"provider_legacy": "Статус провайдеров LTS"'
require_file_contains src/types/provider.ts "displayName?: string"
require_file_contains src/features/providers/types.ts "displayName?: string"
require_file_contains src/services/api/transformers.ts "item['display-name']"
require_file_contains src/services/api/transformers.ts "item.alias || item.display_name || item.displayName"
require_file_contains src/services/api/providers.ts "payload['display-name']"
require_file_contains src/features/providers/sheets/forms/ModelEntriesEditor.tsx "modelDisplayNamePlaceholder"
require_file_contains src/features/providers/sheets/forms/SponsorProviderForm.tsx "ModelEntriesEditor"
require_file_contains src/i18n/locales/en.json '"modelDisplayNamePlaceholder"'
require_file_contains src/i18n/locales/zh-CN.json '"modelDisplayNamePlaceholder"'
require_file_contains src/i18n/locales/zh-TW.json '"modelDisplayNamePlaceholder"'
require_file_contains src/i18n/locales/ru.json '"modelDisplayNamePlaceholder"'
require_file_contains scripts/smoke-lts-panel.py "updated model display-name"
require_file_contains scripts/smoke-lts-panel.py "new model display-name"
require_file_contains scripts/smoke-lts-panel.py "preserved legacy model routing aliases"
require_file_contains scripts/smoke-lts-panel.py "cleared model display-name without dropping unknown fields"
require_file_contains scripts/smoke-lts-panel.py "updated sponsor model display-name"
require_file_contains scripts/smoke-lts-panel-core.py "updated model display-name"
require_file_contains scripts/smoke-lts-panel-core.py "new model display-name"
require_file_contains docs/lts/panel-feature-contracts.yaml "Core v7.2.70 or later"
require_file_contains src/features/providers/thinkingLevels.ts "THINKING_EFFORT_LEVELS"
require_file_not_contains src/features/providers/thinkingLevels.ts "'ultra'"
require_file_not_contains src/features/providers/sheets/forms/ModelEntriesEditor.tsx '"ultra"'
require_file_contains docs/lts/panel-feature-contracts.yaml "client-only ultra compatibility preset"
require_file_contains src/features/providers/thinkingLevels.ts "zero_allowed"
require_file_contains src/features/providers/thinkingLevels.ts "dynamic_allowed"
require_file_contains src/features/providers/thinkingLevels.ts "updateThinkingBudgetJson"
require_file_contains src/features/providers/sheets/forms/ModelEntriesEditor.tsx "thinkingResetDefault"
require_file_contains src/features/providers/sheets/forms/ModelEntriesEditor.tsx "thinkingBudgetRangeInvalid"
require_file_contains src/features/providers/sheets/forms/BaseProviderForm.tsx "supportsThinking"
require_file_contains src/features/providers/sheets/forms/SponsorProviderForm.tsx "supportsThinking"
require_file_contains src/services/api/providers.ts "'thinking'"
require_file_contains src/components/ui/modelInputListUtils.ts "preserved"
require_file_contains src/features/providers/providerIntegrity.test.mjs "legacy model inputs preserve fields that are not visually editable"
require_file_contains src/types/provider.ts "fingerprintProfile?: string"
require_file_contains src/features/providers/types.ts "claudeCodeCliProfile?: boolean"
require_file_contains src/services/api/transformers.ts "record?.['fingerprint-profile']"
require_file_contains src/services/api/providers.ts "payload['fingerprint-profile']"
require_file_contains src/features/providers/sheets/forms/BaseProviderForm.tsx "fingerprintProfileClaudeCodeCli"
require_file_not_contains src/features/providers/sheets/forms/BaseProviderForm.tsx "experimentalCchSigning"
require_file_contains src/i18n/locales/en.json '"fingerprintProfileClaudeCodeCli"'
require_file_contains src/i18n/locales/zh-CN.json '"fingerprintProfileClaudeCodeCli"'
require_file_contains src/i18n/locales/zh-TW.json '"fingerprintProfileClaudeCodeCli"'
require_file_contains src/i18n/locales/ru.json '"fingerprintProfileClaudeCodeCli"'
require_file_contains src/features/providers/providerIntegrity.test.mjs "round-trips the Claude fingerprint profile without dropping unknown fields"
require_file_contains scripts/smoke-lts-panel.py "cleared Claude fingerprint profile without dropping unknown fields"
require_file_contains scripts/smoke-lts-panel-core.py "BROWSER provider workbench Claude fingerprint-profile round-trip and reset"
require_file_contains scripts/smoke-lts-panel.py "Codex Thinking Model"
require_file_contains scripts/smoke-lts-panel-core.py "thinking capability round-trip and reset"
require_file_contains src/i18n/locales/en.json '"thinkingResetDefault"'
require_file_contains src/i18n/locales/zh-CN.json '"thinkingResetDefault"'
require_file_contains src/i18n/locales/zh-TW.json '"thinkingResetDefault"'
require_file_contains src/i18n/locales/ru.json '"thinkingResetDefault"'
require_file_contains src/features/providers/sponsorDefinitions.ts "getSponsorAggregationConflict"
require_file_contains src/features/providers/sponsorMutationRecovery.ts "runSponsorMutationWithRecovery"
require_file_contains scripts/smoke-lts-panel.py "assert_each_request_immediately_preceded_by"
require_file_contains scripts/smoke-lts-panel.py '("/ai-providers", "AI Providers", None)'
require_file_contains scripts/smoke-lts-panel.py '("/ai-providers/workbench", "AI Providers", "/ai-providers")'
require_file_contains scripts/smoke-lts-panel.py '("/ai-providers/legacy", "AI Providers Configuration", None)'
require_file_contains scripts/smoke-lts-panel.py '("/lts/providers", "AI Providers Configuration", "/ai-providers/legacy")'
require_file_contains scripts/smoke-lts-panel.py '("/lts/ampcode", "Configure Ampcode", "/ai-providers/legacy/ampcode")'
require_file_contains scripts/smoke-lts-panel.py '"/auth-files/oauth-excluded"'
require_file_contains scripts/smoke-lts-panel.py '"/auth-files/oauth-model-alias"'
require_file_contains scripts/smoke-lts-panel-core.py '("/ai-providers", "AI Providers", None)'
require_file_contains scripts/smoke-lts-panel-core.py '("/ai-providers/workbench", "AI Providers", "/ai-providers")'
require_file_contains scripts/smoke-lts-panel-core.py '("/ai-providers/legacy", "AI Providers Configuration", None)'
require_file_contains scripts/smoke-lts-panel-core.py '("/lts/providers", "AI Providers Configuration", "/ai-providers/legacy")'
require_file_contains scripts/smoke-lts-panel-core.py '("/lts/ampcode", "Configure Ampcode", "/ai-providers/legacy/ampcode")'
require_file_contains scripts/smoke-lts-panel-core.py '"/auth-files/oauth-excluded"'
require_file_contains scripts/smoke-lts-panel-core.py '"/auth-files/oauth-model-alias"'
require_file_not_contains src/router/MainRoutes.tsx "path: '/quick-start'"
require_file_not_contains src/components/layout/MainLayout.tsx "path: '/quick-start'"
require_repo_not_contains "apikey"".""fun"
require_repo_not_contains "APIKEY"".""FUN"
require_repo_not_contains "AK""CPA"
require_repo_not_contains "APIKEY""_FUN"
require_repo_not_contains "apikey""Fun"
require_repo_not_contains "AFFILIATE""_URL"
require_repo_not_contains "affiliate""Url"
require_repo_not_contains "agent/""register/"
require_repo_not_contains "register?""aff="
require_repo_not_contains "s.""qiniu.com/"
require_repo_not_contains "点此""注册"
require_repo_not_contains "Register"" here"
require_repo_not_contains "register""Link"
require_repo_not_contains "QUICK""_FILL_BRANDS"
require_repo_not_contains '"quick'"Fill"'"'
require_repo_not_contains "sponsor""Link"
require_file_contains docs/lts/panel-protected-deltas.yaml "commercial-neutral"
require_file_contains src/router/MainRoutes.tsx "path: '/plugins'"
require_file_contains src/router/MainRoutes.tsx "path: '/plugin-store'"
require_file_contains src/router/MainRoutes.tsx "path: '/plugin-pages/:pluginId/:menuIndex'"
require_file_contains src/components/layout/MainLayout.tsx "path: '/plugins'"
require_file_contains src/components/layout/MainLayout.tsx "path: '/plugin-store'"
require_file_contains src/utils/constants.ts "x-cpa-support-plugin"
require_file_contains src/stores/useAuthStore.ts "server-plugin-support-update"
require_file_contains src/stores/useAuthStore.ts "pluginSupportKnown"
require_file_contains src/stores/useAuthStore.ts "pluginSupportSource"
require_file_contains src/stores/useAuthStore.ts "probePluginSupport"
require_file_contains src/stores/useAuthStore.ts "currentRuntimeKind"
require_file_contains src/stores/useAuthStore.ts "delete nextState.pluginSupportSource"
require_file_contains src/services/api/client.ts "connectionGeneration"
require_file_contains src/services/api/client.ts "isCurrentConnection"
require_file_contains src/services/api/client.ts "clearConfig"
require_file_contains src/services/api/client.ts "synchronous: true"
require_file_contains src/services/api/client.test.mjs "binds connection details when the request is created"
require_file_contains src/router/MainRoutes.tsx "PluginRuntimeUnavailable"
require_file_contains scripts/smoke-lts-panel.py "run_plugin_runtime_mismatch_smoke"
require_file_contains scripts/smoke-lts-panel.py "arm_delayed_config_response"
require_file_contains src/i18n/locales/en.json "runtime_unavailable_title"
require_file_contains src/i18n/locales/zh-CN.json "runtime_unavailable_title"
require_file_contains src/i18n/locales/zh-TW.json "runtime_unavailable_title"
require_file_contains src/i18n/locales/ru.json "runtime_unavailable_title"
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
require_file_contains src/features/plugins/pluginResources.ts "isOfficialRepository"
require_file_contains src/features/plugins/pluginResources.test.mjs "trusts only the official source with an official GitHub repository"
require_file_contains package.json '"test:plugins"'
require_file_contains .github/workflows/lts-panel-contract.yml "npm run test:plugins"
require_file_contains src/features/plugins/pluginReleaseVersions.ts "fetchPluginReleaseVersions"
require_file_contains src/features/plugins/pluginReleaseVersions.ts "https://api.github.com"
require_file_contains src/features/plugins/pluginReleaseVersions.ts "supportsPluginVersionSelection"
require_file_contains src/features/plugins/pluginConfigDraft.ts "buildPluginConfigPatch"
require_file_contains src/features/plugins/PluginsPage.tsx "pluginsApi.patchConfig"
require_file_contains src/features/plugins/PluginsPage.tsx "pluginsApi.updateEnabled"
require_file_contains src/features/plugins/PluginsPage.tsx "delete configPatch.enabled"
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
require_file_contains scripts/smoke-lts-panel.py "run_plugin_config_patch_smoke"
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
require_file_contains src/pages/ConfigPage.tsx "latestServerYaml"
require_file_contains src/hooks/useVisualConfig.ts "hasPayloadDirtyFields"
require_file_contains src/hooks/useVisualConfig.ts "dirtyFields.has('host')"
require_file_contains src/hooks/useVisualConfig.ts "integer_range_1_3600"
require_file_contains src/types/visualConfig.ts "transientErrorCooldownSeconds"
require_file_contains src/hooks/useVisualConfig.ts "transient-error-cooldown-seconds"
require_file_contains src/components/config/VisualConfigEditor.tsx "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/en.json "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/zh-CN.json "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/zh-TW.json "transient_error_cooldown_seconds"
require_file_contains src/i18n/locales/ru.json "transient_error_cooldown_seconds"
require_file_contains scripts/smoke-lts-panel.py "transient-error-cooldown-seconds: -1"
require_file_contains scripts/smoke-lts-panel.py "concurrent-managed-smoke"
require_file_contains scripts/smoke-lts-panel-core.py "transient-error-cooldown-seconds: 0"
require_file_contains docs/lts/panel-feature-contracts.yaml "transientErrorCooldownSeconds"
require_file_contains docs/lts/panel-feature-contracts.yaml "transient-error-cooldown-seconds"
require_file_contains src/types/visualConfig.ts "'passthrough'"
require_file_contains src/hooks/useVisualConfig.ts "normalized === 'passthrough'"
require_file_contains src/components/config/VisualConfigEditor.tsx "disable_image_generation_passthrough"
require_file_contains src/i18n/locales/en.json "disable_image_generation_passthrough"
require_file_contains src/i18n/locales/zh-CN.json "disable_image_generation_passthrough"
require_file_contains src/i18n/locales/zh-TW.json "disable_image_generation_passthrough"
require_file_contains src/i18n/locales/ru.json "disable_image_generation_passthrough"
require_file_contains scripts/smoke-lts-panel.py "disable-image-generation: passthrough"
require_file_contains scripts/smoke-lts-panel-core.py "disable-image-generation: passthrough"
require_file_contains docs/lts/panel-feature-contracts.yaml "disable_image_generation_passthrough"
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
require_file_contains src/hooks/useVisualConfig.ts "hasCodexAbnormalReasoningRetryDirtyFields"
require_file_contains src/hooks/useVisualConfig.ts "dirtyFields.has('codexAbnormalReasoningRetryAction')"
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
require_file_contains src/services/api/authFiles.ts "force-mapping"
require_file_contains src/components/modelAlias/aliasValidation.ts "hasModelAliasConflict"
require_file_contains src/features/authFiles/oauthEditorState.ts "isOAuthEditorDirty"
require_file_contains src/features/authFiles/oauthExcludedRules.ts "getEffectiveOAuthExcludedRules"
require_file_contains src/pages/AuthFilesOAuthExcludedEditPage.tsx "useUnsavedChangesGuard"
require_file_contains scripts/smoke-lts-panel.py "run_oauth_editor_smoke"
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
require_file_contains src/features/authFiles/constants.ts "AUTH_FILE_USING_API_PROVIDERS"
require_file_contains src/features/authFiles/constants.ts "supportsAuthFileUsingApi"
require_file_contains src/features/authFiles/constants.ts "readAuthFileUsingApi"
require_file_contains src/features/authFiles/constants.ts "applyAuthFileUsingApi"
require_file_contains src/features/authFiles/components/AuthFilesPrefixProxyEditorModal.tsx "supportsAuthFileWebsockets"
require_file_contains src/features/authFiles/components/AuthFilesPrefixProxyEditorModal.tsx "using_api_label"
require_file_contains src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts "supportsAuthFileWebsockets"
require_file_contains src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts "usingApiTouched"
require_file_contains src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts "patch.using_api"
require_file_contains src/services/api/authFiles.ts "using_api?: boolean"
require_file_contains src/i18n/locales/en.json "websockets_label"
require_file_contains src/i18n/locales/zh-CN.json "websockets_label"
require_file_contains src/i18n/locales/zh-TW.json "websockets_label"
require_file_contains src/i18n/locales/ru.json "websockets_label"
require_file_contains src/i18n/locales/en.json "using_api_label"
require_file_contains src/i18n/locales/zh-CN.json "using_api_label"
require_file_contains src/i18n/locales/zh-TW.json "using_api_label"
require_file_contains src/i18n/locales/ru.json "using_api_label"
require_file_contains scripts/smoke-lts-panel.py "run_auth_file_using_api_smoke"
require_file_contains scripts/smoke-lts-panel.py '"using_api": True'
require_file_contains scripts/smoke-lts-panel-core.py '"using_api": True'
require_file_contains src/features/authFiles/components/AuthFileQuotaSection.tsx "XAI_CONFIG"
require_file_contains src/features/authFiles/components/AuthFileQuotaSection.tsx "CODEX_CONFIG"
require_file_contains src/utils/quota/constants.ts "retrieveUserQuotaSummary"
require_file_contains src/utils/quota/constants.ts "antigravity/cli/"
require_file_contains src/utils/quota/constants.ts "ANTIGRAVITY_CLI_VERSION = '1.0.13'"
require_file_contains src/utils/quota/constants.ts "ANTIGRAVITY_CODE_ASSIST_URL"
require_file_contains src/services/api/antigravitySubscription.ts "antigravitySubscriptionApi"
require_file_contains src/utils/quota/builders.ts "buildAntigravityQuotaGroups"
require_file_contains src/types/quota.ts "AntigravityQuotaSummaryPayload"
require_file_contains src/types/quota.ts "buckets: AntigravityQuotaBucket[]"
require_file_contains src/components/quota/quotaConfigs.ts "missing_project_id"
require_file_contains src/components/quota/quotaConfigs.ts "serverTimeOffsetMs"
require_file_contains src/components/quota/quotaConfigs.ts "subscriptionPromise"
require_file_contains src/utils/quota/upstreamQuotaPort.test.mjs "parses Antigravity quota-summary groups and current request identity"
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
require_file_contains src/stores/useQuotaStore.ts "captureQuotaCacheGeneration"
require_file_contains src/stores/useQuotaStore.ts "commitIfQuotaCacheCurrent"
require_file_contains src/stores/useAuthStore.ts "clearQuotaCache"
require_file_contains src/stores/useQuotaStore.ts "setXaiQuota"
require_file_contains src/types/quota.ts "XaiQuotaState"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "useConfigStore"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "fetchConfig"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "countAmpcodeConfig"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "config.ampcode"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "useProviderRecentRequests"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "summarizeProviderTraffic"
require_file_contains src/features/dashboard/hooks/useDashboardOverview.ts "modelsError ? null : models.length"
require_file_contains src/features/dashboard/dashboardMetrics.test.mjs "keeps provider totals scoped to the same recent buckets"
require_file_contains src/stores/useModelsStore.ts "modelsApi.fetchModels"
require_file_contains scripts/smoke-lts-panel.py '"Where to go from here"'
require_file_not_contains scripts/smoke-lts-panel.py '"System Overview"'
require_file_contains scripts/smoke-lts-panel-core.py '"Where to go from here"'
require_file_contains src/features/providers/descriptors.ts "claudeApi"
require_file_contains src/features/providers/descriptors.ts "code0"
require_file_contains src/features/providers/descriptors.ts "fennoAI"
require_file_contains src/features/providers/descriptors.ts "qiniuCloud"
require_file_contains src/features/providers/descriptors.ts "infistar"
require_file_contains src/features/providers/useProviderWorkbench.ts "CONFIG_DETECTED_BRANDS"
require_file_contains src/features/providers/useProviderWorkbench.ts "'infistar',"
require_file_contains src/features/providers/claudeApi.ts "CLAUDE_API_BASE_URL"
require_file_contains src/features/providers/code0.ts "CODE0_PROVIDER_NAME"
require_file_contains src/features/providers/fennoAI.ts "FENNO_AI_PROVIDER_NAME"
require_file_contains src/features/providers/qiniuCloud.ts "QINIU_CLOUD_PROVIDER_NAME"
require_file_contains src/features/providers/infistar.ts "INFISTAR_PROVIDER_NAME"
require_file_contains src/types/provider.ts "sourceIndex?: number"
require_file_contains src/services/api/transformers.ts "normalizeOpenAIProvider(item, index)"
require_file_contains src/services/api/providers.ts "getOpenAIProviderMutationIndex"
require_file_contains src/pages/AiProvidersPage.tsx "getOpenAIProviderMutationIndex"
require_file_contains src/features/providers/adapters.ts "config.sourceIndex ?? index"
require_file_contains src/features/providers/sponsorDefinitions.ts "getSponsorOpenAIDeleteIndices"
require_file_contains src/features/providers/useProviderWorkbench.ts "getSponsorOpenAIDeleteIndices(raw)"
require_file_contains src/features/providers/providerIntegrity.test.mjs "custom branded endpoints"
require_file_contains src/features/providers/providerIntegrity.test.mjs "adapts configured Infistar endpoints without promotional metadata"
require_file_contains src/components/providers/hooks/useProviderRecentRequests.ts "createProviderRecentRequestsCacheController"
require_file_contains src/components/providers/hooks/useProviderRecentRequests.ts "state.managementKey"
require_file_contains src/components/providers/hooks/providerRecentRequests.test.mjs "late writes to an old connection"
require_file_contains src/features/authFiles/components/AuthFileQuotaSection.tsx "captureQuotaCacheGeneration"
require_file_contains src/features/authFiles/components/AuthFileQuotaSection.tsx "commitIfQuotaCacheCurrent"
require_file_contains src/features/authFiles/constants.ts "OAuthConfigLoadError"
require_file_contains src/features/authFiles/constants.ts "canWriteOAuthConfig"
require_file_contains src/features/authFiles/hooks/useAuthFilesOauth.tsx "excludedReadyRef"
require_file_contains src/features/authFiles/hooks/useAuthFilesOauth.tsx "modelAliasReadyRef"
require_file_contains src/features/authFiles/oauthConfigLoadGuard.test.mjs "successfully loaded baseline"
require_file_contains src/features/authFiles/oauthConfigLoadGuard.test.mjs "preserves OAuth model-alias force mapping in both wire variants"
require_file_contains src/features/authFiles/oauthConfigLoadGuard.test.mjs "normalizes and toggles OAuth excluded rules without dropping custom patterns"
require_file_contains src/features/authFiles/oauthConfigLoadGuard.test.mjs "keeps OAuth dirty signatures stable while detecting partial edits"
require_file_contains scripts/smoke-lts-panel.py "run_oauth_load_failure_smoke"
require_file_contains scripts/smoke-lts-panel.py "OAuth load-failure smoke emitted a write request"

# Behavior-oriented OpenAI Compatibility preservation checks.
require_file_contains scripts/smoke-lts-panel.py "assert_provider_mutation_payloads"
require_file_contains scripts/smoke-lts-panel.py "x-lts-unknown-provider"
require_file_contains scripts/smoke-lts-panel.py "x-lts-entry-note"
require_file_contains scripts/smoke-lts-panel.py "x-lts-model-note"
require_file_contains scripts/smoke-lts-panel.py "dropped provider unknown fields"
require_file_contains scripts/smoke-lts-panel.py "dropped model unknown field"
require_file_contains scripts/smoke-lts-panel.py "dropped configured branded provider"
require_file_contains scripts/smoke-lts-panel.py "include_branded_providers"
require_file_contains scripts/smoke-lts-panel.py "run_branded_provider_visibility_smoke"
require_file_contains scripts/smoke-lts-panel.py "shown as a recommendation"
require_file_contains scripts/smoke-lts-panel.py "OpenAI Compatibility provider payload wrote response-only auth-index"
require_file_contains scripts/smoke-lts-panel.py "OpenAI Compatibility key payload wrote response-only auth-index"
require_file_contains scripts/smoke-lts-panel.py "openrouter-a"
require_file_contains scripts/smoke-lts-panel.py "openrouter-b"
require_file_contains scripts/smoke-lts-panel.py "openrouter.ai/api/v1/chat/completions"
require_file_contains scripts/smoke-lts-panel.py "openrouter.ai/api/v1/models"
require_file_contains scripts/smoke-lts-panel.py "openai/smoke-discovered"
require_file_contains scripts/smoke-lts-panel-core.py "Provider write smoke persisted response-only auth-index"

# Smoke coverage markers.
require_file_contains package.json "\"test:usage-cache\""
require_file_contains package.json '"test:usage-prices"'
require_file_contains package.json '"test:usage-import"'
require_file_contains package.json '"test:usage-effort"'
require_file_contains package.json '"test:dashboard"'
require_file_contains package.json '"test:provider-xai"'
require_file_contains package.json '"test:provider-integrity"'
require_file_contains package.json '"test:provider-recent"'
require_file_contains package.json '"test:providers"'
require_file_contains package.json '"test:auth-files"'
require_file_contains package.json '"test:api-client"'
require_file_contains package.json '"test:usage"'
require_file_contains package.json '"validate:lts": "npm run test:usage'
require_file_contains package.json 'npm run test:dashboard'
require_file_contains package.json 'npm run test:providers'
require_file_contains package.json 'npm run test:auth-files'
require_file_contains package.json 'npm run test:api-client'
require_file_contains .github/workflows/lts-panel-contract.yml "npm run test:usage"
require_file_contains .github/workflows/lts-panel-contract.yml "npm run test:dashboard"
require_file_contains .github/workflows/lts-panel-contract.yml "npm run test:providers"
require_file_contains .github/workflows/lts-panel-contract.yml "npm run test:auth-files"
require_file_contains .github/workflows/lts-panel-contract.yml "npm run test:api-client"
require_file_contains scripts/smoke-lts-panel.py "run_usage_contract_import_smoke"
require_file_contains scripts/smoke-lts-panel.py "Ambiguous v1 cache semantics must not POST usage imports"
require_file_contains scripts/smoke-lts-panel.py "Invalid v2 token contracts must not POST usage imports"
require_file_contains scripts/smoke-lts-panel.py "Uncertain timestamp review must not POST after cancellation"
require_file_contains scripts/smoke-lts-panel.py "Released Core success receipt must be accepted after exactly one POST"
require_file_contains scripts/smoke-lts-panel.py "usage_aggregate_overflow"
require_file_contains scripts/smoke-lts-panel-core.py "Core usage import returned audited v1-to-v3 migration receipt"
require_file_contains scripts/smoke-lts-panel-core.py "Core usage import returned audited v2-to-v3 migration receipt"
require_file_contains scripts/smoke-lts-panel.py "selected raw effort"
require_file_not_contains scripts/smoke-lts-panel.py "Max / Ultra wire"
require_file_contains scripts/smoke-lts-panel.py "Resets"
require_file_not_contains src/components/quota/quotaConfigs.ts "formatXaiPeriodRange"
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
require_file_contains scripts/smoke-lts-panel.py "Last 360 days"
require_file_contains scripts/smoke-lts-panel.py "assert_codex_daily_workspace_fetch"
require_file_contains scripts/smoke-lts-panel.py "usage-leaderboard"
require_file_contains scripts/smoke-lts-panel.py "codex-team-smoke-auth"
require_file_contains src/lts/codexQuota/config.ts "CODEX_ANALYTICS_HISTORY_DAYS"
require_file_contains src/lts/codexQuota/config.ts "CODEX_ROLLING_RANGE_DAYS"
require_file_contains src/lts/codexQuota/config.ts "codexTeamLeaderboardCacheKey"
require_file_contains src/lts/codexQuota/config.ts "classifyCodexLeaderboardPayloadForAccount"
require_file_contains src/lts/i18n/en.lts.json "team_analytics_incomplete"
require_file_contains src/utils/quota/upstreamQuotaPort.test.mjs "duplicate date"
require_file_contains scripts/codex-quota-compass.user.js "daily-analytics-integrity"
require_file_contains scripts/codex-quota-compass.user.js "team-leaderboard-integrity"
require_file_contains src/lts/codexQuota/config.ts "rolling-90"
require_file_contains src/lts/codexQuota/config.ts "rolling-360"
require_file_contains scripts/smoke-lts-panel.py "rate-limit-reset-credits/consume"
require_file_contains scripts/smoke-lts-panel.py "cli-chat-proxy.grok.com/v1/billing"
require_file_contains src/utils/quota/constants.ts "XAI_USER_URL"
require_file_contains src/utils/quota/constants.ts "XAI_AUTO_TOPUP_URL"
require_file_contains src/utils/quota/constants.ts "XAI_GROK_CLIENT_VERSION = '1.0.3'"
require_file_contains src/utils/quota/constants.ts "buildXaiGrokUserAgent"
require_file_contains src/utils/quota/constants.ts "buildXaiRequestHeaders"
require_file_contains src/utils/quota/constants.ts 'grok-pager/${XAI_GROK_CLIENT_VERSION}'
require_file_contains src/utils/quota/constants.ts "macintel|win32"
require_file_contains src/utils/quota/constants.ts "'x-grok-client-mode': 'interactive'"
require_file_contains src/utils/quota/constants.ts "accept: 'application/json'"
require_file_contains src/utils/quota/parsers.ts "parseXaiAutoTopupPayload"
require_file_contains src/components/quota/quotaConfigs.ts "preserveAutoTopup"
require_file_contains src/utils/quota/upstreamQuotaPort.test.mjs "parseXaiAutoTopupPayload(malformed)"
require_file_contains src/utils/quota/constants.ts "codex-tui/0.149.1"
require_file_contains src/utils/quota/upstreamQuotaPort.test.mjs "uses the current Codex TUI identity for Codex quota requests"
require_file_contains scripts/codex-quota-monitor.py "codex-tui/0.149.1"
require_file_contains scripts/smoke-lts-panel.py "assert_xai_billing_identity"
require_file_contains scripts/smoke-lts-panel.py "assert_xai_user_identity_lookup"
require_file_contains scripts/smoke-lts-panel.py "assert_xai_auto_topup_identity"
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

if ! node --check scripts/chatgpt-quota-helper.js >/dev/null; then
  fail "ChatGPT quota helper userscript has invalid JavaScript syntax"
fi
if ! node --check scripts/codex-quota-compass.user.js >/dev/null; then
  fail "Codex quota compass userscript has invalid JavaScript syntax"
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
