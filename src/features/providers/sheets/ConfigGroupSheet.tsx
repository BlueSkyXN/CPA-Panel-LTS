import { useEffect, useId, useImperativeHandle, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { providersApi } from '@/services/api/providers';
import { apiClient } from '@/services/api/client';
import { normalizeRuntimePolicy } from '@/services/api/transformers';
import { useNotificationStore } from '@/stores';
import { registerSessionBusyCheck, registerSessionLeaveCheck } from '@/services/connectionSession';
import { buildRuntimePolicy, readRuntimePolicy, validateRuntimePolicy } from '../runtimePolicy';
import type { ConfigGroupTarget } from '../configGroups';
import { RuntimePolicyEditor } from './forms/RuntimePolicyEditor';
import styles from './forms/sharedForm.module.scss';

export interface ConfigGroupSheetHandle {
  confirmDiscardIfDirty: () => Promise<boolean>;
}

interface Props {
  ref?: Ref<ConfigGroupSheetHandle>;
  target: ConfigGroupTarget;
  disabled: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ConfigGroupSheet({ ref, target, disabled, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const { showConfirmation, showNotification } = useNotificationStore();
  const id = useId();
  const group = target.source.group;
  const initialName = typeof group.name === 'string' ? group.name : '';
  const initialURL = typeof group['base-url'] === 'string' ? group['base-url'] : '';
  const [name, setName] = useState(initialName);
  const [baseUrl, setBaseUrl] = useState(initialURL);
  const [initialPolicy] = useState(() =>
    readRuntimePolicy({
      apiKey: '',
      ...normalizeRuntimePolicy(group),
      source: { ...target.source, keyIndex: undefined },
    })
  );
  const [policy, setPolicy] = useState(initialPolicy);
  const [generation] = useState(() => apiClient.getConnectionGeneration());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dirty =
    name !== initialName ||
    baseUrl !== initialURL ||
    JSON.stringify(policy) !== JSON.stringify(initialPolicy);
  const count = Array.isArray(group.keys) ? group.keys.length : 0;
  useEffect(() => registerSessionBusyCheck(() => submitting), [submitting]);
  useEffect(() => registerSessionLeaveCheck(() => dirty || submitting), [dirty, submitting]);

  const confirmDiscard = () =>
    submitting
      ? Promise.resolve(false)
      : !dirty
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            showConfirmation({
              title: t('providersPage.unsavedChanges.title'),
              message: t('providersPage.unsavedChanges.message'),
              confirmText: t('providersPage.unsavedChanges.discard'),
              cancelText: t('providersPage.unsavedChanges.keepEditing'),
              variant: 'danger',
              onConfirm: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });

  useImperativeHandle(ref, () => ({ confirmDiscardIfDirty: confirmDiscard }));

  const save = async () => {
    if (disabled || submitting || !dirty) return;
    const validation = validateRuntimePolicy(policy);
    if (validation) {
      setError(t(validation));
      return;
    }
    if (!name.trim()) {
      setError(t('providersPage.form.validation.nameRequired'));
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) =>
      showConfirmation({
        title: t('providersPage.configGroup.confirmTitle'),
        message: t('providersPage.configGroup.confirmMessage', { name: initialName, count }),
        confirmText: t('providersPage.actions.save'),
        cancelText: t('providersPage.actions.cancel'),
        variant: 'danger',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      })
    );
    if (!confirmed) return;
    setSubmitting(true);
    setError('');
    try {
      if (!apiClient.isCurrentConnection(generation))
        throw new Error(t('config_management.read_conflict'));
      await providersApi.updateGroup(target.family, target.source, {
        name,
        baseUrl,
        ...buildRuntimePolicy(policy),
      });
      await onSaved();
      if (!apiClient.isCurrentConnection(generation)) return;
      showNotification(t('config_management.save_success'), 'success');
      onClose();
    } catch (err) {
      if (apiClient.isCurrentConnection(generation))
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      closeDisabled={submitting}
      confirmClose={confirmDiscard}
      title={t('providersPage.configGroup.title')}
      description={t('providersPage.configGroup.impact', { name: initialName, count })}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              void confirmDiscard().then((ok) => {
                if (ok) onClose();
              });
            }}
          >
            {t('providersPage.actions.cancel')}
          </Button>
          <Button
            disabled={disabled || submitting || !dirty}
            onClick={() => {
              void save();
            }}
          >
            {t('providersPage.actions.save')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-name`}>
            {t('providersPage.configGroup.name')}
          </label>
          <input
            id={`${id}-name`}
            className={styles.input}
            value={name}
            disabled={disabled || submitting}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-url`}>
            {t('providersPage.configGroup.baseUrl')}
          </label>
          <input
            id={`${id}-url`}
            className={styles.input}
            value={baseUrl}
            disabled={disabled || submitting}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
        <p className={styles.sectionDesc}>{t('providersPage.configGroup.policyHint')}</p>
        <RuntimePolicyEditor
          value={policy}
          onChange={setPolicy}
          disabled={disabled || submitting}
        />
        {error && (
          <div role="alert" className={styles.errorBox}>
            {error}
          </div>
        )}
      </div>
    </Sheet>
  );
}
