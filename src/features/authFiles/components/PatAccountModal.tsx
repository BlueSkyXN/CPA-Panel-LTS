import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import { patProvidersApi } from '@/services/api/patProviders';
import { useAuthStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { buildPatAuth, isPatProvider, newPatAuthFileName, type PatProvider } from '../patProviders';

interface Props {
  file?: AuthFileItem;
  onClose: () => void;
  onSaved: (name: string) => void;
}

export function PatAccountModal({ file, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const initialProvider = file?.type ?? file?.provider;
  const [provider, setProvider] = useState<PatProvider>(
    isPatProvider(initialProvider) ? initialProvider : 'codebuddy'
  );
  const [label, setLabel] = useState(String(file?.label || file?.name || ''));
  const [pat, setPat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Awaited<ReturnType<typeof patProvidersApi.configuration>>>();
  const [configError, setConfigError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const enabled = useAuthStore(
    (s) => s.pluginSupportKnown && s.supportsPlugin && s.connectionStatus === 'connected'
  );
  const base = useAuthStore((s) => s.apiBase);
  const key = useAuthStore((s) => s.managementKey);
  const previousConnection = useRef({ base, key });

  useEffect(() => {
    if (previousConnection.current.base !== base || previousConnection.current.key !== key)
      onClose();
  }, [base, key, onClose]);

  useEffect(() => {
    const current = ++generation.current;
    setConfig(undefined);
    setConfigError(false);
    if (enabled) {
      void patProvidersApi
        .configuration(provider)
        .then((value) => {
          if (current === generation.current) setConfig(value);
        })
        .catch(() => {
          if (current === generation.current) setConfigError(true);
        });
    }
    return () => {
      generation.current = current + 1;
    };
  }, [provider, enabled, base, key, retry]);

  const save = async () => {
    if (saving || !enabled || !config) return;
    const current = generation.current;
    setError('');
    let auth: Record<string, unknown>;
    try {
      auth = buildPatAuth(provider, label, pat);
    } catch {
      setError(t('pat_accounts.invalid_pat'));
      return;
    }
    setSaving(true);
    try {
      if (file) {
        const previous = await authFilesApi.downloadJsonObject(file.name);
        if (current !== generation.current) return;
        auth = buildPatAuth(provider, label, pat, previous);
      }
      const name = file?.name ?? newPatAuthFileName(provider);
      await authFilesApi.saveJsonObject(name, auth);
      if (current !== generation.current) return;
      setPat('');
      onSaved(name);
    } catch {
      if (current === generation.current) setError(t('pat_accounts.save_failed'));
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
            disabled={!enabled || !config || !pat.trim()}
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
          ]}
          ariaLabel={t('pat_accounts.provider')}
          disabled={Boolean(file) || saving}
          onChange={(value) => {
            if (isPatProvider(value)) {
              setProvider(value);
              setPat('');
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
        label="PAT"
        type="password"
        value={pat}
        autoComplete="new-password"
        spellCheck={false}
        disabled={saving}
        onChange={(e) => setPat(e.target.value)}
        hint={t(`pat_accounts.hint_${provider}`)}
      />
      <p className="hint">{t('pat_accounts.storage_hint')}</p>
      {file && <p className="hint">{t('pat_accounts.replace_hint', { name: file.name })}</p>}
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
          {t('pat_accounts.plugin_unavailable')}
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
