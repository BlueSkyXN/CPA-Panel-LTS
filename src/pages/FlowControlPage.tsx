import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { parseDocument } from 'yaml';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { DiffModal } from '@/components/config/DiffModal';
import {
  ConfigDraftActionBar,
  type ConfigDraftStatus,
} from '@/components/config/ConfigDraftActionBar';
import { useConfigDraftReload, useConfigSaveFailureNotifier } from '@/hooks/useConfigDraftSave';
import { normalizeYamlForVisualDiff } from '@/components/config/configDraftYaml';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useVisualConfig } from '@/hooks/useVisualConfig';
import { registerSessionBusyCheck } from '@/services/connectionSession';
import { getManagedConnection } from '@/services/connectionRuntime';
import { readProfiles } from '@/services/storage/connectionProfiles';
import { configFileApi } from '@/services/api/configFile';
import { FlowControlFields } from '@/lts/flowControl/FlowControlFields';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import configStyles from './ConfigPage.module.scss';
import styles from './FlowControlPage.module.scss';

/**
 * Flow control workspace: the LTS sidecar mounted as a first-class page with its
 * own visual draft. The draft only ever marks flow-control fields dirty, so the
 * save path merges exactly those keys into the latest server YAML — unrelated
 * config edits and unmanaged YAML survive untouched.
 */
