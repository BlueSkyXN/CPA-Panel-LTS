import { useTranslation } from 'react-i18next';
import type { CodexRemoteCloudConnectEnvironment } from '@/services/api';
import type { CodexRemoteCloudConnectCleanupAdvice } from '@/features/authFiles/utils/codexRemoteCloudConnectEnvironmentView';
import styles from '@/pages/AuthFilesPage.module.scss';

type CodexRemoteCloudConnectEnvironmentDeleteDetailsProps = {
  environment: CodexRemoteCloudConnectEnvironment;
  advice: CodexRemoteCloudConnectCleanupAdvice;
};

const EMPTY_VALUE = '-';

const formatTime = (value: string | null) => {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export function CodexRemoteCloudConnectEnvironmentDeleteDetails({
  environment,
  advice,
}: CodexRemoteCloudConnectEnvironmentDeleteDetailsProps) {
  const { t } = useTranslation();
  const isActive = environment.online === true || environment.busy === true;
  const onlineLabel =
    environment.online === true
      ? t('auth_files.codex_remote_cloud_connect_environment_online')
      : environment.online === false
        ? t('auth_files.codex_remote_cloud_connect_environment_offline')
        : t('auth_files.codex_remote_cloud_connect_environment_unknown');
  const busyLabel =
    environment.busy === true
      ? t('auth_files.codex_remote_cloud_connect_environment_busy')
      : environment.busy === false
        ? t('auth_files.codex_remote_cloud_connect_environment_idle')
        : t('auth_files.codex_remote_cloud_connect_environment_unknown');

  const detailRows = [
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_host_name'),
      value: environment.hostName || environment.name || EMPTY_VALUE,
    },
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_id'),
      value: environment.envId,
    },
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_online'),
      value: onlineLabel,
    },
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_busy'),
      value: busyLabel,
    },
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_app_server_version'),
      value: environment.appServerVersion || EMPTY_VALUE,
    },
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_last_seen_at'),
      value: formatTime(environment.lastSeenAt),
    },
    {
      label: t('auth_files.codex_remote_cloud_connect_environment_cleanup_advice_label'),
      value: t(
        `auth_files.codex_remote_cloud_connect_environment_advice_${advice.level}`
      ),
    },
  ];

  return (
    <div className={styles.codexRemoteCloudConnectEnvironmentDeleteDetails}>
      <p>{t('auth_files.codex_remote_cloud_connect_environment_delete_second_message')}</p>
      {isActive && (
        <div className={styles.codexRemoteCloudConnectEnvironmentDeleteActiveWarning}>
          {t('auth_files.codex_remote_cloud_connect_environment_delete_active_warning')}
        </div>
      )}
      <dl>
        {detailRows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.codexRemoteCloudConnectEnvironmentDeleteReasons}>
        <span>{t('auth_files.codex_remote_cloud_connect_environment_advice_reasons')}</span>
        <ul>
          {advice.reasons.map((reason) => (
            <li key={reason}>
              {t(`auth_files.codex_remote_cloud_connect_environment_reason_${reason}`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
