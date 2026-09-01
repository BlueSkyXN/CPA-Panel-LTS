import {
  ReactNode,
  SVGProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageTransition } from '@/components/common/PageTransition';
import { SidebarNavigation } from '@/components/layout/SidebarNavigation';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { CoreScopeRail } from '@/components/layout/CoreScopeRail';
import {
  flattenSidebarNavPaths,
  type SidebarNavGroup,
  type SidebarNavItem,
} from '@/components/layout/sidebarNavigationModel';
import { MainRoutes } from '@/router/MainRoutes';
import {
  IconSidebarAuthFiles,
  IconSidebarConfig,
  IconSidebarDashboard,
  IconModelCluster,
  IconSidebarLogs,
  IconMaximize2,
  IconMinimize2,
  IconSidebarOauth,
  IconSidebarPlugins,
  IconSidebarProviders,
  IconSidebarQuota,
  IconSidebarSystem,
  IconSidebarUsage,
} from '@/components/ui/icons';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import {
  useAuthStore,
  useConfigStore,
  useLanguageStore,
  useNotificationStore,
  useThemeStore,
  useWorkspaceStore,
} from '@/stores';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { authFilesApi, pluginsApi } from '@/services/api';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  type PluginResourceEntry,
} from '@/features/plugins/pluginResources';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import type { Theme, WorkspaceLayout } from '@/types';

type SidebarMode = 'classic' | 'compact';

const SIDEBAR_MODE_STORAGE_KEY = 'mainLayout.sidebarMode';

const sidebarIcons: Record<string, ReactNode> = {
  dashboard: <IconSidebarDashboard size={18} />,
  coreWorkspace: <IconModelCluster size={18} />,
  aiProviders: <IconSidebarProviders size={18} />,
  authFiles: <IconSidebarAuthFiles size={18} />,
  oauth: <IconSidebarOauth size={18} />,
  quota: <IconSidebarQuota size={18} />,
  usage: <IconSidebarUsage size={18} />,
  plugins: <IconSidebarPlugins size={18} />,
  config: <IconSidebarConfig size={18} />,
  logs: <IconSidebarLogs size={18} />,
  system: <IconSidebarSystem size={18} />,
};