export function FlowControlPage() {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const notifyConfigFailure = useConfigSaveFailureNotifier();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const profileId = useAuthStore((state) => state.profileId);
  const apiBase = useAuthStore((state) => state.apiBase);
  const profile =
    getManagedConnection()?.bootstrap.profile ??
    readProfiles().find((entry) => entry.id === profileId);
  const connectionName = profile?.name || apiBase || t('connections.disconnected');

  const {
    visualValues,
    visualDirty,
    visualParseError,
    visualValidationErrors,
    loadVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  } = useVisualConfig();

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => registerSessionBusyCheck(() => saving), [saving]);
  const [error, setError] = useState('');
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [serverYaml, setServerYaml] = useState('');
  const [mergedYaml, setMergedYaml] = useState('');
  const [previewServerYaml, setPreviewServerYaml] = useState('');
  const actionBarRef = useRef<HTMLDivElement>(null);

  const disableControls = connectionStatus !== 'connected';
  const isDirty = visualDirty;
  const shouldRenderActionBar = isCurrentLayer;
  // Only flow-control fields can be dirty on this page; other baseline validation
  // errors belong to the config editor and must not block a flow-only save.
  const hasFlowValidationErrors = Boolean(visualValidationErrors.flowControlRulesText);
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );

  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: () => isDirty,
    dialog: unsavedChangesDialog,
  });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setSaved(false);
    setError('');
    try {
      const data = await configFileApi.fetchConfigYaml();
      setServerYaml(data);
      setMergedYaml(data);
      setPreviewServerYaml(data);
      loadVisualValuesFromYaml(data);
      setLoaded(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loadVisualValuesFromYaml, t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const syncConfigStore = async () => {
    try {
      useConfigStore.getState().clearCache();
      await useConfigStore.getState().fetchConfig(undefined, true);
    } catch (refreshError: unknown) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : typeof refreshError === 'string'
            ? refreshError
            : '';
      showNotification(`${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`, 'error');
    }
  };

  const handleSave = async () => {
    if (visualParseError) {
      showNotification(t('config_management.visual_mode_save_blocked'), 'error');
      return;
    }
    setSaving(true);
    try {
      const latestServerYaml = await configFileApi.fetchConfigYaml();
      const latestDocument = parseDocument(latestServerYaml);
      if (latestDocument.errors.length > 0) {
        showNotification(
          t('config_management.visual_mode_latest_yaml_invalid', {
            message:
              latestDocument.errors[0]?.message ?? t('config_management.visual_mode_save_blocked'),
          }),
          'error'
        );
        return;
      }
      const nextMergedYaml = applyVisualChangesToYaml(latestServerYaml);
      const diffOriginal = normalizeYamlForVisualDiff(latestServerYaml);
      if (diffOriginal === nextMergedYaml) {
        setServerYaml(latestServerYaml);
        setMergedYaml(nextMergedYaml);
        setPreviewServerYaml(latestServerYaml);
        loadVisualValuesFromYaml(latestServerYaml);
        showNotification(t('config_management.diff.no_changes'), 'info');
        return;
      }
      setServerYaml(diffOriginal);
      setMergedYaml(nextMergedYaml);
      setPreviewServerYaml(latestServerYaml);
      setDiffModalOpen(true);
    } catch (err: unknown) {
      notifyConfigFailure(err);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      const latestServerYaml = await configFileApi.fetchConfigYaml();
      if (latestServerYaml !== previewServerYaml) {
        // Server config changed since the preview: re-merge the flow draft and
        // let the diff reflect the newer baseline instead of writing stale YAML.
        const nextMergedYaml = applyVisualChangesToYaml(latestServerYaml);
        const nextServerYaml = normalizeYamlForVisualDiff(latestServerYaml);
        setPreviewServerYaml(latestServerYaml);
        setServerYaml(nextServerYaml);
        setMergedYaml(nextMergedYaml);
        if (nextServerYaml === nextMergedYaml) {
          setDiffModalOpen(false);
          loadVisualValuesFromYaml(latestServerYaml);
          showNotification(t('config_management.diff.no_changes'), 'info');
        }
        return;
      }

      await configFileApi.saveConfigYaml(mergedYaml);
      const latestContent = await configFileApi.fetchConfigYaml();
      setSaved(true);
      setDiffModalOpen(false);
      setServerYaml(latestContent);
      setMergedYaml(latestContent);
      setPreviewServerYaml(latestContent);
      loadVisualValuesFromYaml(latestContent);
      await syncConfigStore();
      showNotification(t('config_management.save_success'), 'success');
    } catch (err: unknown) {
      notifyConfigFailure(err);
    } finally {
      setSaving(false);
    }
  };

  const handleReload = useConfigDraftReload(loadConfig, isDirty);

  useActionBarHeightVar(actionBarRef, '--config-action-bar-height', shouldRenderActionBar);

  const draftStatus: ConfigDraftStatus = {
    disconnected: disableControls,
    loading,
    saving,
    loadFailed: !!error,
    yamlUnavailable: !!visualParseError,
    validationBlocked: hasFlowValidationErrors,
    dirty: isDirty,
    saved,
  };

  const actionBar = (
    <ConfigDraftActionBar
      barRef={actionBarRef}
      connectionName={connectionName}
      status={draftStatus}
      saveDisabled={
        disableControls ||
        loading ||
        saving ||
        !isDirty ||
        diffModalOpen ||
        visualParseError !== null ||
        hasFlowValidationErrors
      }
      onReload={handleReload}
      onSave={handleSave}
    />
  );

  return (
    <div className={configStyles.container}>
      <div className={configStyles.pageHeader}>
        <h1 className={configStyles.pageTitle}>{t('nav.flow_control')}</h1>
      </div>
      <p className={styles.intro}>{t('flow_control.page_description')}</p>

      <div className={configStyles.workspaceShell}>
        <div className={configStyles.content}>
          {error && <div className="error-box">{error}</div>}
          {!error && visualParseError && (
            <div className="error-box">
              {t('config_management.visual_mode_unavailable_detail', {
                message: visualParseError,
              })}
            </div>
          )}
          {loading && !loaded ? (
            <div className={styles.loading}>
              <LoadingSpinner />
            </div>
          ) : (
            loaded && (
              <FlowControlFields
                values={visualValues}
                disabled={disableControls || loading}
                onChange={setVisualValues}
                active={isCurrentLayer}
                page="all"
              />
            )
          )}
        </div>
      </div>

      {shouldRenderActionBar && typeof document !== 'undefined'
        ? createPortal(actionBar, document.body)
        : null}
      <DiffModal
        open={diffModalOpen}
        original={serverYaml}
        modified={mergedYaml}
        onConfirm={handleConfirmSave}
        onCancel={() => setDiffModalOpen(false)}
        loading={saving}
        targetName={connectionName}
      />
    </div>
  );
}
