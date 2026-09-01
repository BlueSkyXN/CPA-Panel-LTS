import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconChartLine,
  IconFileText,
  IconKey,
  IconModelCluster,
  IconPlug,
  IconScrollText,
  IconSettings,
  IconShield,
} from '@/components/ui/icons';

interface CoreScopeRailProps {
  supportsPlugin: boolean;
}

interface CoreScopeItem {
  path: string;
  label: string;
  meta: string;
  icon: ReactNode;
}

interface CoreScopeGroup {
  id: string;
  label: string;
  items: CoreScopeItem[];
}

const isCurrentScope = (pathname: string, search: string, target: string) => {
  const targetUrl = new URL(target, 'https://core.local');
  const pathMatches =
    pathname === targetUrl.pathname || pathname.startsWith(`${targetUrl.pathname}/`);
  if (!pathMatches) return false;

  const targetSection = targetUrl.searchParams.get('section');
  if (!targetSection) return true;
  const currentParams = new URLSearchParams(search);
  if (currentParams.get('section') !== targetSection) return false;

  const targetSubsection = targetUrl.searchParams.get('subsection');
  return !targetSubsection || currentParams.get('subsection') === targetSubsection;
};

export function CoreScopeRail({ supportsPlugin }: CoreScopeRailProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const groups: CoreScopeGroup[] = [
    {
      id: 'access',
      label: t('workspace.scope_access'),
      items: [
        {
          path: '/config?section=auth&subsection=auth-remote',
          label: t('workspace.scope_management'),
          meta: 'remote-management · TLS · api-keys',
          icon: <IconShield size={15} />,
        },
      ],
    },
    {
      id: 'credentials',
      label: t('workspace.scope_credentials'),
      items: [
        {
          path: '/oauth?provider=anthropic',
          label: t('workspace.scope_oauth'),
          meta: 'Claude Code · Codex · Gemini CLI',
          icon: <IconKey size={15} />,
        },
        {
          path: '/auth-files',
          label: t('workspace.scope_auth_files'),
          meta: 'auth-dir · runtime credentials',
          icon: <IconFileText size={15} />,
        },
        {
          path: '/ai-providers',
          label: t('workspace.scope_api_pools'),
          meta: '*-api-key · OpenAI compatible',
          icon: <IconModelCluster size={15} />,
        },
      ],
    },
    {
      id: 'policy',
      label: t('workspace.scope_policy'),
      items: [
        {
          path: '/config?section=system&subsection=headers',
          label: t('workspace.scope_provider_behavior'),
          meta: 'claude-code · codex · xai',
          icon: <IconSettings size={15} />,
        },
        {
          path: '/config?section=quota',
          label: t('workspace.scope_routing'),
          meta: 'routing · retry · quota-exceeded',
          icon: <IconKey size={15} />,
        },
      ],
    },
    {
      id: 'observe',
      label: t('workspace.scope_observe'),
      items: [
        {
          path: '/usage',
          label: t('nav.usage_stats'),
          meta: 'complete usage · import/export',
          icon: <IconChartLine size={15} />,
        },
        {
          path: '/logs',
          label: t('nav.logs'),
          meta: 'request log · error files',
          icon: <IconScrollText size={15} />,
        },
      ],
    },
    ...(supportsPlugin
      ? [
          {
            id: 'extend',
            label: t('workspace.scope_extend'),
            items: [
              {
                path: '/plugins',
                label: t('nav.plugins'),
                meta: 'capability-gated runtime',
                icon: <IconPlug size={15} />,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <aside className="core-scope-rail" aria-label={t('workspace.scope_tree')}>
      <div className="core-scope-rail-head">
        <span className="core-scope-rail-kicker">CPA-Core-LTS</span>
        <strong>{t('workspace.scope_tree')}</strong>
        <small>{t('workspace.scope_tree_hint')}</small>
      </div>
      <nav className="core-scope-tree">
        {groups.map((group) => (
          <section key={group.id} className="core-scope-group">
            <div className="core-scope-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={`${group.id}-${item.path}-${item.label}`}
                to={item.path}
                className={`core-scope-item ${
                  isCurrentScope(location.pathname, location.search, item.path) ? 'active' : ''
                }`}
              >
                <span className="core-scope-icon">{item.icon}</span>
                <span className="core-scope-copy">
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                </span>
              </Link>
            ))}
          </section>
        ))}
      </nav>
    </aside>
  );
}
