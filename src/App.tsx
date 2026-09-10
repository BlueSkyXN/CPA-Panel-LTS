import { useEffect } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { ConfirmationModal } from '@/components/common/ConfirmationModal';
import { MainLayout } from '@/components/layout/MainLayout';
import { PanelShell } from '@/components/layout/PanelShell';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useLanguageStore, useThemeStore, useWorkspaceStore } from '@/stores';
import { safeSessionPath } from '@/services/connectionSession';

const sessionPath = sessionStorage.getItem('cpa-session-path');
if (sessionPath) {
  sessionStorage.removeItem('cpa-session-path');
  window.history.replaceState(null, '', `#${safeSessionPath(sessionPath)}`);
}

function RootShell() {
  return (
    <PanelShell>
      <NotificationContainer />
      <ConfirmationModal />
      <Outlet />
    </PanelShell>
  );
}

const router = createHashRouter([
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
]);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const initializeLayout = useWorkspaceStore((state) => state.initializeLayout);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

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

  return <RouterProvider router={router} />;
}

export default App;
