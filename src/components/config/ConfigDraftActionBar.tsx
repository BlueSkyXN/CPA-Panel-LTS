import { useId, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconCheck, IconRefreshCw } from '@/components/ui/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import styles from './ConfigDraftActionBar.module.scss';

/**
 * Shared chrome for every visual-draft save surface: the config editor and the
 * Flow control page render the same action bar and status wording, so the two
 * draft flows cannot drift apart. Save-failure and reload behaviour live in
 * `@/hooks/useConfigDraftSave`.
 */
export type ConfigDraftStatus = {
  disconnected: boolean;
  loading: boolean;
  saving: boolean;
  loadFailed: boolean;
  yamlUnavailable: boolean;
  validationBlocked: boolean;
  dirty: boolean;
  saved: boolean;
};

function statusText(status: ConfigDraftStatus, t: TFunction) {
  if (status.disconnected) return t('config_management.status_disconnected');
  if (status.loading) return t('config_management.status_loading');
  if (status.loadFailed) return t('config_management.status_load_failed');
  if (status.yamlUnavailable) return t('config_management.visual_mode_unavailable');
  if (status.validationBlocked)
    return t('config_management.visual.validation.validation_blocked');
  if (status.saving) return t('config_management.status_saving');
  if (status.dirty) return t('config_management.status_dirty');
  return status.saved ? t('config_management.editor.saved') : t('config_management.status_loaded');
}

function compactStatusText(status: ConfigDraftStatus, t: TFunction) {
  if (status.disconnected)
    return t('config_management.status_disconnected_short', { defaultValue: 'Disconnected' });
  if (status.loading)
    return t('config_management.status_loading_short', { defaultValue: 'Loading' });
  if (status.loadFailed)
    return t('config_management.status_load_failed_short', { defaultValue: 'Failed' });
  if (status.yamlUnavailable)
    return t('config_management.visual_mode_unavailable_short', { defaultValue: 'YAML issue' });
  if (status.validationBlocked)
    return t('config_management.visual.validation_blocked_short', { defaultValue: 'Fix errors' });
  if (status.saving) return t('config_management.status_saving_short', { defaultValue: 'Saving' });
  if (status.dirty) return t('config_management.status_dirty_short', { defaultValue: 'Unsaved' });
  return status.saved
    ? t('config_management.editor.saved')
    : t('config_management.status_loaded_short', { defaultValue: 'Loaded' });
}

function statusClass(status: ConfigDraftStatus) {
  if (status.disconnected || status.loading || status.saving) return '';
  if (status.loadFailed || status.yamlUnavailable || status.validationBlocked) return styles.error;
  if (status.dirty) return styles.modified;
  return styles.saved;
}

type Props = {
  barRef: RefObject<HTMLDivElement | null>;
  connectionName: string;
  status: ConfigDraftStatus;
  saveDisabled: boolean;
  onReload: () => void;
  onSave: () => void;
};

export function ConfigDraftActionBar({
  barRef,
  connectionName,
  status,
  saveDisabled,
  onReload,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const saveTargetId = useId();
  const isMobile = useMediaQuery('(max-width: 768px)');
  return (
    <div className={styles.actionBar} ref={barRef}>
      <div className={styles.actionBarStatusGroup}>
        <div
          id={saveTargetId}
          className={styles.saveTarget}
          data-testid="config-save-target"
          title={connectionName}
        >
          {t('config_management.save_target', { name: connectionName })}
        </div>
        <div
          className={`${styles.actionStatus} ${
            isMobile ? styles.actionStatusCompact : ''
          } ${statusClass(status)}`}
        >
          {isMobile ? compactStatusText(status, t) : statusText(status, t)}
        </div>
      </div>
      <div className={styles.actionBarButtons}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onReload}
          disabled={status.loading || status.saving}
          title={t('config_management.reload')}
          aria-label={t('config_management.reload')}
        >
          <IconRefreshCw size={16} />
          <span>{t('config_management.reload')}</span>
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          onClick={onSave}
          disabled={saveDisabled}
          title={t('config_management.save')}
          aria-label={t('config_management.save')}
          aria-describedby={saveTargetId}
        >
          <IconCheck size={16} />
          <span>{t('config_management.save')}</span>
          {status.dirty && <span className={styles.dirtyDot} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
