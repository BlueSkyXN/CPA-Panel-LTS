import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { patProvidersApi } from '@/services/api/patProviders';
import type { AuthFileItem } from '@/types';
import {
  isPatProvider,
  type PatProvider,
  type PatQuotaValues,
  type PatSummary,
} from '../patProviders';
import styles from './PatAccountSummary.module.scss';

function QuotaValues({ quota }: { quota: PatQuotaValues }) {
  const { t } = useTranslation();
  return (
    <dl className={styles.values}>
      {(['total', 'used', 'remaining'] as const).map((key) => (
        <div key={key}>
          <dt>{t(`pat_accounts.${key}`)}</dt>
          <dd>
            {quota[key]} {quota.unit}
          </dd>
        </div>
      ))}
      {quota.expiresAt && (
        <div>
          <dt>{t('pat_accounts.expires')}</dt>
          <dd>{quota.expiresAt}</dd>
        </div>
      )}
    </dl>
  );
}

export function PatSummaryDetails({ summary }: { summary: PatSummary }) {
  const { t } = useTranslation();
  const status = (value: string) =>
    t(`pat_accounts.status.${value}`, { defaultValue: t('pat_accounts.status.unknown') });
  return (
    <>
      <dl className={styles.values}>
        <div>
          <dt>{t('pat_accounts.account')}</dt>
          <dd>
            {summary.accountName || summary.label || '—'} · {status(summary.accountStatus)}
          </dd>
        </div>
        <div>
          <dt>{t('pat_accounts.plan')}</dt>
          <dd>
            {summary.planName || '—'} · {status(summary.planStatus)}
          </dd>
        </div>
        <div>
          <dt>{t('pat_accounts.quota')}</dt>
          <dd>{status(summary.quota.status)}</dd>
        </div>
      </dl>
      <QuotaValues quota={summary.quota} />
      {summary.packages.length > 0 && (
        <details>
          <summary>{t('pat_accounts.packages', { count: summary.packages.length })}</summary>
          {summary.packages.map((item, index) => (
            <div key={index} className={styles.package}>
              <strong>{item.name || '—'}</strong>
              {item.status && <span> · {item.status}</span>}
              {item.available === false && <span> · {t('pat_accounts.inactive_package')}</span>}
              <QuotaValues quota={item} />
            </div>
          ))}
        </details>
      )}
      <p className={styles.timestamp}>
        {t('pat_accounts.updated', { time: summary.updatedAt || '—' })}
        {summary.cached && ` · ${t('pat_accounts.cached')}`}
      </p>
    </>
  );
}

function SummaryLoader({
  file,
  provider,
  disabled,
}: {
  file: AuthFileItem;
  provider: PatProvider;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<PatSummary>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = async () => {
    if (disabled || loading) return;
    const index = String(file.auth_index ?? file.authIndex ?? '').trim();
    if (!index) {
      setError(t('pat_accounts.missing_index'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await patProvidersApi.summary(provider, index);
      if (alive.current) setSummary(result);
    } catch {
      if (alive.current) {
        setSummary(undefined);
        setError(t('pat_accounts.summary_failed'));
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  return (
    <section className={styles.summary} aria-label={t('pat_accounts.quota')}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void refresh()}
        loading={loading}
        disabled={disabled}
      >
        {t(summary ? 'pat_accounts.refresh' : 'pat_accounts.view_quota')}
      </Button>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {summary && <PatSummaryDetails summary={summary} />}
    </section>
  );
}

export function PatAccountSummary({ file, disabled }: { file: AuthFileItem; disabled: boolean }) {
  const provider = file.type ?? file.provider;
  const generation = useQuotaStore((s) => s.cacheGeneration);
  const base = useAuthStore((s) => s.apiBase);
  const supported = useAuthStore((s) => s.pluginSupportKnown && s.supportsPlugin);
  if (!isPatProvider(provider)) return null;
  return (
    <SummaryLoader
      key={`${base}:${generation}:${file.name}:${String(file.modtime ?? file.modified ?? '')}:${String(file.disabled)}`}
      file={file}
      provider={provider}
      disabled={disabled || !supported}
    />
  );
}
