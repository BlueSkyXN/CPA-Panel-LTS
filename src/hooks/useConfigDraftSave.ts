import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { VisualConfigApplyError } from '@/hooks/useVisualConfig';
import { useNotificationStore } from '@/stores';

/**
 * Shared draft-save feedback for every visual config surface (config editor and
 * the Flow control page), so both report failures and reload confirmations the
 * same way.
 */

/** Save failures surface the mapped apply-error code, otherwise the raw message. */
export function useConfigSaveFailureNotifier() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  return useCallback(
    (error: unknown) => {
      const message =
        error instanceof VisualConfigApplyError
          ? t(`config_management.${error.code}`)
          : `${t('notification.save_failed')}: ${error instanceof Error ? error.message : ''}`;
      showNotification(message, 'error');
    },
    [showNotification, t]
  );
}

/** Reload discards a dirty draft only after an explicit confirmation. */
export function useConfigDraftReload(reload: () => void | Promise<void>, dirty: boolean) {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  return useCallback(() => {
    if (!dirty) {
      void reload();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('config_management.reload_confirm_message'),
      confirmText: t('config_management.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await reload();
      },
    });
  }, [dirty, reload, showConfirmation, t]);
}
