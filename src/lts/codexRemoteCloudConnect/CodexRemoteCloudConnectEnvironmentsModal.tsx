import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconX } from '@/components/ui/icons';
import type { CodexRemoteCloudConnectEnvironment } from './api';
import {
  createCodexRemoteCloudConnectEnvironmentViewModel,
  type CodexRemoteCloudConnectCleanupAdviceReason,
  type CodexRemoteCloudConnectEnvironmentGroup,
  type CodexRemoteCloudConnectEnvironmentLastAction,
  type CodexRemoteCloudConnectEnvironmentView,
} from './viewModel';
import styles from './styles.module.scss';
import pageStyles from '@/pages/AuthFilesPage.module.scss';

export type CodexRemoteCloudConnectEnvironmentsModalProps = {
  open: boolean;
  fileName: string;
  loading: boolean;
  error: string | null;
  environments: CodexRemoteCloudConnectEnvironment[];
  truncated: boolean;
  deletingId: string | null;
  lastAction: CodexRemoteCloudConnectEnvironmentLastAction | null;
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
type CodexRemoteCloudConnectEnvironmentGroupSelection = {
  fileName: string;
  count: number;
  enabled: boolean;
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

const createFlatGroup = (
  environments: CodexRemoteCloudConnectEnvironmentView[]
): CodexRemoteCloudConnectEnvironmentGroup => ({
  key: 'all',
  label: '',
  environments,
  summary: {
    total: environments.length,
    online: environments.filter((item) => item.environment.online === true).length,
    busy: environments.filter((item) => item.environment.busy === true).length,
    keep: environments.filter((item) => item.advice.level === 'keep').length,
    cleanable: environments.filter((item) => item.advice.level === 'cleanable').length,
    caution: environments.filter((item) => item.advice.level === 'caution').length,
  },
});

export function CodexRemoteCloudConnectEnvironmentsModal(
  props: CodexRemoteCloudConnectEnvironmentsModalProps
) {
  const { t } = useTranslation();
  const [viewModeSelection, setViewModeSelection] =
    useState<CodexRemoteCloudConnectEnvironmentViewSelection | null>(null);
  const [groupSelection, setGroupSelection] =
    useState<CodexRemoteCloudConnectEnvironmentGroupSelection | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const {
    open,
    fileName,
    loading,
    error,
    environments,
    truncated,
    deletingId,
    lastAction,
    onClose,
    onRefresh,
    onCopyText,
    onDelete,
  } = props;

  const viewModel = useMemo(
    () => createCodexRemoteCloudConnectEnvironmentViewModel(environments),
    [environments]
  );
  const defaultViewMode = resolveDefaultViewMode(environments.length);
  const viewMode =
    viewModeSelection?.fileName === fileName && viewModeSelection.count === environments.length
      ? viewModeSelection.mode
      : defaultViewMode;
  const defaultGroupByHost = environments.length > 1;
  const groupByHost =
    groupSelection?.fileName === fileName && groupSelection.count === environments.length
      ? groupSelection.enabled
      : defaultGroupByHost;
  const displayGroups = groupByHost
    ? viewModel.groups
    : [createFlatGroup(viewModel.environments)];
  const selectedView =
    viewModel.environments.find((item) => item.environment.envId === selectedEnvId) ?? null;

  const handleClose = () => {
    setViewModeSelection(null);
    setGroupSelection(null);
    setSelectedEnvId(null);
    onClose();
  };
  const handleViewModeChange = (mode: CodexRemoteCloudConnectEnvironmentViewMode) => {
    setViewModeSelection({ fileName, count: environments.length, mode });
  };
  const handleGroupModeChange = (enabled: boolean) => {
    setGroupSelection({ fileName, count: environments.length, enabled });
  };

  const listModeClass = {
    list: styles.codexRemoteCloudConnectEnvironmentListTable,
    vertical: styles.codexRemoteCloudConnectEnvironmentListVertical,
    grid: styles.codexRemoteCloudConnectEnvironmentListGrid,
  }[viewMode];
  const outerListModeClass =
    viewMode === 'list' ? listModeClass : styles.codexRemoteCloudConnectEnvironmentListVertical;
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

  const renderStatusBadge = (label: string, className: string) => (
    <span className={`${styles.codexRemoteCloudConnectEnvironmentBadge} ${className}`}>
      {label}
    </span>
  );

  const resolveStatusView = (environment: CodexRemoteCloudConnectEnvironment) => {
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
    return { onlineLabel, busyLabel, onlineClass, busyClass };
  };

  const renderAdviceBadge = (view: CodexRemoteCloudConnectEnvironmentView) => {
    const className = {
      keep: styles.codexRemoteCloudConnectEnvironmentAdviceKeep,
      cleanable: styles.codexRemoteCloudConnectEnvironmentAdviceCleanable,
      caution: styles.codexRemoteCloudConnectEnvironmentAdviceCaution,
    }[view.advice.level];

    return (
      <span
        className={`${styles.codexRemoteCloudConnectEnvironmentBadge} ${styles.codexRemoteCloudConnectEnvironmentAdviceBadge} ${className}`}
      >
        {t(`auth_files.codex_remote_cloud_connect_environment_advice_${view.advice.level}`)}
      </span>
    );
  };

  const renderReasons = (
    reasons: CodexRemoteCloudConnectCleanupAdviceReason[],
    compact = false
  ) => (
    <div
      className={`${styles.codexRemoteCloudConnectEnvironmentReasons} ${
        compact ? styles.codexRemoteCloudConnectEnvironmentReasonsCompact : ''
      }`}
    >
      {reasons.slice(0, compact ? 3 : reasons.length).map((reason) => (
        <span key={reason}>
          {t(`auth_files.codex_remote_cloud_connect_environment_reason_${reason}`)}
        </span>
      ))}
    </div>
  );

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

  const renderGroupHeader = (group: CodexRemoteCloudConnectEnvironmentGroup) => (
    <div className={styles.codexRemoteCloudConnectEnvironmentGroupHeader}>
      <strong title={group.label}>{group.label}</strong>
      <span>
        {t('auth_files.codex_remote_cloud_connect_environment_group_summary', {
          count: group.summary.total,
          online: group.summary.online,
          cleanable: group.summary.cleanable,
        })}
      </span>
    </div>
  );

  const buildDiagnosticText = (view: CodexRemoteCloudConnectEnvironmentView) => {
    const { environment } = view;
    const rows = [
      ['name', environment.name],
      ['envId', environment.envId],
      ['kind', environment.kind],
      ['displayName', environment.displayName],
      ['hostName', environment.hostName],
      ['online', String(environment.online ?? EMPTY_VALUE)],
      ['busy', String(environment.busy ?? EMPTY_VALUE)],
      ['os', environment.os],
      ['osVersion', environment.osVersion],
      ['arch', environment.arch],
      ['appServerVersion', environment.appServerVersion],
      ['installationId', environment.installationId],
      ['clientType', environment.clientType],
      ['originator', environment.originator],
      ['terminal', environment.terminal],
      ['clientName', environment.clientName],
      ['clientVersion', environment.clientVersion],
      ['lastSeenAt', environment.lastSeenAt],
      ['advice', t(`auth_files.codex_remote_cloud_connect_environment_advice_${view.advice.level}`)],
      [
        'reasons',
        view.advice.reasons
          .map((reason) => t(`auth_files.codex_remote_cloud_connect_environment_reason_${reason}`))
          .join(', '),
      ],
    ];
    return rows.map(([label, value]) => `${label}: ${value || EMPTY_VALUE}`).join('\n');
  };

  const renderActionBanner = () => {
    if (!lastAction) return null;
    const className =
      lastAction.type === 'recheckChanged'
        ? styles.codexRemoteCloudConnectEnvironmentActionWarning
        : lastAction.type === 'recheckFailed'
          ? styles.codexRemoteCloudConnectEnvironmentActionError
          : styles.codexRemoteCloudConnectEnvironmentActionInfo;
    const messageKey = {
      deleteSuccess: 'delete_action_success',
      recheckRunning: 'recheck_running',
      recheckStable: 'recheck_stable',
      recheckChanged: 'recheck_changed',
      recheckFailed: 'recheck_failed',
    }[lastAction.type];
    return (
      <div className={`${styles.codexRemoteCloudConnectEnvironmentActionBanner} ${className}`}>
        {t(`auth_files.codex_remote_cloud_connect_environment_${messageKey}`, lastAction)}
      </div>
    );
  };

  const renderRowActions = (view: CodexRemoteCloudConnectEnvironmentView) => (
    <div className={styles.codexRemoteCloudConnectEnvironmentRowActions}>
      <Button variant="secondary" size="sm" onClick={() => setSelectedEnvId(view.environment.envId)}>
        {t('auth_files.codex_remote_cloud_connect_environment_details_button')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void onCopyText(view.environment.envId)}
      >
        {t('auth_files.codex_remote_cloud_connect_environment_copy_id')}
      </Button>
      <Button
        variant="danger"
        size="sm"
        loading={deletingId === view.environment.envId}
        disabled={Boolean(deletingId)}
        onClick={() => onDelete(view.environment)}
      >
        {t('auth_files.codex_remote_cloud_connect_environment_delete_button')}
      </Button>
    </div>
  );

  const renderDetailDrawer = () => {
    if (!selectedView) return null;
    const environment = selectedView.environment;
    const statusView = resolveStatusView(environment);
    const detailRows = [
      ['auth_files.codex_remote_cloud_connect_environment_id', environment.envId],
      ['auth_files.codex_remote_cloud_connect_environment_kind', environment.kind],
      ['auth_files.codex_remote_cloud_connect_environment_display_name', environment.displayName],
      ['auth_files.codex_remote_cloud_connect_environment_host_name', environment.hostName],
      ['auth_files.codex_remote_cloud_connect_environment_online', statusView.onlineLabel],
      ['auth_files.codex_remote_cloud_connect_environment_busy', statusView.busyLabel],
      ['auth_files.codex_remote_cloud_connect_environment_os', environment.os],
      ['auth_files.codex_remote_cloud_connect_environment_os_version', environment.osVersion],
      ['auth_files.codex_remote_cloud_connect_environment_arch', environment.arch],
      [
        'auth_files.codex_remote_cloud_connect_environment_app_server_version',
        environment.appServerVersion,
      ],
      ['auth_files.codex_remote_cloud_connect_environment_installation_id', environment.installationId],
      ['auth_files.codex_remote_cloud_connect_environment_client_type', environment.clientType],
      ['auth_files.codex_remote_cloud_connect_environment_originator', environment.originator],
      ['auth_files.codex_remote_cloud_connect_environment_terminal', environment.terminal],
      ['auth_files.codex_remote_cloud_connect_environment_client_name', environment.clientName],
      ['auth_files.codex_remote_cloud_connect_environment_client_version', environment.clientVersion],
      [
        'auth_files.codex_remote_cloud_connect_environment_last_seen_at',
        formatTime(environment.lastSeenAt),
      ],
    ] as const;

    return (
      <div
        className={styles.codexRemoteCloudConnectEnvironmentDetailOverlay}
        onClick={() => setSelectedEnvId(null)}
      >
        <aside
          className={styles.codexRemoteCloudConnectEnvironmentDetailDrawer}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.codexRemoteCloudConnectEnvironmentDetailHeader}>
            <div>
              <span>{t('auth_files.codex_remote_cloud_connect_environment_details_title')}</span>
              <strong title={environment.name}>{environment.name}</strong>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedEnvId(null)}
              aria-label={t('common.close')}
            >
              <IconX size={16} />
            </Button>
          </div>
          <div className={styles.codexRemoteCloudConnectEnvironmentDetailAdvice}>
            {renderAdviceBadge(selectedView)}
            {renderReasons(selectedView.advice.reasons)}
          </div>
          <dl className={styles.codexRemoteCloudConnectEnvironmentDetailGrid}>
            {detailRows.map(([labelKey, value]) => (
              <div key={labelKey}>
                <dt>{t(labelKey)}</dt>
                <dd title={value ?? undefined}>{value || EMPTY_VALUE}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.codexRemoteCloudConnectEnvironmentDetailActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onCopyText(environment.envId)}
            >
              {t('auth_files.codex_remote_cloud_connect_environment_copy_id')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onCopyText(buildDiagnosticText(selectedView))}
            >
              {t('auth_files.codex_remote_cloud_connect_environment_copy_diagnostics')}
            </Button>
          </div>
        </aside>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      width="min(1180px, calc(100vw - 32px))"
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
        <div className={pageStyles.prefixProxyError}>{error}</div>
      ) : environments.length === 0 ? (
        <EmptyState
          title={t('auth_files.codex_remote_cloud_connect_environment_empty')}
          description={t('auth_files.codex_remote_cloud_connect_environment_empty_desc')}
        />
      ) : (
        <div className={styles.codexRemoteCloudConnectEnvironmentPanel}>
          {renderActionBanner()}
          <div className={styles.codexRemoteCloudConnectEnvironmentSummaryBar}>
            {t('auth_files.codex_remote_cloud_connect_environment_summary', {
              count: viewModel.summary.total,
              hosts: viewModel.summary.hostCount,
              online: viewModel.summary.online,
              cleanable: viewModel.summary.cleanable,
            })}
          </div>
          <div className={styles.codexRemoteCloudConnectEnvironmentToolbar}>
            <span className={styles.codexRemoteCloudConnectEnvironmentCount}>
              {t('auth_files.codex_remote_cloud_connect_environment_count', {
                count: environments.length,
              })}
            </span>
            <div className={styles.codexRemoteCloudConnectEnvironmentToolbarActions}>
              <ToggleSwitch
                checked={groupByHost}
                onChange={handleGroupModeChange}
                disabled={environments.length <= 1}
                ariaLabel={t('auth_files.codex_remote_cloud_connect_environment_group_by_host')}
                label={
                  <span className={styles.codexRemoteCloudConnectEnvironmentToggleLabel}>
                    {t('auth_files.codex_remote_cloud_connect_environment_group_by_host')}
                  </span>
                }
              />
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
          </div>
          <div className={`${styles.codexRemoteCloudConnectEnvironmentList} ${outerListModeClass}`}>
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
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_app_server_version')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_last_seen_at')}</th>
                      <th>{t('auth_files.codex_remote_cloud_connect_environment_cleanup_advice_label')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayGroups.map((group) => (
                      <Fragment key={group.key}>
                        {groupByHost && (
                          <tr className={styles.codexRemoteCloudConnectEnvironmentGroupRow}>
                            <td colSpan={7}>{renderGroupHeader(group)}</td>
                          </tr>
                        )}
                        {group.environments.map((view) => {
                          const { environment } = view;
                          const statusView = resolveStatusView(environment);
                          return (
                            <tr
                              key={environment.envId}
                              className={
                                view.advice.level === 'cleanable'
                                  ? styles.codexRemoteCloudConnectEnvironmentRowStale
                                  : undefined
                              }
                            >
                              <td>
                                <strong title={environment.name}>{environment.name}</strong>
                                {environment.displayName &&
                                  environment.displayName !== environment.name && (
                                    <span title={environment.displayName}>
                                      {environment.displayName}
                                    </span>
                                  )}
                              </td>
                              <td title={environment.hostName ?? undefined}>
                                {environment.hostName || EMPTY_VALUE}
                              </td>
                              <td>
                                <div className={styles.codexRemoteCloudConnectEnvironmentStatusPair}>
                                  {renderStatusBadge(statusView.onlineLabel, statusView.onlineClass)}
                                  {renderStatusBadge(statusView.busyLabel, statusView.busyClass)}
                                </div>
                              </td>
                              <td title={environment.appServerVersion ?? undefined}>
                                {environment.appServerVersion || EMPTY_VALUE}
                              </td>
                              <td title={environment.lastSeenAt ?? undefined}>
                                {formatTime(environment.lastSeenAt)}
                              </td>
                              <td>
                                {renderAdviceBadge(view)}
                                {renderReasons(view.advice.reasons, true)}
                              </td>
                              <td>{renderRowActions(view)}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              displayGroups.map((group) => (
                <div
                  key={group.key}
                  className={styles.codexRemoteCloudConnectEnvironmentGroupSection}
                >
                  {groupByHost && renderGroupHeader(group)}
                  <div
                    className={`${styles.codexRemoteCloudConnectEnvironmentGroupList} ${listModeClass}`}
                  >
                    {group.environments.map((view) => {
                      const { environment } = view;
                      const statusView = resolveStatusView(environment);

                      return (
                        <div
                          key={environment.envId}
                          className={`${styles.codexRemoteCloudConnectEnvironmentItem} ${itemModeClass} ${
                            view.advice.level === 'cleanable'
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
                              {renderStatusBadge(statusView.onlineLabel, statusView.onlineClass)}
                              {renderStatusBadge(statusView.busyLabel, statusView.busyClass)}
                              {renderAdviceBadge(view)}
                              {renderRowActions(view)}
                            </div>
                          </div>
                          {renderReasons(view.advice.reasons, viewMode === 'grid')}
                          <div
                            className={`${styles.codexRemoteCloudConnectEnvironmentMetaGrid} ${metaGridModeClass}`}
                          >
                            {renderMeta(
                              'auth_files.codex_remote_cloud_connect_environment_app_server_version',
                              environment.appServerVersion
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
                              'auth_files.codex_remote_cloud_connect_environment_last_seen_at',
                              formatTime(environment.lastSeenAt)
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
          {renderDetailDrawer()}
        </div>
      )}
    </Modal>
  );
}
