import { useTranslation } from 'react-i18next';
import { useId } from 'react';
import { useAuthStore } from '@/stores';
import { readProfiles } from '@/services/storage/connectionProfiles';
import { getManagedConnection } from '@/services/connectionRuntime';
import styles from './PanelShell.module.scss';

export function ConnectionSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const profileId = useAuthStore((state) => state.profileId);
  const apiBase = useAuthStore((state) => state.apiBase);
  const status = useAuthStore((state) => state.connectionStatus);
  const connection = getManagedConnection();
  const profile =
    connection?.bootstrap.profile || readProfiles().find((item) => item.id === profileId);
  return (
    <button
      data-connection-switcher
      className={`${styles.selector} ${collapsed ? styles.collapsed : ''}`}
      aria-label={t('connections.switch')}
      aria-describedby={descriptionId}
      aria-haspopup="dialog"
      title={`${profile?.name || apiBase || t('connections.choose')} · ${t(`connections.${status}`)}`}
      onClick={() => {
        if (connection) connection.host.open(connection.id, window);
        else window.dispatchEvent(new Event('cpa-open-connections'));
      }}
    >
      <span className={styles.instanceIcon} aria-hidden="true">
        {(profile?.name || 'CPA').slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.selectorText} id={descriptionId}>
        <strong>{profile?.name || apiBase || t('connections.choose')}</strong>
        <small>
          <i className={styles.dot} data-status={status} />
          {t(`connections.${status}`)}
          {profile?.environment ? ` · ${profile.environment}` : ''}
        </small>
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ⌃
      </span>
    </button>
  );
}
