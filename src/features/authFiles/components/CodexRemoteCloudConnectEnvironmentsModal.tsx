import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw } from '@/components/ui/icons';
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
type CodexRemoteCloudConnectEnvironmentViewSelection = {
  fileName: string;
  count: number;
  mode: CodexRemoteCloudConnectEnvironmentViewMode;
};

const VIEW_MODE_OPTIONS: CodexRemoteCloudConnectEnvironmentViewMode[] = [
  'list',
  'vertical',
  'grid',
];

const resolveDefaultViewMode = (
  count: number
): CodexRemoteCloudConnectEnvironmentViewMode => {
  if (count === 1 || count === 3) return 'vertical';
  if (count === 2 || count === 4) return 'grid';
  return 'list';
};

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
  const [viewModeSelection, setViewModeSelection] =
    useState<CodexRemoteCloudConnectEnvironmentViewSelection | null>(null);
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

  const defaultViewMode = resolveDefaultViewMode(environments.length);
  const viewMode =
    viewModeSelection?.fileName === fileName && viewModeSelection.count === environments.length
      ? viewModeSelection.mode
      : defaultViewMode;
  const handleClose = () => {
    setViewModeSelection(null);
    onClose();
  };
  const handleViewModeChange = (mode: CodexRemoteCloudConnectEnvironmentViewMode) => {
    setViewModeSelection({ fileName, count: environments.length, mode });
  };

  const listModeClass = {
    list: styles.codexRemoteCloudConnectEnvironmentListTable,
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

  const renderStatusBadge = (label: string, className: string) => (
    <span className={`${styles.codexRemoteCloudConnectEnvironmentBadge} ${className}`}>
      {label}
    </span>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      width="min(1120px, calc(100vw - 32px))"
      className={styles.codexRemoteCloudConnectEnvironmentModal}
      title={t('auth_files.codex_remote_cloud_connect_environment_title', {
        name: fileName || EMPTY_VALUE,
      })}
      headerActions={
        <Button
          variant="secondary"
          size="sm"
          className={styles.codexRemoteCloudConnectEnvironmentHeaderRefresh}
          onClick={onRefresh}
          disabled={loading}
          title={t('auth_files.codex_remote_cloud_connect_environment_force_refresh')}
          aria-label={t('auth_files.codex_remote_cloud_connect_environment_force_refresh')}
        >
          <IconRefreshCw size={15} />
        </Button>
      }
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t('common.close')}
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
                  onClick={() => handleViewModeChange(mode)}
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
            {viewMode === 'list' ? (
              <div className={styles.codexRemoteCloudConnectEnvironmentTableWrapper}>
                <table className={styles.codexRemoteCloudConnectEnvironmentTable}>
                  <thead>
                    <tr>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_display_name')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_host_name')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_online')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_busy')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_client_name')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_os')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_last_seen_at')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_id')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
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
                        <tr
                          key={environment.envId}
                          className={
                            environment.isLikelyStale
                              ? styles.codexRemoteCloudConnectEnvironmentRowStale
                              : undefined
                          }
                        >
                          <td>
                            <strong title={environment.name}>{environment.name}</strong>
                            {environment.displayName && environment.displayName !== environment.name && (
                              <span title={environment.displayName}>{environment.displayName}</span>
                            )}
                          </td>
                          <td title={environment.hostName ?? undefined}>
                            {environment.hostName || EMPTY_VALUE}
                          </td>
                          <td>{renderStatusBadge(onlineLabel, onlineClass)}</td>
                          <td>{renderStatusBadge(busyLabel, busyClass)}</td>
                          <td title={joinValues(environment.clientName, environment.clientVersion)}>
                            {joinValues(environment.clientName, environment.clientVersion)}
                          </td>
                          <td title={joinValues(environment.os, environment.osVersion)}>
                            {joinValues(environment.os, environment.osVersion)}
                          </td>
                          <td title={environment.lastSeenAt ?? undefined}>
                            {formatTime(environment.lastSeenAt)}
                          </td>
                          <td title={environment.envId}>
                            <code>{environment.envId}</code>
                          </td>
                          <td>
                            <div className={styles.codexRemoteCloudConnectEnvironmentRowActions}>
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              environments.map((environment) => {
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
                        {renderStatusBadge(onlineLabel, onlineClass)}
                        {renderStatusBadge(busyLabel, busyClass)}
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
              })
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
