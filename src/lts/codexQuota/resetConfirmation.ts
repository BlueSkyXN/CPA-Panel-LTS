import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';

type ConfirmationOptions = {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
};

type ShowConfirmation = (options: ConfirmationOptions) => void;

type ShowCodexQuotaResetConfirmationOptions = {
  fileName: string;
  t: TFunction;
  showConfirmation: ShowConfirmation;
  onConfirm: () => void | Promise<void>;
};

export const showCodexQuotaResetConfirmation = ({
  fileName,
  t,
  showConfirmation,
  onConfirm,
}: ShowCodexQuotaResetConfirmationOptions): void => {
  showConfirmation({
    title: t('codex_quota.reset_confirm_title'),
    message: t('codex_quota.reset_confirm_message', { name: fileName }),
    confirmText: t('codex_quota.reset_confirm_button'),
    variant: 'danger',
    onConfirm: () =>
      new Promise<void>((resolve) => {
        showConfirmation({
          title: t('codex_quota.reset_confirm_second_title'),
          message: t('codex_quota.reset_confirm_second_message', { name: fileName }),
          confirmText: t('codex_quota.reset_confirm_second_button'),
          variant: 'danger',
          onCancel: resolve,
          onConfirm: async () => {
            await onConfirm();
            resolve();
          },
        });
      }),
  });
};
