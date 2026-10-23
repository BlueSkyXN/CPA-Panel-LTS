import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { useClaudeResetGrants } from './ClaudeResetGrants';

export function ClaudeGrantDialog({ file, onClose }: { file: AuthFileItem; onClose: () => void }) {
  const { t } = useTranslation();
  const disabled = useAuthStore((state) => state.connectionStatus !== 'connected');
  const [refresh, setRefresh] = useState(0);
  const invalidate = useCallback(
    () => useQuotaStore.getState().clearQuotaCache([file.name]),
    [file.name]
  );
  const grants = useClaudeResetGrants(file, true, disabled, refresh, invalidate);
  return (
    <Modal
      open
      title={t('claude_reset.title')}
      onClose={onClose}
      closeDisabled={grants.busy}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={disabled || grants.busy}
          >
            {t('common.refresh')}
          </Button>
          <Button onClick={grants.confirm} disabled={grants.blocked} loading={grants.busy}>
            {t(`claude_reset.${grants.buttonLabel}`)}
          </Button>
        </>
      }
    >
      {grants.message && <p role="status">{t(`claude_reset.${grants.message}`)}</p>}
      {grants.count !== null && <p>{t('alignment_quota.grants_left', { count: grants.count })}</p>}
      {grants.grants.map((grant) => (
        <div key={grant.id}>
          <strong>{grant.label || grant.id}</strong>
          <p>
            {grant.resetsLeft} / {grant.resetsTotal}
          </p>
          {grant.endsAt && (
            <p>
              {t('alignment_quota.plan_end')}: {new Date(grant.endsAt).toLocaleString()}
            </p>
          )}
          {grant.clears.length > 0 && (
            <p>
              {t('alignment_quota.clears')}:{' '}
              {grant.clears.map((window) => t(`claude_reset.window_${window}`)).join(', ')}
            </p>
          )}
        </div>
      ))}
    </Modal>
  );
}
