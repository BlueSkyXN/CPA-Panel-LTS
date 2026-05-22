import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { CodexRemoteCloudConnectEnvironment } from '@/services/api';
import styles from '@/pages/AuthFilesPage.module.scss';

export type CodexRemoteCloudConnectEnvironmentsModalProps = {
  open: boolean;
  fileName: string;
  loading: boolean;
  error: string | null;
  environments: CodexRemoteCloudConnectEnvironment[];
  truncated: boolean;
  deletingId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onCopyText: (text: string) => void | Promise<void>;
  onDelete: (environment: CodexRemoteCloudConnectEnvironment) => void;
};

const EMPTY_VALUE = '-';
type CodexRemoteCloudConnectEnvironmentViewMode = 'list' | 'vertical' | 'grid';

const VIEW_MODE_OPTIONS: CodexRemoteCloudConnectEnvironmentViewMode[] = [
  'list',
  'vertical',
  'grid',
];

const formatTime = (value: string | null) => {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const joinValues = (...values: Array<string | null>) => {
  const filtered = values.filter(Boolean);
  return filtered.length ? filtered.join(' ') : EMPTY_VALUE;
};

export function CodexRemoteCloudConnectEnvironmentsModal(
  props: CodexRemoteCloudConnectEnvironmentsModalProps
) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<CodexRemoteCloudConnectEnvironmentViewMode>('list');
  const {
    open,
    fileName,
    loading,
    error,
    environments,
    truncated,
    deletingId,
    onClose,
    onRefresh,
    onCopyText,
    onDelete,
  } = props;

  const listModeClass = {
    list: styles.codexRemoteCloudConnectEnvironmentListDense,
    vertical: styles.codexRemoteCloudConnectEnvironmentListVertical,
    grid: styles.codexRemoteCloudConnectEnvironmentListGrid,
  }[viewMode];
  const itemModeClass = {
    list: styles.codexRemoteCloudConnectEnvironmentItemDense,
    vertical: styles.codexRemoteCloudConnectEnvironmentItemVertical,
    grid: styles.codexRemoteCloudConnectEnvironmentItemGrid,
  }[viewMode];
  const metaGridModeClass = {
    list: styles.codexRemoteCloudConnectEnvironmentMetaGridDense,
    vertical: styles.codexRemoteCloudConnectEnvironmentMetaGridVertical,
    grid: styles.codexRemoteCloudConnectEnvironmentMetaGridCard,
  }[viewMode];

  const renderMeta = (
    labelKey: string,
    value: string | null,
    options?: { wide?: boolean; title?: string }
  ) => (
    <div
      className={`${styles.codexRemoteCloudConnectEnvironmentMeta} ${options?.wide ? styles.codexRemoteCloudConnectEnvironmentMetaWide : ''}`}
    >
      <span>{t(labelKey)}</span>
      <strong title={options?.title ?? value ?? undefined}>{value || EMPTY_VALUE}</strong>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="min(1120px, calc(100vw - 32px))"
      className={styles.codexRemoteCloudConnectEnvironmentModal}
      title={t('auth_files.codex_remote_cloud_connect_environment_title', {
        name: fileName || EMPTY_VALUE,
      })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className={styles.codexRemoteCloudConnectEnvironmentLoading}>
          <LoadingSpinner size={14} />
          <span>{t('auth_files.codex_remote_cloud_connect_environment_loading')}</span>
        </div>
      ) : error ? (
        <div className={styles.prefixProxyError}>{error}</div>
      ) : environments.length === 0 ? (
        <EmptyState
          title={t('auth_files.codex_remote_cloud_connect_environment_empty')}
          description={t('auth_files.codex_remote_cloud_connect_environment_empty_desc')}
        />
      ) : (
        <div className={styles.codexRemoteCloudConnectEnvironmentPanel}>
          <div className={styles.codexRemoteCloudConnectEnvironmentToolbar}>
            <span className={styles.codexRemoteCloudConnectEnvironmentCount}>
              {t('auth_files.codex_remote_cloud_connect_environment_count', {
                count: environments.length,
              })}
            </span>
            <div
              className={styles.codexRemoteCloudConnectEnvironmentViewSwitch}
              aria-label={t('auth_files.codex_remote_cloud_connect_environment_view_mode_label')}
            >
              {VIEW_MODE_OPTIONS.map((mode) => (
                <Button
                  key={mode}
                  variant="secondary"
                  size="sm"
                  className={`${styles.codexRemoteCloudConnectEnvironmentViewButton} ${
                    viewMode === mode
                      ? styles.codexRemoteCloudConnectEnvironmentViewButtonActive
                      : ''
                  }`}
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                >
                  {t(`auth_files.codex_remote_cloud_connect_environment_view_${mode}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className={`${styles.codexRemoteCloudConnectEnvironmentList} ${listModeClass}`}>
            {truncated && (
              <div className={styles.codexRemoteCloudConnectEnvironmentWarning}>
                {t('auth_files.codex_remote_cloud_connect_environment_page_truncated')}
              </div>
            )}
            {environments.map((environment) => {
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
              const onlineClass =
                environment.online === true
                  ? styles.codexRemoteCloudConnectEnvironmentBadgeOnline
                  : environment.online === false
                    ? styles.codexRemoteCloudConnectEnvironmentBadgeOffline
                    : styles.codexRemoteCloudConnectEnvironmentBadgeUnknown;
              const busyClass =
                environment.busy === true
                  ? styles.codexRemoteCloudConnectEnvironmentBadgeBusy
                  : environment.busy === false
                    ? styles.codexRemoteCloudConnectEnvironmentBadgeIdle
                    : styles.codexRemoteCloudConnectEnvironmentBadgeUnknown;

              return (
                <div
                  key={environment.envId}
                  className={`${styles.codexRemoteCloudConnectEnvironmentItem} ${itemModeClass} ${
                    environment.isLikelyStale
                      ? styles.codexRemoteCloudConnectEnvironmentItemStale
                      : ''
                  }`}
                >
                  <div className={styles.codexRemoteCloudConnectEnvironmentHeader}>
                    <div className={styles.codexRemoteCloudConnectEnvironmentTitle}>
                      <span className={styles.codexRemoteCloudConnectEnvironmentName}>
                        {environment.name}
                      </span>
                      <span className={styles.codexRemoteCloudConnectEnvironmentSubhead}>
                        {environment.hostName || environment.envId}
                      </span>
                    </div>
                    <div className={styles.codexRemoteCloudConnectEnvironmentBadges}>
                      <span
                        className={`${styles.codexRemoteCloudConnectEnvironmentBadge} ${onlineClass}`}
                      >
                        {onlineLabel}
                      </span>
                      <span
                        className={`${styles.codexRemoteCloudConnectEnvironmentBadge} ${busyClass}`}
                      >
                        {busyLabel}
                      </span>
                      {environment.isLikelyStale && (
                        <span
                          className={`${styles.codexRemoteCloudConnectEnvironmentBadge} ${styles.codexRemoteCloudConnectEnvironmentBadgeStale}`}
                        >
                          {t('auth_files.codex_remote_cloud_connect_environment_likely_stale')}
                        </span>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void onCopyText(environment.envId)}
                      >
                        {t('auth_files.codex_remote_cloud_connect_environment_copy_id')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={deletingId === environment.envId}
                        disabled={Boolean(deletingId)}
                        onClick={() => onDelete(environment)}
                      >
                        {t('auth_files.codex_remote_cloud_connect_environment_delete_button')}
                      </Button>
                    </div>
                  </div>

                  {environment.isLikelyStale && (
                    <div className={styles.codexRemoteCloudConnectEnvironmentStaleHint}>
                      {t('auth_files.codex_remote_cloud_connect_environment_stale_hint')}
                    </div>
                  )}

                  <div
                    className={`${styles.codexRemoteCloudConnectEnvironmentMetaGrid} ${metaGridModeClass}`}
                  >
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_id',
                      environment.envId,
                      {
                        wide: true,
                        title: environment.envId,
                      }
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_kind',
                      environment.kind
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_display_name',
                      environment.displayName
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_host_name',
                      environment.hostName
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_app_server_version',
                      environment.appServerVersion
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_client_type',
                      environment.clientType
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_client_name',
                      joinValues(environment.clientName, environment.clientVersion)
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_os',
                      joinValues(environment.os, environment.osVersion)
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_arch',
                      environment.arch
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_originator',
                      environment.originator
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_terminal',
                      environment.terminal
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_installation_id',
                      environment.installationId,
                      {
                        title: environment.installationId ?? undefined,
                      }
                    )}
                    {renderMeta(
                      'auth_files.codex_remote_cloud_connect_environment_last_seen_at',
                      formatTime(environment.lastSeenAt)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
