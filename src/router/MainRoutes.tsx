import type { ReactNode } from 'react';
import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
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

const mainRoutes = [
  { path: '/', element: <DashboardPage /> },
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/lts/usage', element: <Navigate to="/usage" replace /> },
  { path: '/lts/providers', element: <Navigate to="/ai-providers" replace /> },
  { path: '/lts/ampcode', element: <Navigate to="/ai-providers/ampcode" replace /> },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/ai-providers/workbench', element: <ProvidersWorkbenchPage /> },
  { path: '/ai-providers/gemini/new', element: <AiProvidersGeminiEditPage /> },
  { path: '/ai-providers/gemini/:index', element: <AiProvidersGeminiEditPage /> },
  { path: '/ai-providers/codex/new', element: <AiProvidersCodexEditPage /> },
  { path: '/ai-providers/codex/:index', element: <AiProvidersCodexEditPage /> },
  {
    path: '/ai-providers/claude/new',
    element: <AiProvidersClaudeEditLayout />,
    children: [
      { index: true, element: <AiProvidersClaudeEditPage /> },
      { path: 'models', element: <AiProvidersClaudeModelsPage /> },
    ],
  },
  {
    path: '/ai-providers/claude/:index',
    element: <AiProvidersClaudeEditLayout />,
    children: [
      { index: true, element: <AiProvidersClaudeEditPage /> },
      { path: 'models', element: <AiProvidersClaudeModelsPage /> },
    ],
  },
  { path: '/ai-providers/vertex/new', element: <AiProvidersVertexEditPage /> },
  { path: '/ai-providers/vertex/:index', element: <AiProvidersVertexEditPage /> },
  {
    path: '/ai-providers/openai/new',
    element: <AiProvidersOpenAIEditLayout />,
    children: [
      { index: true, element: <AiProvidersOpenAIEditPage /> },
      { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
    ],
  },
  {
    path: '/ai-providers/openai/:index',
    element: <AiProvidersOpenAIEditLayout />,
    children: [
      { index: true, element: <AiProvidersOpenAIEditPage /> },
      { path: 'models', element: <AiProvidersOpenAIModelsPage /> },
    ],
  },
  { path: '/ai-providers/ampcode', element: <AiProvidersAmpcodeEditPage /> },
  { path: '/ai-providers', element: <AiProvidersPage /> },
  { path: '/ai-providers/*', element: <AiProvidersPage /> },
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
