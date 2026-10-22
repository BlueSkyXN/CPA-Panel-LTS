import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { configApi } from '@/services/api/config';
import { interpretProxyProbe, proxyProbeErrorCode } from '@/utils/proxyProbe';
import styles from './ProxyUrlField.module.scss';

interface ProxyUrlFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  inputClassName?: string;
}

type ProbeView =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'success'; code: 'reachable' | 'direct' }
  | { state: 'error'; code: string };

export function ProxyUrlField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  id,
  className = '',
  inputClassName = '',
}: ProxyUrlFieldProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [probe, setProbe] = useState<ProbeView>({ state: 'idle' });
  const [probedValue, setProbedValue] = useState('');

  const current = value.trim();
  const result = probe.state !== 'idle' && probe.state !== 'loading' && probedValue === current ? probe : null;

  const runProbe = async () => {
    setProbedValue(current);
    setProbe({ state: 'loading' });
    try {
      const response = await configApi.testProxyUrl(value);
      const outcome = interpretProxyProbe(response);
      setProbe(outcome.state === 'success' ? { state: 'success', code: outcome.code } : { state: 'error', code: outcome.code });
    } catch (err) {
      setProbe({ state: 'error', code: proxyProbeErrorCode(err) });
    }
  };

  const message = result?.state === 'success'
    ? t(`common.proxy_probe.${result.code}`)
    : result?.state === 'error'
      ? t(`common.proxy_probe.${result.code}`, { defaultValue: t('common.proxy_probe.probe_failed') })
      : '';

  return (
    <div className={`${styles.field} ${className}`.trim()}>
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <div className={styles.row}>
        <input
          id={inputId}
          className={`input ${styles.input} ${inputClassName}`.trim()}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void runProbe()}
          disabled={disabled || probe.state === 'loading'}
          loading={probe.state === 'loading'}
        >
          {probe.state === 'loading' ? t('common.proxy_probe.testing') : t('common.proxy_probe.test')}
        </Button>
      </div>
      {message ? (
        <div className={result?.state === 'error' ? 'error-box' : 'hint'} role={result?.state === 'error' ? 'alert' : 'status'}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
