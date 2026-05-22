import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { CodexRemoteEnvironment } from '@/services/api';
import styles from '@/pages/AuthFilesPage.module.scss';

export type CodexEnvironmentsModalProps = {
  open: boolean;
  fileName: string;
  loading: boolean;
  error: string | null;
  environments: CodexRemoteEnvironment[];
  truncated: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCopyText: (text: string) => void | Promise<void>;
};

const EMPTY_VALUE = '-';

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

export function CodexEnvironmentsModal(props: CodexEnvironmentsModalProps) {
  const { t } = useTranslation();
  const {
    open,
    fileName,
    loading,
    error,
    environments,
    truncated,
    onClose,
    onRefresh,
    onCopyText,
  } = props;

  const renderMeta = (
    labelKey: string,
    value: string | null,
    options?: { wide?: boolean; title?: string }
  ) => (
    <div
      className={`${styles.codexEnvironmentMeta} ${options?.wide ? styles.codexEnvironmentMetaWide : ''}`}
    >
      <span>{t(labelKey)}</span>
      <strong title={options?.title ?? value ?? undefined}>{value || EMPTY_VALUE}</strong>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      title={t('auth_files.codex_env_title', { name: fileName || EMPTY_VALUE })}
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
        <div className={styles.codexEnvironmentLoading}>
          <LoadingSpinner size={14} />
          <span>{t('auth_files.codex_env_loading')}</span>
        </div>
      ) : error ? (
        <div className={styles.prefixProxyError}>{error}</div>
      ) : environments.length === 0 ? (
        <EmptyState
          title={t('auth_files.codex_env_empty')}
          description={t('auth_files.codex_env_empty_desc')}
        />
      ) : (
        <div className={styles.codexEnvironmentList}>
          {truncated && (
            <div className={styles.codexEnvironmentWarning}>
              {t('auth_files.codex_env_page_truncated')}
            </div>
          )}
          {environments.map((environment) => {
            const onlineLabel =
              environment.online === true
                ? t('auth_files.codex_env_online')
                : environment.online === false
                  ? t('auth_files.codex_env_offline')
                  : t('auth_files.codex_env_unknown');
            const busyLabel =
              environment.busy === true
                ? t('auth_files.codex_env_busy')
                : environment.busy === false
                  ? t('auth_files.codex_env_idle')
                  : t('auth_files.codex_env_unknown');
            const onlineClass =
              environment.online === true
                ? styles.codexEnvironmentBadgeOnline
                : environment.online === false
                  ? styles.codexEnvironmentBadgeOffline
                  : styles.codexEnvironmentBadgeUnknown;
            const busyClass =
              environment.busy === true
                ? styles.codexEnvironmentBadgeBusy
                : environment.busy === false
                  ? styles.codexEnvironmentBadgeIdle
                  : styles.codexEnvironmentBadgeUnknown;

            return (
              <div
                key={environment.envId}
                className={`${styles.codexEnvironmentItem} ${
                  environment.isLikelyStale ? styles.codexEnvironmentItemStale : ''
                }`}
              >
                <div className={styles.codexEnvironmentHeader}>
                  <div className={styles.codexEnvironmentTitle}>
                    <span className={styles.codexEnvironmentName}>{environment.name}</span>
                    <span className={styles.codexEnvironmentSubhead}>
                      {environment.hostName || environment.envId}
                    </span>
                  </div>
                  <div className={styles.codexEnvironmentBadges}>
                    <span className={`${styles.codexEnvironmentBadge} ${onlineClass}`}>
                      {onlineLabel}
                    </span>
                    <span className={`${styles.codexEnvironmentBadge} ${busyClass}`}>
                      {busyLabel}
                    </span>
                    {environment.isLikelyStale && (
                      <span
                        className={`${styles.codexEnvironmentBadge} ${styles.codexEnvironmentBadgeStale}`}
                      >
                        {t('auth_files.codex_env_likely_stale')}
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onCopyText(environment.envId)}
                    >
                      {t('auth_files.codex_env_copy_id')}
                    </Button>
                  </div>
                </div>

                {environment.isLikelyStale && (
                  <div className={styles.codexEnvironmentStaleHint}>
                    {t('auth_files.codex_env_stale_hint')}
                  </div>
                )}

                <div className={styles.codexEnvironmentMetaGrid}>
                  {renderMeta('auth_files.codex_env_id', environment.envId, {
                    wide: true,
                    title: environment.envId,
                  })}
                  {renderMeta('auth_files.codex_env_kind', environment.kind)}
                  {renderMeta('auth_files.codex_env_display_name', environment.displayName)}
                  {renderMeta('auth_files.codex_env_host_name', environment.hostName)}
                  {renderMeta(
                    'auth_files.codex_env_app_server_version',
                    environment.appServerVersion
                  )}
                  {renderMeta('auth_files.codex_env_client_type', environment.clientType)}
                  {renderMeta(
                    'auth_files.codex_env_client_name',
                    joinValues(environment.clientName, environment.clientVersion)
                  )}
                  {renderMeta(
                    'auth_files.codex_env_os',
                    joinValues(environment.os, environment.osVersion)
                  )}
                  {renderMeta('auth_files.codex_env_arch', environment.arch)}
                  {renderMeta('auth_files.codex_env_originator', environment.originator)}
                  {renderMeta('auth_files.codex_env_terminal', environment.terminal)}
                  {renderMeta('auth_files.codex_env_installation_id', environment.installationId, {
                    title: environment.installationId ?? undefined,
                  })}
                  {renderMeta(
                    'auth_files.codex_env_last_seen_at',
                    formatTime(environment.lastSeenAt)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
