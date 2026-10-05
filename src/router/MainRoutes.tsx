import { UsageEventsPage } from '@/pages/UsageEventsPage';
import type { ReactNode } from 'react';
import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AiProvidersAmpcodeEditPage } from '@/pages/AiProvidersAmpcodeEditPage';
import { AuthFilesPage } from '@/pages/AuthFilesPage';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import { OAuthPage } from '@/pages/OAuthPage';
import { QuotaPage } from '@/pages/QuotaPage';
import { UsagePage } from '@/pages/UsagePage';
import { UsagePricingPage } from '@/pages/UsagePricingPage';
import { ConfigPage } from '@/pages/ConfigPage';
import { FlowControlPage } from '@/pages/FlowControlPage';
import { LogsPage } from '@/pages/LogsPage';
import { SystemPage } from '@/pages/SystemPage';
import { CoreWorkspace } from '@/pages/CoreWorkspace';
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

function RequireFlowSupport({ children }: { children: ReactNode }) {
  const supportsFlowControl = useAuthStore((state) => state.supportsFlowControl);
  const flowSupportKnown = useAuthStore((state) => state.flowSupportKnown);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  if (connectionStatus !== 'connected' || !flowSupportKnown) {
    return (
      <div className="main-content">
        <LoadingSpinner />
      </div>
    );
  }
  if (supportsFlowControl) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}

const mainRoutes = [
  { path: '/', element: <DashboardPage /> },
  { path: '/dashboard', element: <DashboardPage /> },
  { path: '/core', element: <CoreWorkspace /> },
  { path: '/core/workspace', element: <Navigate to="/core" replace /> },
  { path: '/lts/usage', element: <Navigate to="/usage" replace /> },
  { path: '/lts/providers', element: <Navigate to="/ai-providers" replace /> },
  { path: '/lts/ampcode', element: <Navigate to="/ai-providers/ampcode" replace /> },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/ai-providers', element: <ProvidersWorkbenchPage /> },
  { path: '/ai-providers/workbench', element: <Navigate to="/ai-providers" replace /> },
  // Ampcode is LTS-owned and has no Workbench descriptor; it keeps a dedicated editor.
  { path: '/ai-providers/ampcode', element: <AiProvidersAmpcodeEditPage /> },
  // v8 removed the per-family legacy editors; old bookmarks land on the Workbench.
  { path: '/ai-providers/*', element: <Navigate to="/ai-providers" replace /> },
  { path: '/auth-files', element: <AuthFilesPage /> },
  { path: '/auth-files/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },
  { path: '/oauth', element: <OAuthPage /> },
  { path: '/quota', element: <QuotaPage /> },
  { path: '/usage/events', element: <UsageEventsPage /> },
  { path: '/usage/pricing', element: <UsagePricingPage /> },
  { path: '/usage', element: <UsagePage /> },
  {
    path: '/flow-control',
    element: (
      <RequireFlowSupport>
        <FlowControlPage />
      </RequireFlowSupport>
    ),
  },
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