// Header action icons - smaller size for header buttons
const headerIconProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const headerIcons = {
  refresh: (
    <svg {...headerIconProps}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  layout: (
    <svg {...headerIconProps}>
      <rect x="3" y="3" width="7" height="18" rx="2" />
      <rect x="14" y="3" width="7" height="8" rx="2" />
      <rect x="14" y="15" width="7" height="6" rx="2" />
    </svg>
  ),
  menu: (
    <svg {...headerIconProps}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  ),
  close: (
    <svg {...headerIconProps}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  chevronLeft: (
    <svg {...headerIconProps}>
      <path d="m14 18-6-6 6-6" />
    </svg>
  ),
  chevronRight: (
    <svg {...headerIconProps}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  ),
  language: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  sun: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  logout: (
    <svg {...headerIconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  ),
};

const THEME_CARDS: Array<{
  key: Theme;
  labelKey: string;
  colors: { bg: string; card: string; border: string; textMuted: string };
}> = [
  {
    key: 'white',
    labelKey: 'theme.white',
    colors: { bg: '#ffffff', card: '#ffffff', border: '#e5e7eb', textMuted: '#9ca3af' },
  },
  {
    key: 'mist',
    labelKey: 'theme.mist',
    colors: { bg: '#f3f5f7', card: '#fbfcfd', border: '#dce1e7', textMuted: '#87909c' },
  },
];

const LAYOUT_CARDS: Array<{
  key: WorkspaceLayout;
  labelKey: string;
  descriptionKey: string;
}> = [
  { key: 'tower', labelKey: 'workspace.tower', descriptionKey: 'workspace.tower_desc' },
  { key: 'studio', labelKey: 'workspace.studio', descriptionKey: 'workspace.studio_desc' },
  { key: 'console', labelKey: 'workspace.console', descriptionKey: 'workspace.console_desc' },
];

export function MainLayout() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const location = useLocation();

  const logout = useAuthStore((state) => state.logout);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const pluginSupportKnown = useAuthStore((state) => state.pluginSupportKnown);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);

  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const layout = useWorkspaceStore((state) => state.layout);
  const setLayout = useWorkspaceStore((state) => state.setLayout);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMode, setSidebarMode] = useLocalStorage<SidebarMode>(
    SIDEBAR_MODE_STORAGE_KEY,
    'compact'
  );
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [pluginResourceEntries, setPluginResourceEntries] = useState<PluginResourceEntry[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authFilesCount, setAuthFilesCount] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const authFilesCountRequestRef = useRef(0);

  const fullBrandName = 'CLI Proxy API Management Center';
  const abbrBrandName = t('title.abbr');
  const isLogsPage = location.pathname.startsWith('/logs');
  const effectiveSidebarMode: SidebarMode = sidebarMode === 'compact' ? 'compact' : 'classic';
  const isCompactSidebar = effectiveSidebarMode === 'compact';
  const showSidebarLabels = !sidebarCollapsed || sidebarOpen;
  const sidebarModeToggleLabel = isCompactSidebar
    ? t('sidebar.switch_to_classic', { defaultValue: 'Switch to classic sidebar' })
    : t('sidebar.switch_to_compact', { defaultValue: 'Switch to compact sidebar' });
  const canLoadPlugins = supportsPlugin && connectionStatus === 'connected';
  const showPluginRuntimeDiagnostic =
    connectionStatus === 'connected' &&
    pluginSupportKnown &&
    !supportsPlugin &&
    config?.pluginsEnabled === true;

  const loadPluginResources = useCallback(async () => {
    if (!canLoadPlugins) {
      setPluginResourceEntries([]);
      return;
    }

    try {
      const plugins = await pluginsApi.list();
      setPluginResourceEntries(collectPluginResourceEntries(plugins.plugins));
    } catch {
      setPluginResourceEntries([]);
    }
  }, [canLoadPlugins]);

  const loadAuthFilesCount = useCallback(async () => {
    const requestID = ++authFilesCountRequestRef.current;
    if (connectionStatus !== 'connected') {
      setAuthFilesCount(null);
      return;
    }

    try {
      const response = await authFilesApi.list();
      if (requestID !== authFilesCountRequestRef.current) return;
      setAuthFilesCount(Array.isArray(response?.files) ? response.files.length : null);
    } catch {
      if (requestID !== authFilesCountRequestRef.current) return;
      setAuthFilesCount(null);
    }
  }, [connectionStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAuthFilesCount();
    }, 0);
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, loadAuthFilesCount);

    return () => {
      authFilesCountRequestRef.current += 1;
      window.clearTimeout(timer);
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, loadAuthFilesCount);
    };
  }, [apiBase, loadAuthFilesCount]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setPaletteOpen((prev) => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 将顶部悬浮控制区高度写入 CSS 变量，供移动端粘性元素和浮层避让。
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const height = headerRef.current?.offsetHeight;
      if (height) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    updateHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && headerRef.current
        ? new ResizeObserver(updateHeaderHeight)
        : null;
    if (resizeObserver && headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  // 将主内容区的中心点写入 CSS 变量，供底部浮层（配置面板操作栏、提供商导航）对齐到内容区
  useLayoutEffect(() => {
    const updateContentCenter = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      document.documentElement.style.setProperty('--content-center-x', `${centerX}px`);
    };

    updateContentCenter();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && contentRef.current
        ? new ResizeObserver(updateContentCenter)
        : null;

    if (resizeObserver && contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    window.addEventListener('resize', updateContentCenter);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateContentCenter);
      document.documentElement.style.removeProperty('--content-center-x');
    };
  }, []);

  useEffect(() => {
    if (!languageMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setLanguageMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLanguageMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [languageMenuOpen]);

  useEffect(() => {
    if (!themeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!themeMenuRef.current?.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThemeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [themeMenuOpen]);

  const toggleLanguageMenu = useCallback(() => {
    setLanguageMenuOpen((prev) => !prev);
    setThemeMenuOpen(false);
  }, []);

  const toggleThemeMenu = useCallback(() => {
    setThemeMenuOpen((prev) => !prev);
    setLanguageMenuOpen(false);
  }, []);

  const handleThemeSelect = useCallback(
    (nextTheme: Theme) => {
      setTheme(nextTheme);
      setThemeMenuOpen(false);
    },
    [setTheme]
  );

  const handleLayoutSelect = useCallback(
    (nextLayout: WorkspaceLayout) => {
      setLayout(nextLayout);
      setThemeMenuOpen(false);
    },
    [setLayout]
  );

  const handleLanguageSelect = useCallback(
    (nextLanguage: string) => {
      if (!isSupportedLanguage(nextLanguage)) {
        return;
      }
      setLanguage(nextLanguage);
      setLanguageMenuOpen(false);
    },
    [setLanguage]
  );

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore initial failure; login flow会提示
    });
  }, [fetchConfig]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPluginResources();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPluginResources]);

  useEffect(() => {
    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);

    return () => {
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
    };
  }, [loadPluginResources]);

  const pluginResourceGroups = pluginResourceEntries.reduce<
    Array<{ pluginID: string; pluginTitle: string; entries: PluginResourceEntry[] }>
  >((groups, resource) => {
    const group = groups.find((item) => item.pluginID === resource.pluginID);
    if (group) {
      group.entries.push(resource);
      return groups;
    }

    groups.push({
      pluginID: resource.pluginID,
      pluginTitle: resource.pluginTitle,
      entries: [resource],
    });
    return groups;
  }, []);

  const pluginPageNavItems: SidebarNavItem[] = supportsPlugin
    ? pluginResourceGroups.flatMap((group): SidebarNavItem[] => {
        if (group.entries.length === 1) {
          const resource = group.entries[0];
          return [
            {
              kind: 'link',
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: sidebarIcons.plugins,
              end: true,
            },
          ];
        }

        return [
          {
            kind: 'drawer',
            id: `plugin-pages-${encodeURIComponent(group.pluginID)}`,
            label: group.pluginTitle,
            meta: t('plugin_resource.page_count', { count: group.entries.length }),
            icon: sidebarIcons.plugins,
            children: group.entries.map((resource) => ({
              kind: 'link',
              path: resource.route,
              label: resource.label,
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
              end: true,
            })),
          },
        ];
      })
    : [];

  const dashboardItem: SidebarNavItem = {
    kind: 'link',
    path: '/',
    label: t('nav.dashboard'),
    meta: t('nav_meta.dashboard'),
    icon: sidebarIcons.dashboard,
    end: true,
  };
  const coreItem: SidebarNavItem = {
    kind: 'link',
    path: '/core',
    label: t('nav.core_workspace'),
    meta: t('nav_meta.core_workspace'),
    icon: sidebarIcons.coreWorkspace,
    end: true,
  };
  const providersItem: SidebarNavItem = {
    kind: 'drawer',
    id: 'ai-providers',
    path: '/ai-providers',
    label: t('nav.ai_providers'),
    meta: t('nav_meta.ai_providers'),
    icon: sidebarIcons.aiProviders,
    children: [
      {
        kind: 'link',
        path: '/ai-providers/legacy',
        label: t('nav.provider_legacy'),
        icon: <span className="nav-sub-dot" aria-hidden="true" />,
        end: true,
      },
    ],
  };
  const authFilesItem: SidebarNavItem = {
    kind: 'link',
    path: '/auth-files',
    label: t('nav.auth_files'),
    meta: t('nav_meta.auth_files'),
    badge: authFilesCount ?? undefined,
    icon: sidebarIcons.authFiles,
  };
  const oauthItem: SidebarNavItem = {
    kind: 'link',
    path: '/oauth',
    label: t('nav.oauth', { defaultValue: 'OAuth' }),
    meta: t('nav_meta.oauth'),
    icon: sidebarIcons.oauth,
  };
  const quotaItem: SidebarNavItem = {
    kind: 'link',
    path: '/quota',
    label: t('nav.quota_management'),
    meta: t('nav_meta.quota_management'),
    icon: sidebarIcons.quota,
  };
  const usageItem: SidebarNavItem = {
    kind: 'drawer',
    id: 'usage',
    path: '/usage',
    label: t('nav.usage_stats'),
    meta: t('nav_meta.usage_stats'),
    icon: sidebarIcons.usage,
    children: [
      {
        kind: 'link',
        path: '/usage/pricing',
        label: t('usage_stats.pricing_title'),
        icon: <span className="nav-sub-dot" aria-hidden="true" />,
        end: true,
      },
    ],
  };
  const logsItem: SidebarNavItem = {
    kind: 'link',
    path: '/logs',
    label: t('nav.logs'),
    meta: t('nav_meta.logs'),
    icon: sidebarIcons.logs,
  };
  const configItem: SidebarNavItem = {
    kind: 'link',
    path: '/config',
    label: t('nav.config_management'),
    meta: t('nav_meta.config_management'),
    icon: sidebarIcons.config,
  };
  const pluginItems: SidebarNavItem[] = supportsPlugin
    ? [
        {
          kind: 'drawer',
          id: 'plugins',
          path: '/plugins',
          label: t('nav.plugins'),
          meta: t('nav_meta.plugins'),
          icon: sidebarIcons.plugins,
          children: [
            {
              kind: 'link',
              path: '/plugin-store',
              label: t('nav.plugin_store'),
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
              end: true,
            },
          ],
        },
      ]
    : showPluginRuntimeDiagnostic
      ? [
          {
            kind: 'link',
            path: '/plugins',
            label: t('nav.plugins_runtime_unavailable'),
            icon: sidebarIcons.plugins,
          },
        ]
      : [];
  const systemItem: SidebarNavItem = {
    kind: 'link',
    path: '/system',
    label: t('nav.system_info'),
    meta: t('nav_meta.system_info'),
    icon: sidebarIcons.system,
  };

  const groupsByLayout: Record<WorkspaceLayout, SidebarNavGroup[]> = {
    tower: [
      { id: 'command', label: t('workspace.group_command'), items: [dashboardItem, coreItem] },
      {
        id: 'gateway',
        label: t('workspace.group_gateway'),
        items: [providersItem, authFilesItem, oauthItem, configItem],
      },
      {
        id: 'observe',
        label: t('workspace.group_observe'),
        items: [quotaItem, usageItem, logsItem],
      },
      {
        id: 'runtime',
        label: t('workspace.group_runtime'),
        items: [...pluginItems, systemItem],
      },
    ],
    studio: [
      {
        id: 'studio',
        label: t('workspace.group_workspace'),
        items: [dashboardItem, coreItem, providersItem],
      },
      {
        id: 'accounts',
        label: t('workspace.group_accounts'),
        items: [oauthItem, authFilesItem, quotaItem],
      },
      { id: 'insights', label: t('workspace.group_insights'), items: [usageItem, logsItem] },
      {
        id: 'settings',
        label: t('workspace.group_settings'),
        items: [configItem, ...pluginItems, systemItem],
      },
    ],
    console: [
      { id: 'access', label: t('workspace.scope_access'), items: [dashboardItem, configItem] },
      {
        id: 'credentials',
        label: t('workspace.scope_credentials'),
        items: [oauthItem, authFilesItem, providersItem],
      },
      { id: 'policy', label: t('workspace.scope_policy'), items: [coreItem, quotaItem] },
      { id: 'observe', label: t('workspace.scope_observe'), items: [usageItem, logsItem] },
      { id: 'extend', label: t('workspace.scope_extend'), items: [...pluginItems, systemItem] },
    ],
  };

  const navGroups: SidebarNavGroup[] = [
    ...groupsByLayout[layout],
    ...(pluginPageNavItems.length > 0
      ? [
          {
            id: 'plugin-pages',
            label: t('nav_groups.plugin_pages'),
            placement: 'bottom' as const,
            items: pluginPageNavItems,
          },
        ]
      : []),
  ];
  const navOrder = flattenSidebarNavPaths(navGroups);
  const sidebarNavigationKey = navOrder.join('|');

  const palettePages: Array<{
    path: string;
    label: string;
    meta?: string;
    icon: ReactNode;
  }> = [];
  navGroups.forEach((group) => {
    group.items.forEach((item) => {
      if (item.kind === 'link') {
        palettePages.push({ path: item.path, label: item.label, meta: item.meta, icon: item.icon });
        return;
      }
      if (item.path) {
        palettePages.push({ path: item.path, label: item.label, meta: item.meta, icon: item.icon });
      }
      item.children.forEach((child) => {
        palettePages.push({
          path: child.path,
          label: child.label,
          meta: child.meta,
          icon: child.icon,
        });
      });
    });
  });

  const getRouteOrder = (pathname: string) => {
    const trimmedPath =
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const normalizedPath = trimmedPath === '/dashboard' ? '/' : trimmedPath;

    const aiProvidersIndex = navOrder.indexOf('/ai-providers');
    if (aiProvidersIndex !== -1) {
      if (normalizedPath === '/ai-providers' || normalizedPath === '/ai-providers/workbench') {
        return aiProvidersIndex;
      }

      const legacyProvidersIndex = navOrder.indexOf('/ai-providers/legacy');
      const legacyBaseIndex =
        legacyProvidersIndex === -1 ? aiProvidersIndex + 0.05 : legacyProvidersIndex;
      const legacyPrefix = normalizedPath.startsWith('/ai-providers/legacy')
        ? '/ai-providers/legacy'
        : '/ai-providers';
      if (normalizedPath.startsWith(`${legacyPrefix}/`) || normalizedPath === legacyPrefix) {
        const legacyRoute = normalizedPath.slice(legacyPrefix.length);
        if (legacyRoute.startsWith('/gemini')) return legacyBaseIndex + 0.1;
        if (legacyRoute.startsWith('/codex')) return legacyBaseIndex + 0.2;
        if (legacyRoute.startsWith('/claude')) return legacyBaseIndex + 0.3;
        if (legacyRoute.startsWith('/vertex')) return legacyBaseIndex + 0.4;
        if (legacyRoute.startsWith('/ampcode')) return legacyBaseIndex + 0.5;
        if (legacyRoute.startsWith('/openai')) return legacyBaseIndex + 0.6;
        return legacyBaseIndex;
      }
    }

    const authFilesIndex = navOrder.indexOf('/auth-files');
    if (authFilesIndex !== -1) {
      if (normalizedPath === '/auth-files') return authFilesIndex;
      if (normalizedPath.startsWith('/auth-files/')) {
        if (normalizedPath.startsWith('/auth-files/oauth-excluded')) return authFilesIndex + 0.1;
        if (normalizedPath.startsWith('/auth-files/oauth-model-alias')) return authFilesIndex + 0.2;
        return authFilesIndex + 0.05;
      }
    }

    const exactIndex = navOrder.indexOf(normalizedPath);
    if (exactIndex !== -1) return exactIndex;
    const nestedIndex = navOrder.findIndex(
      (path) => path !== '/' && normalizedPath.startsWith(`${path}/`)
    );
    return nestedIndex === -1 ? null : nestedIndex;
  };

  const getTransitionVariant = useCallback((fromPathname: string, toPathname: string) => {
    const normalize = (pathname: string) => {
      const trimmed =
        pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      return trimmed === '/dashboard' ? '/' : trimmed;
    };

    const from = normalize(fromPathname);
    const to = normalize(toPathname);
    const isAuthFiles = (pathname: string) =>
      pathname === '/auth-files' || pathname.startsWith('/auth-files/');
    const isAiProviders = (pathname: string) =>
      pathname === '/ai-providers' || pathname.startsWith('/ai-providers/');
    const isPlugins = (pathname: string) =>
      pathname === '/plugins' ||
      pathname === '/plugin-store' ||
      pathname.startsWith('/plugin-pages/');
    if (isAuthFiles(from) && isAuthFiles(to)) return 'ios';
    if (isAiProviders(from) && isAiProviders(to)) return 'ios';
    if (isPlugins(from) && isPlugins(to)) return 'ios';
    return 'vertical';
  }, []);

  const handleRefreshAll = async () => {
    clearCache();
    const results = await Promise.allSettled([
      fetchConfig(undefined, true),
      triggerHeaderRefresh(),
      loadPluginResources(),
      loadAuthFilesCount(),
    ]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason;
      const message =
        typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    }
    showNotification(t('notification.data_refreshed'), 'success');
  };

  const paletteActions = [
    {
      id: 'refresh',
      label: t('header.refresh_all'),
      icon: headerIcons.refresh,
      run: () => void handleRefreshAll(),
    },
    ...LAYOUT_CARDS.map((item) => ({
      id: `layout-${item.key}`,
      label: `${t('workspace.switch')} · ${t(item.labelKey)}`,
      icon: headerIcons.layout,
      run: () => setLayout(item.key),
    })),
    ...THEME_CARDS.map((item) => ({
      id: `theme-${item.key}`,
      label: `${t('theme.switch')} · ${t(item.labelKey)}`,
      icon: headerIcons.sun,
      run: () => setTheme(item.key),
    })),
    ...LANGUAGE_ORDER.map((lang) => ({
      id: `language-${lang}`,
      label: `${t('language.switch')} · ${t(LANGUAGE_LABEL_KEYS[lang])}`,
      icon: headerIcons.language,
      run: () => setLanguage(lang),
    })),
    {
      id: 'logout',
      label: t('header.logout'),
      icon: headerIcons.logout,
      run: () => logout(),
    },
  ];
  const mobileSidebarToggleLabel = sidebarOpen
    ? t('sidebar.toggle_collapse', { defaultValue: 'Close navigation' })
    : t('sidebar.toggle_expand', { defaultValue: 'Open navigation' });
  const routingStatusText = config?.routingStrategy?.trim() || 'round-robin';
  const requestRetryText = String(config?.requestRetry ?? 0);
  const quotaFallbackEnabled = Boolean(
    config?.quotaExceeded?.switchProject ||
      config?.quotaExceeded?.switchPreviewModel ||
      config?.quotaExceeded?.antigravityCredits
  );
  const toggleSidebarMode = () => {
    setSidebarMode((current) => (current === 'compact' ? 'classic' : 'compact'));
  };
  const paletteShortcutLabel =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? '⌘K'
      : 'Ctrl K';

  return (
    <div
      className={`app-shell layout-${layout} sidebar-mode-${effectiveSidebarMode} ${
        sidebarCollapsed ? 'sidebar-is-collapsed' : ''
      }`}
      data-workspace-layout={layout}
    >
      <div className="top-gradient-blur" aria-hidden="true" />

      <header className="main-header" ref={headerRef}>
        <button
          type="button"
          className="sidebar-toggle-floating"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          title={
            sidebarCollapsed
              ? t('sidebar.expand', { defaultValue: '展开' })
              : t('sidebar.collapse', { defaultValue: '收起' })
          }
          aria-label={
            sidebarCollapsed
              ? t('sidebar.expand', { defaultValue: '展开' })
              : t('sidebar.collapse', { defaultValue: '收起' })
          }
        >
          {sidebarCollapsed ? headerIcons.chevronRight : headerIcons.chevronLeft}
        </button>

        <div className="mobile-sidebar-actions">
          <Button
            className="mobile-menu-btn"
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen((prev) => !prev)}
            title={mobileSidebarToggleLabel}
            aria-label={mobileSidebarToggleLabel}
          >
            {sidebarOpen ? headerIcons.close : headerIcons.menu}
          </Button>
        </div>

        <div className="header-actions floating-actions">
          <button
            type="button"
            className="palette-trigger"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('command_palette.open')}
            title={t('command_palette.open')}
          >
            <span className="palette-trigger-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <span className="palette-trigger-label">{t('command_palette.open')}</span>
            <kbd className="palette-trigger-kbd">{paletteShortcutLabel}</kbd>
          </button>
          <span
            className="connection-pill"
            data-status={connectionStatus}
            title={t('header.connection_status')}
          >
            <span className="connection-pill-dot" aria-hidden="true" />
            <span className="connection-pill-label">
              {connectionStatus === 'connected'
                ? t('common.connected')
                : connectionStatus === 'connecting'
                  ? t('common.connecting')
                  : t('common.disconnected')}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshAll}
            title={t('header.refresh_all')}
          >
            {headerIcons.refresh}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="sidebar-mode-toggle"
            onClick={toggleSidebarMode}
            title={sidebarModeToggleLabel}
            aria-label={sidebarModeToggleLabel}
            aria-pressed={isCompactSidebar}
          >
            {isCompactSidebar ? <IconMaximize2 size={16} /> : <IconMinimize2 size={16} />}
          </Button>
          <div className={`language-menu ${languageMenuOpen ? 'open' : ''}`} ref={languageMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguageMenu}
              title={t('language.switch')}
              aria-label={t('language.switch')}
              aria-haspopup="menu"
              aria-expanded={languageMenuOpen}
            >
              {headerIcons.language}
            </Button>
            {languageMenuOpen && (
              <div
                className="notification entering language-menu-popover"
                role="menu"
                aria-label={t('language.switch')}
              >
                {LANGUAGE_ORDER.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={`language-menu-option ${language === lang ? 'active' : ''}`}
                    onClick={() => handleLanguageSelect(lang)}
                    role="menuitemradio"
                    aria-checked={language === lang}
                  >
                    <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
                    {language === lang ? <span className="language-menu-check">✓</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`theme-menu ${themeMenuOpen ? 'open' : ''}`} ref={themeMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleThemeMenu}
              title={t('theme.switch')}
              aria-label={t('theme.switch')}
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
            >
              {headerIcons.layout}
            </Button>
            {themeMenuOpen && (
              <div
                className="notification entering theme-menu-popover appearance-menu-popover"
                role="menu"
                aria-label={t('workspace.appearance')}
              >
                <section className="appearance-menu-section">
                  <div className="appearance-menu-heading">{t('workspace.layout_heading')}</div>
                  <div className="layout-card-grid">
                    {LAYOUT_CARDS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`layout-card ${layout === item.key ? 'active' : ''}`}
                        onClick={() => handleLayoutSelect(item.key)}
                        role="menuitemradio"
                        aria-checked={layout === item.key}
                      >
                        <span
                          className={`layout-card-preview preview-${item.key}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="layout-card-copy">
                          <strong>{t(item.labelKey)}</strong>
                          <small>{t(item.descriptionKey)}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="appearance-menu-section">
                  <div className="appearance-menu-heading">{t('workspace.theme_heading')}</div>
                  <div className="theme-card-grid">
                    {THEME_CARDS.map((tc) => (
                      <button
                        key={tc.key}
                        type="button"
                        className={`theme-card ${theme === tc.key ? 'active' : ''}`}
                        onClick={() => handleThemeSelect(tc.key)}
                        role="menuitemradio"
                        aria-checked={theme === tc.key}
                      >
                        <div
                          className="theme-card-preview"
                          style={{
                            background: tc.colors.bg,
                            border: `1px solid ${tc.colors.border}`,
                          }}
                        >
                          <div
                            className="theme-card-header"
                            style={{
                              background: tc.colors.card,
                              borderBottom: `1px solid ${tc.colors.border}`,
                            }}
                          />
                          <div className="theme-card-body">
                            <div
                              className="theme-card-sidebar"
                              style={{
                                background: tc.colors.card,
                                borderRight: `1px solid ${tc.colors.border}`,
                              }}
                            />
                            <div
                              className="theme-card-content"
                              style={{ background: tc.colors.bg }}
                            >
                              <div
                                className="theme-card-line"
                                style={{ background: tc.colors.textMuted }}
                              />
                              <div
                                className="theme-card-line short"
                                style={{ background: tc.colors.textMuted }}
                              />
                            </div>
                          </div>
                        </div>
                        <span className="theme-card-label">{t(tc.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={logout} title={t('header.logout')}>
            {headerIcons.logout}
          </Button>
        </div>
      </header>

      <div className="main-body">
        <button
          type="button"
          className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-label={t('common.close')}
          aria-hidden={!sidebarOpen}
          tabIndex={sidebarOpen ? 0 : -1}
        />

        <aside
          className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}
        >
          <div className="sidebar-brand" title={fullBrandName}>
            <img src={INLINE_LOGO_JPEG} alt="CPAMC logo" className="sidebar-brand-logo" />
            {showSidebarLabels && (
              <span className="sidebar-brand-text">
                <span className="sidebar-brand-title">{abbrBrandName}</span>
                <span className="sidebar-brand-subtitle">{t('sidebar.subtitle')}</span>
              </span>
            )}
          </div>

          <SidebarNavigation
            key={sidebarNavigationKey}
            groups={navGroups}
            collapsed={sidebarCollapsed}
            showLabels={showSidebarLabels}
            showMeta={!isCompactSidebar}
            ariaLabel={t('sidebar.primary_navigation')}
            onNavigate={() => setSidebarOpen(false)}
            onRequestExpand={() => setSidebarCollapsed(false)}
          />

          {layout === 'studio' && showSidebarLabels && (
            <div className="studio-provider-dock">
              <span className="studio-provider-dock-label">{t('workspace.provider_dock')}</span>
              <div className="studio-provider-dock-grid">
                <Link
                  to="/oauth?provider=anthropic"
                  title="Claude Code OAuth"
                  data-provider="claude"
                >
                  CC
                </Link>
                <Link to="/oauth?provider=codex" title="Codex OAuth" data-provider="codex">
                  CX
                </Link>
                <Link
                  to="/oauth?provider=gemini-cli"
                  title="Gemini CLI OAuth"
                  data-provider="gemini"
                >
                  GM
                </Link>
                <Link
                  to="/ai-providers?provider=claudeApi"
                  title={t('nav.ai_providers')}
                  data-provider="api"
                >
                  API
                </Link>
              </div>
              <small>{t('workspace.provider_dock_hint')}</small>
            </div>
          )}
        </aside>

        {layout === 'console' && <CoreScopeRail supportsPlugin={supportsPlugin} />}

        <div className={`content${isLogsPage ? ' content-logs' : ''}`} ref={contentRef}>
          <main className={`main-content${isLogsPage ? ' main-content-logs' : ''}`}>
            <PageTransition
              render={(location) => <MainRoutes location={location} />}
              getRouteOrder={getRouteOrder}
              getTransitionVariant={getTransitionVariant}
              scrollContainerRef={contentRef}
            />
          </main>
        </div>
      </div>

      {layout === 'tower' && (
        <footer className="tower-runtime-bar" aria-label={t('workspace.runtime_status')}>
          <span className="tower-runtime-label">CPA-Core-LTS</span>
          <Link to="/config" className="tower-runtime-item">
            <span>{t('workspace.runtime_routing')}</span>
            <strong>{routingStatusText}</strong>
          </Link>
          <Link to="/config" className="tower-runtime-item">
            <span>{t('workspace.runtime_retry')}</span>
            <strong>{requestRetryText}</strong>
          </Link>
          <Link to="/config" className="tower-runtime-item">
            <span>{t('workspace.runtime_fallback')}</span>
            <strong>
              {quotaFallbackEnabled
                ? t('workspace.runtime_enabled')
                : t('workspace.runtime_disabled')}
            </strong>
          </Link>
          <Link to="/system" className="tower-runtime-item" data-status={connectionStatus}>
            <span>{t('workspace.runtime_connection')}</span>
            <strong>
              <i aria-hidden="true" />
              {connectionStatus === 'connected'
                ? t('common.connected')
                : connectionStatus === 'connecting'
                  ? t('common.connecting_status')
                  : t('common.disconnected')}
            </strong>
          </Link>
        </footer>
      )}

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          pages={palettePages}
          actions={paletteActions}
        />
      )}
    </div>
  );
}
