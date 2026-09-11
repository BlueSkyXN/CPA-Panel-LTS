import { useEffect, useLayoutEffect } from 'react';
import { Outlet, RouterProvider, createHashRouter, createMemoryRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { MainLayout } from '@/components/layout/MainLayout';
import { PanelShell } from '@/components/layout/PanelShell';
import { ConnectionRuntime } from '@/components/layout/ConnectionRuntime';
import { getManagedConnection, isConnectionFrame } from '@/services/connectionRuntime';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useLanguageStore, useThemeStore, useWorkspaceStore } from '@/stores';
import { useAuthStore } from '@/stores/useAuthStore';
import { safeSessionPath } from '@/services/connectionSession';

const sessionPath = !isConnectionFrame() && sessionStorage.getItem('cpa-session-path');
if (sessionPath) {
  sessionStorage.removeItem('cpa-session-path');
  window.history.replaceState(null, '', `#${safeSessionPath(sessionPath)}`);
}

function RootShell() {
  return (
    <>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </>
  );
}

const routes = [
  {
    element: <RootShell />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        path: '/*',
        element: (
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        ),
      },
    ],
  },
];
const embeddedFile = isConnectionFrame() && window.location.protocol === 'about:';
// srcdoc 没有可用于解析相对 URL 的地址，使用内存路由并同步 fragment。
const router = embeddedFile
  ? createMemoryRouter(routes, { initialEntries: [window.location.hash.slice(1) || '/'] })
  : createHashRouter(routes);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const initializeLayout = useWorkspaceStore((state) => state.initializeLayout);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  useLayoutEffect(() => {
    const connection = getManagedConnection();
    if (!connection) return;
    // 订阅 router，而非等待 React 页面绘制，保证导航后立即刷新仍恢复同一路由。
    const unsubscribe = router.subscribe(({ location }) => {
      const path = `${location.pathname}${location.search}${location.hash}`;
      if (embeddedFile && window.location.hash.slice(1) !== path) {
        window.history.replaceState(null, '', `about:srcdoc#${path}`);
      }
      connection.host.report(connection.id, window, useAuthStore.getState().connectionStatus, path);
    });
    const navigate = () => {
      const path = window.location.hash.slice(1) || '/';
      const { location } = router.state;
      if (path !== `${location.pathname}${location.search}${location.hash}`)
        void router.navigate(path);
    };
    if (embeddedFile) window.addEventListener('hashchange', navigate);
    return () => {
      unsubscribe();
      if (embeddedFile) window.removeEventListener('hashchange', navigate);
    };
  }, []);

  useEffect(() => {
    const cleanupTheme = initializeTheme();
    const cleanupLayout = initializeLayout();
    return () => {
      cleanupTheme();
      cleanupLayout();
    };
  }, [initializeLayout, initializeTheme]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅用于首屏同步 i18n 语言

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return isConnectionFrame() ? (
    <ConnectionRuntime>
      <RouterProvider router={router} />
    </ConnectionRuntime>
  ) : (
    <PanelShell>
      <RouterProvider router={router} />
    </PanelShell>
  );
}

export default App;
