import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useQuotaStore } from '@/stores';
import {
  resetGrantHasNoUsage,
  type AnthropicResetGrant,
} from '@/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/types';
import { parseIsoToMs, formatInstantShort } from '@/utils/quota/resetInstants';
import { useClaudeResetGrants } from './ClaudeResetGrants';
import { resetGrantKind } from './resetGrantChoice';
import styles from './ClaudeGrantDialog.module.scss';

type ChoiceProps = {
  grants: readonly AnthropicResetGrant[];
  selected: string | null;
  canRedeemGrant: (id: string) => boolean;
  onSelect: (id: string) => void;
};

/** Native radios retain arrow-key navigation without a second confirmation dialog. */
function ClaudeResetGrantChoices({ grants, selected, canRedeemGrant, onSelect }: ChoiceProps) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className={styles.choices}>
      <legend>{t('claude_reset.choose_grant')}</legend>
      {grants.length === 0 && <p>{t('claude_reset.no_grants')}</p>}
      {grants.map((grant) => {
        const expiry = parseIsoToMs(grant.endsAt);
        const available = canRedeemGrant(grant.id);
        return (
          <label key={grant.id} className={styles.choice} data-disabled={!available}>
            <input
              type="radio"
              name={name}
              value={grant.id}
              checked={selected === grant.id}
              disabled={!available}
              onChange={() => onSelect(grant.id)}
            />
            <span className={styles.details}>
              <strong>
                {t(`claude_reset.kind_${resetGrantKind(grant)}`)} · {grant.label || grant.id}
              </strong>
              <span>
                {t('claude_reset.count', { left: grant.resetsLeft, total: grant.resetsTotal })}
              </span>
              <span>
                {t('claude_reset.grant_expiry', {
                  date:
                    expiry === null ? t('claude_reset.expiry_unknown') : formatInstantShort(expiry),
                })}
              </span>
              <span>
                {t(
                  grant.givesBackWeekly
                    ? 'claude_reset.fable_hint'
                    : 'claude_reset.exact_grant_hint'
                )}
              </span>
              {resetGrantHasNoUsage(grant) && <span>{t('claude_reset.no_usage')}</span>}
              {!available && !resetGrantHasNoUsage(grant) && (
                <span>{t('claude_reset.grant_unavailable')}</span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function ClaudeGrantDialog({ file, onClose }: { file: AuthFileItem; onClose: () => void }) {
  const { t } = useTranslation();
  const disabled = useAuthStore((state) => state.connectionStatus !== 'connected');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const invalidate = useCallback(
    () => useQuotaStore.getState().clearQuotaCache([file.name]),
    [file.name]
  );
  const grants = useClaudeResetGrants(file, true, disabled, refresh, invalidate);
  const selectedGrant = grants.grants.find((grant) => grant.id === selected);
  return (
    <Modal
      open
      title={t('claude_reset.title')}
      onClose={onClose}
      closeDisabled={grants.busy}
      footer={
        <>
          <div className={styles.summaryWrap}>
            {selectedGrant && (
              <p className={styles.summary} aria-live="polite">
                {t('claude_reset.selected_grant', {
                  kind: t(`claude_reset.kind_${resetGrantKind(selectedGrant)}`),
                  label: selectedGrant.label || selectedGrant.id,
                })}
              </p>
            )}
          </div>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={disabled || grants.busy}
            >
              {t('common.refresh')}
            </Button>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={grants.busy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!selected) return;
                void grants.confirm(selected).then((answer) => {
                  // Upstream #554 (d06a1105): a settled answer ends this
                  // dialog; an ambiguous claim keeps it open for its retry.
                  if (answer && !answer.unresolved) onClose();
                });
              }}
              loading={grants.busy}
              disabled={!selected || !grants.canRedeemGrant(selected)}
            >
              {t(`claude_reset.${grants.buttonLabel}`)}
            </Button>
          </div>
        </>
      }
    >
      <p>
        {t(grants.pendingGrantId ? 'claude_reset.retry_confirm' : 'claude_reset.confirm_text', {
          name: file.name,
        })}
      </p>
      {grants.loading ? (
        <p role="status" aria-busy="true">
          {t('common.loading')}
        </p>
      ) : (
        <ClaudeResetGrantChoices
          grants={grants.grants}
          selected={selected}
          canRedeemGrant={grants.canRedeemGrant}
          onSelect={setSelected}
        />
      )}
      {grants.message && <p role="status">{t(`claude_reset.${grants.message}`)}</p>}
      {grants.count !== null && <p>{t('alignment_quota.grants_left', { count: grants.count })}</p>}
    </Modal>
  );
}
