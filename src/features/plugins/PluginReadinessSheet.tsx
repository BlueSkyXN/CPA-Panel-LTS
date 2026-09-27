import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { authFilesApi, pluginsApi } from '@/services/api';
import type { AuthFileItem, PluginListEntry } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
import { getPluginTitle } from './pluginResources';
import { parsePluginReadiness, readinessAccounts, type PluginReadiness } from './pluginReadiness';
import styles from './PluginReadinessSheet.module.scss';

interface Props {
  plugin: PluginListEntry;
  onClose: () => void;
}

export function PluginReadinessSheet({ plugin, onClose }: Props) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<AuthFileItem[]>([]);
  const [authIndex, setAuthIndex] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<PluginReadiness | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  const sequence = useRef(0);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      sequence.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void authFilesApi
      .list()
      .then((data) => {
        if (!cancelled) setAccounts(readinessAccounts(data.files, plugin.executorProvider));
      })
      .catch(() => {
        if (!cancelled) setError(t('plugin_management.readiness_accounts_failed'));
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plugin.executorProvider, t]);

  const check = async () => {
    const request = ++sequence.current;
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const data = await pluginsApi.readiness(plugin.id, authIndex);
      if (active.current && request === sequence.current) setResult(parsePluginReadiness(data));
    } catch (err: unknown) {
      if (active.current && request === sequence.current)
        setError(getErrorMessage(err, t('plugin_management.readiness_failed')));
    } finally {
      if (active.current && request === sequence.current) setChecking(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('plugin_management.readiness_title', { name: getPluginTitle(plugin) })}
      description={t('plugin_management.readiness_hint')}
      footer={
        <Button onClick={check} loading={checking} disabled={loadingAccounts}>
          {t('plugin_management.check_readiness')}
        </Button>
      }
    >
      <div className={styles.content}>
        <label htmlFor="plugin-readiness-account">{t('plugin_management.readiness_account')}</label>
        <Select
          id="plugin-readiness-account"
          value={authIndex}
          disabled={checking || loadingAccounts}
          options={[
            { value: '', label: t('plugin_management.readiness_provider_only') },
            ...accounts.map((account) => ({
              value: String(account.authIndex),
              label: account.name,
            })),
          ]}
          onChange={(value) => {
            setAuthIndex(value);
            setResult(null);
          }}
        />
        {!loadingAccounts && accounts.length === 0 ? (
          <p>{t('plugin_management.readiness_no_accounts')}</p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <section aria-live="polite">
            <h3>
              {t(
                result.ready
                  ? 'plugin_management.readiness_ready'
                  : 'plugin_management.readiness_not_ready'
              )}
            </h3>
            <ul className={styles.checks}>
              {result.checks.map((check) => (
                <li key={check.level}>
                  <div className={styles.checkTitle}>
                    <strong>{t(`plugin_management.readiness_level_${check.level}`)}</strong>
                    <span>{t(`plugin_management.readiness_state_${check.state}`)}</span>
                  </div>
                  {check.version ? <small>{check.version}</small> : null}
                  {check.message ? <p>{check.message}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
