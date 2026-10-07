import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import styles from './AnalyticsPage.module.scss';

export function AnalyticsLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const supported = useAuthStore((state) => state.flowSupportKnown && state.supportsFlowControl);
  const pages = [
    { path: '/analytics/observability', label: 'observability' },
    ...(supported
      ? [
          { path: '/analytics/flow', label: 'flow_dashboard' },
          { path: '/analytics/flow/config', label: 'flow_config' },
        ]
      : []),
  ];
  return (
    <div className={styles.container}>
      <div className={styles.heading}>{t('analytics.title')}</div>
      <nav className={styles.tabs} aria-label={t('analytics.title')}>
        {pages.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            end
            className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}
          >
            {t(`analytics.${label}`)}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
