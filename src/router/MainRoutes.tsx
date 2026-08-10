import type { ReactNode } from 'react';
import { Navigate, useLocation, useRoutes, type Location } from 'react-router-dom';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AiProvidersPage } from '@/pages/AiProvidersPage';
import { AiProvidersAmpcodeEditPage } from '@/pages/AiProvidersAmpcodeEditPage';
import { AiProvidersClaudeEditLayout } from '@/pages/AiProvidersClaudeEditLayout';
import { AiProvidersClaudeEditPage } from '@/pages/AiProvidersClaudeEditPage';
import { AiProvidersClaudeModelsPage } from '@/pages/AiProvidersClaudeModelsPage';
import { AiProvidersCodexEditPage } from '@/pages/AiProvidersCodexEditPage';
import { AiProvidersGeminiEditPage } from '@/pages/AiProvidersGeminiEditPage';
import { AiProvidersOpenAIEditLayout } from '@/pages/AiProvidersOpenAIEditLayout';
import { AiProvidersOpenAIEditPage } from '@/pages/AiProvidersOpenAIEditPage';
import { AiProvidersOpenAIModelsPage } from '@/pages/AiProvidersOpenAIModelsPage';
import { AiProvidersVertexEditPage } from '@/pages/AiProvidersVertexEditPage';
import { AuthFilesPage } from '@/pages/AuthFilesPage';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import { OAuthPage } from '@/pages/OAuthPage';
import { QuotaPage } from '@/pages/QuotaPage';
import { UsagePage } from '@/pages/UsagePage';
import { UsagePricingPage } from '@/pages/UsagePricingPage';
import { ConfigPage } from '@/pages/ConfigPage';
import { LogsPage } from '@/pages/LogsPage';
import { SystemPage } from '@/pages/SystemPage';
import { PluginsPage } from '@/features/plugins/PluginsPage';
import { PluginStorePage } from '@/features/plugins/PluginStorePage';
import { PluginResourcePage } from '@/features/plugins/PluginResourcePage';
import { PluginRuntimeUnavailable } from '@/features/plugins/PluginRuntimeUnavailable';
import { ProvidersWorkbenchPage } from '@/features/providers/ProvidersWorkbenchPage';
import { useAuthStore, useConfigStore } from '@/stores';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function RequirePluginSupport({ children }: { children: ReactNode }) {
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const pluginSupportKnown = useAuthStore((state) => state.pluginSupportKnown);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  if (connectionStatus !== 'connected' || !pluginSupportKnown) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }
  if (supportsPlugin) {
    return <>{children}</>;
  }
  if (config === null) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }
  return config.pluginsEnabled === true ? (
    <PluginRuntimeUnavailable />
  ) : (
    <Navigate to="/" replace />
  );
}

function LegacyProviderPathRedirect() {
  const location = useLocation();
  const suffix = location.pathname.slice('/ai-providers'.length);
  return (
    <Navigate
      to={{
        pathname: `/ai-providers/legacy${suffix}`,
        search: location.search,
        hash: location.hash,
      }}
      replace
    />
  );
}

const mainRoutes = [
  { path: '/', element: <DashboardPage /> },
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/lts/usage', element: <Navigate to="/usage" replace /> },
  { path: '/lts/providers', element: <Navigate to="/ai-providers/legacy" replace /> },
  { path: '/lts/ampcode', element: <Navigate to="/ai-providers/legacy/ampcode" replace /> },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/ai-providers', element: <ProvidersWorkbenchPage /> },
  { path: '/ai-providers/workbench', element: <Navigate to="/ai-providers" replace /> },
  { path: '/ai-providers/legacy/gemini/new', element: <AiProvidersGeminiEditPage /> },
  { path: '/ai-providers/legacy/gemini/:index', element: <AiProvidersGeminiEditPage /> },
  { path: '/ai-providers/legacy/codex/new', element: <AiProvidersCodexEditPage /> },
  { path: '/ai-providers/legacy/codex/:index', element: <AiProvidersCodexEditPage /> },
  {
    path: '/ai-providers/legacy/claude/new',
    element: <AiProvidersClaudeEditLayout />,
    children: [
      { index: true, element: <AiProvidersClaudeEditPage /> },
      { path: 'models', element: <AiProvidersClaudeModelsPage /> },
    ],
  },
  {
    path: '/ai-providers/legacy/claude/:index',
    element: <AiProvidersClaudeEditLayout />,
    children: [
      { index: true, element: <AiProvidersClaudeEditPage /> },
      { path: 'models', element: <AiProvidersClaudeModelsPage /> },
    ],
  },
  { path: '/ai-providers/legacy/vertex/new', element: <AiProvidersVertexEditPage /> },
  { path: '/ai-providers/legacy/vertex/:index', element: <AiProvidersVertexEditPage /> },
  {
    path: '/ai-providers/legacy/openai/new',
    element: <AiProvidersOpenAIEditLayout />,
    children: [
      { index: true, element: <AiProvidersOpenAIEditPage /> },
      { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
    ],
  },
  {
    path: '/ai-providers/legacy/openai/:index',
    element: <AiProvidersOpenAIEditLayout />,
    children: [
      { index: true, element: <AiProvidersOpenAIEditPage /> },
      { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
    ],
  },
  { path: '/ai-providers/legacy/ampcode', element: <AiProvidersAmpcodeEditPage /> },
  { path: '/ai-providers/legacy', element: <AiProvidersPage /> },
  // Preserve bookmarked legacy editor URLs while keeping the Workbench canonical.
  { path: '/ai-providers/gemini/*', element: <LegacyProviderPathRedirect /> },
  { path: '/ai-providers/codex/*', element: <LegacyProviderPathRedirect /> },
  { path: '/ai-providers/claude/*', element: <LegacyProviderPathRedirect /> },
  { path: '/ai-providers/vertex/*', element: <LegacyProviderPathRedirect /> },
  { path: '/ai-providers/openai/*', element: <LegacyProviderPathRedirect /> },
  { path: '/ai-providers/ampcode', element: <LegacyProviderPathRedirect /> },
  { path: '/ai-providers/*', element: <Navigate to="/ai-providers" replace /> },
  { path: '/auth-files', element: <AuthFilesPage /> },
  { path: '/auth-files/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },
  { path: '/oauth', element: <OAuthPage /> },
  { path: '/quota', element: <QuotaPage /> },
  { path: '/usage/pricing', element: <UsagePricingPage /> },
  { path: '/usage', element: <UsagePage /> },
  {
    path: '/plugins',
    element: (
      <RequirePluginSupport>
        <PluginsPage />
      </RequirePluginSupport>
    ),
  },
  {
    path: '/plugin-store',
    element: (
      <RequirePluginSupport>
        <PluginStorePage />
      </RequirePluginSupport>
    ),
  },
  {
    path: '/plugin-pages/:pluginId/:menuIndex',
    element: (
      <RequirePluginSupport>
        <PluginResourcePage />
      </RequirePluginSupport>
    ),
  },
  { path: '/config', element: <ConfigPage /> },
  { path: '/logs', element: <LogsPage /> },
  { path: '/system', element: <SystemPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function MainRoutes({ location }: { location?: Location }) {
  return useRoutes(mainRoutes, location);
}
