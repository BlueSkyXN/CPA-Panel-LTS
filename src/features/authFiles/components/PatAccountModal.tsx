import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import { patProvidersApi } from '@/services/api/patProviders';
import { useAuthStore } from '@/stores';
import { registerSessionBusyCheck, registerSessionLeaveCheck } from '@/services/connectionSession';
import type { AuthFileItem } from '@/types';
import {
  buildAccountAuth,
  isAccountFormProvider,
  newPatAuthFileName,
  normalizeAccountExtraModels,
  type AccountFormProvider,
} from '../patProviders';
import { CodingPlanLocalCredentialsHelp } from './CodingPlanLocalCredentialsHelp';
import { parsePriorityValue } from '@/features/authFiles/constants';
import {
  MAX_CREDENTIAL_WEIGHT,
  parseCredentialWeightText,
  validateCredentialWeightText,
} from '@/utils/credentialWeight';

interface Props {
  file?: AuthFileItem;
  onClose: () => void;
  onSaved: (name: string) => void;
}

export function PatAccountModal({ file, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const initialProvider = file?.type ?? file?.provider;
  const [provider, setProvider] = useState<AccountFormProvider>(
    isAccountFormProvider(initialProvider) ? initialProvider : 'codebuddy'
  );
  const [label, setLabel] = useState(String(file?.label || file?.name || ''));
  const [pat, setPat] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [extraModels, setExtraModels] = useState('');
  const [initialExtraModels, setInitialExtraModels] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [priority, setPriority] = useState('');
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [weightError, setWeightError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Awaited<ReturnType<typeof patProvidersApi.configuration>>>();
  const [configError, setConfigError] = useState(false);
  const [accountLoadError, setAccountLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const enabled = useAuthStore(
    (s) => s.pluginSupportKnown && s.supportsPlugin && s.connectionStatus === 'connected'
  );
  const base = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const previousConnection = useRef({ base, key });

  useEffect(() => registerSessionBusyCheck(() => saving), [saving]);
  useEffect(
    () =>
      registerSessionLeaveCheck(() =>
        Boolean(
          pat ||
          deviceId.trim() ||
          label !== String(file?.label || file?.name || '') ||
          (initialExtraModels !== null && extraModels !== initialExtraModels)
        )
      ),
    [pat, deviceId, label, file, extraModels, initialExtraModels]
  );

  useEffect(() => {
    if (previousConnection.current.base !== base || previousConnection.current.key !== key)
      onClose();
  }, [base, key, onClose]);

  useEffect(() => {
    const current = ++generation.current;
    setConfig(undefined);
    setConfigError(false);
    setAccountLoadError(false);
    setInitialExtraModels(null);
    if (enabled) {
      void Promise.all([
        patProvidersApi.configuration(provider),
        file && provider === 'zcode-coding-plan'
          ? authFilesApi
              .downloadJsonObject(file.name)
              .then((previous) => {
                if (previous.type !== provider) throw new Error('provider_mismatch');
                return normalizeAccountExtraModels(previous.exmodel).join(', ');
              })
              .catch(() => {
                throw new Error('account_load_failed');
              })
          : Promise.resolve(''),
      ])
        .then(([value, models]) => {
          if (current === generation.current) {
            setConfig(value);
            setExtraModels(models);
            setInitialExtraModels(models);
          }
        })
        .catch((error) => {
          if (current === generation.current) {
            setConfigError(true);
            setAccountLoadError(error instanceof Error && error.message === 'account_load_failed');
          }
        });
    }
    return () => {
      generation.current = current + 1;
    };
  }, [provider, enabled, base, key, retry, file]);

  const save = async () => {
    if (saving || !enabled || !config) return;
    const current = generation.current;
    setError('');
    setWeightError('');
    let auth: Record<string, unknown> = {};
    let models: string[] | undefined;
    try {
      if (
        provider === 'zcode-coding-plan' &&
        config.supportsExtraModels &&
        (!file || extraModels !== initialExtraModels)
      ) {
        models = normalizeAccountExtraModels(
          extraModels
            .split(/[,\n]/)
            .map((model) => model.trim())
            .filter(Boolean)
        );
      }
      if (!file) auth = buildAccountAuth(provider, label, pat, deviceId, undefined, models);
    } catch (error) {
      setError(
        t(
          error instanceof Error && error.message === 'invalid_extra_models'
            ? 'pat_accounts.invalid_extra_models'
            : provider === 'zcode-coding-plan'
              ? 'pat_accounts.invalid_api_key'
              : 'pat_accounts.invalid_pat'
        )
      );
      return;
    }
    if (!file) {
      const trimmedPrefix = prefix.trim();
      const trimmedPriority = priority.trim();
      const trimmedNote = note.trim();
      const priorityValue = parsePriorityValue(trimmedPriority);
      if (trimmedPriority && priorityValue === undefined) {
        setError(t('pat_accounts.priority_invalid'));
        return;
      }
      const weightProblem = validateCredentialWeightText(weight);
      if (weightProblem) {
        setWeightError(
          t(
            weightProblem === 'max'
              ? 'auth_files.weight_invalid_max'
              : 'auth_files.weight_invalid_integer'
          )
        );
        return;
      }
      const weightValue = parseCredentialWeightText(weight);
      if (trimmedPrefix) auth.prefix = trimmedPrefix;
      if (priorityValue !== undefined) auth.priority = priorityValue;
      if (weightValue !== undefined) auth.weight = weightValue;
      if (trimmedNote) auth.note = trimmedNote;
    }
    setSaving(true);
    try {
      if (file) {
        const previous = await authFilesApi.downloadJsonObject(file.name);
        if (current !== generation.current) return;
        auth = buildAccountAuth(provider, label, pat, deviceId, previous, models);
      }
      const name = file?.name ?? newPatAuthFileName(provider);
      await authFilesApi.saveJsonObject(name, auth);
      if (current !== generation.current) return;
      setPat('');
      onSaved(name);
    } catch (error) {
      if (current === generation.current) {
        const validationKey =
          error instanceof Error && error.message === 'invalid_api_key'
            ? 'pat_accounts.invalid_api_key'
            : error instanceof Error && error.message === 'invalid_pat'
              ? 'pat_accounts.invalid_pat'
              : 'pat_accounts.save_failed';
        setError(t(validationKey));
      }
    } finally {
      if (current === generation.current) setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={t(file ? 'pat_accounts.update' : 'pat_accounts.add')}
      onClose={onClose}
      closeDisabled={saving}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={
              !enabled || !config || (!pat.trim() && !(file && provider === 'zcode-coding-plan'))
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="form-group">
        <Select
          value={provider}
          options={[
            { value: 'codebuddy', label: 'CodeBuddy' },
            { value: 'qoder', label: 'Qoder' },
            { value: 'zcode-coding-plan', label: t('auth_files.filter_zcode-coding-plan') },
          ]}
          ariaLabel={t('pat_accounts.provider')}
          disabled={Boolean(file) || saving}
          onChange={(value) => {
            if (isAccountFormProvider(value)) {
              setProvider(value);
              setPat('');
              setDeviceId('');
              setExtraModels('');
              setConfig(undefined);
              setError('');
            }
          }}
          fullWidth
        />
      </div>
      <Input
        label={t('pat_accounts.label')}
        value={label}
        maxLength={120}
        disabled={saving}
        onChange={(e) => setLabel(e.target.value)}
      />
      <Input
        label={provider === 'zcode-coding-plan' ? t('pat_accounts.api_key_label') : 'PAT'}
        type="password"
        value={pat}
        autoComplete="new-password"
        spellCheck={false}
        disabled={saving}
        onChange={(e) => setPat(e.target.value)}
        hint={t(
          file && provider === 'zcode-coding-plan'
            ? 'pat_accounts.keep_api_key_hint'
            : `pat_accounts.hint_${provider}`
        )}
      />
      {provider === 'zcode-coding-plan' && (
        <Input
          label={t('pat_accounts.device_id_label')}
          type="password"
          value={deviceId}
          autoComplete="new-password"
          spellCheck={false}
          disabled={saving}
          onChange={(e) => setDeviceId(e.target.value)}
          hint={t('pat_accounts.device_id_hint')}
        />
      )}
      {provider === 'zcode-coding-plan' && (
        <Input
          label={t('pat_accounts.extra_models_label')}
          value={extraModels}
          placeholder="glm-5.3-highspeed, glm-5.3-flashx"
          autoComplete="off"
          spellCheck={false}
          disabled={saving || !config?.supportsExtraModels}
          onChange={(e) => setExtraModels(e.target.value)}
          hint={t(
            config && !config.supportsExtraModels
              ? 'pat_accounts.extra_models_upgrade'
              : 'pat_accounts.extra_models_hint'
          )}
        />
      )}
      {provider === 'zcode-coding-plan' && <CodingPlanLocalCredentialsHelp />}
      {!file && (
        <details style={{ margin: '12px 0' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {t('pat_accounts.advanced_options')}
          </summary>
          <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
            <Input
              label={t('auth_files.prefix_label')}
              value={prefix}
              placeholder={t('auth_files.prefix_placeholder')}
              hint={t('auth_files.prefix_hint')}
              disabled={saving}
              onChange={(e) => setPrefix(e.target.value)}
            />
            <Input
              label={t('auth_files.priority_label')}
              value={priority}
              type="number"
              step="1"
              placeholder={t('auth_files.priority_placeholder')}
              hint={t('auth_files.priority_hint')}
              disabled={saving}
              onChange={(e) => setPriority(e.target.value)}
            />
            <Input
              label={t('auth_files.weight_label')}
              value={weight}
              type="number"
              min={0}
              max={MAX_CREDENTIAL_WEIGHT}
              placeholder="1"
              hint={t('auth_files.weight_hint')}
              error={weightError || undefined}
              disabled={saving}
              onChange={(e) => {
                setWeight(e.target.value);
                setWeightError('');
              }}
            />
            <Input
              label={t('auth_files.note_label')}
              value={note}
              placeholder={t('auth_files.note_placeholder')}
              hint={t('auth_files.note_hint')}
              disabled={saving}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </details>
      )}
      <p className="hint">{t('pat_accounts.storage_hint')}</p>
      {file && (
        <p className="hint">
          {t(
            provider === 'zcode-coding-plan'
              ? 'pat_accounts.zcode_edit_hint'
              : 'pat_accounts.replace_hint',
            { name: file.name }
          )}
        </p>
      )}
      {config && (
        <p className="hint" style={{ overflowWrap: 'anywhere' }}>
          {t('pat_accounts.configuration', {
            mode: config.transport,
            endpoint: config.endpoint || '—',
          })}
        </p>
      )}
      {enabled && !config && !configError && <p role="status">{t('pat_accounts.loading')}</p>}
      {(!enabled || configError) && (
        <div className="error-box" role="alert">
          {t(
            accountLoadError
              ? 'pat_accounts.account_load_failed'
              : 'pat_accounts.plugin_unavailable'
          )}
          {enabled && (
            <Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>
              {t('pat_accounts.retry')}
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
