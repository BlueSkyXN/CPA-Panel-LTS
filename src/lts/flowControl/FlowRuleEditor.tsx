import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  dimensionsForRule,
  modelOptionsForStage,
  selectionOf,
  setSelection,
  type FlowCapabilities,
  type FlowRule,
} from './model';
import { ruleSentence } from './insights';
import { SelectionField } from './SelectionField';
import styles from './styles.module.scss';

type Props = {
  rule: FlowRule;
  index: number;
  data: FlowCapabilities;
  disabled: boolean;
  onChange: (rule: FlowRule) => void;
  onRemove: () => void;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

// A rule has one editor, regardless of its combination of grouping dimensions.
// Filtering traffic and choosing how it shares capacity remain separate inputs.
export function FlowRuleEditor({ rule, index, data, disabled, onChange, onRemove }: Props) {
  const { t, i18n } = useTranslation();
  const dimensions = dimensionsForRule(rule);
  const refs = { keys: data.keys, accounts: data.accounts };
  const patch = (values: Partial<FlowRule>) => onChange({ ...rule, ...values });
  const group = (dimension: string, separate: boolean) => patch({
    scope: 'custom',
    'group-by': separate
      ? [...new Set([...dimensions, dimension])]
      : dimensions.filter(value => value !== dimension),
  });
  const changeStage = (stage: string) => {
    const next: FlowRule = {
      ...rule,
      stage,
      scope: 'custom',
      'group-by': dimensions.filter(value => stage !== 'request' || ['key', 'model'].includes(value)),
    };
    // Aliases and actual targets are different namespaces. Changing stage must
    // not silently carry a qualified upstream filter into the request stage.
    if (selectionOf(next, 'models') !== undefined) {
      delete next.model;
      next.models = [];
    }
    if (stage === 'request') {
      delete next.account;
      delete next.accounts;
      delete next.credential;
      delete next.provider;
      delete next['auth-kind'];
    }
    onChange(next);
  };
  const keyOptions = [
    { value: 'anonymous', label: t('flow_control.anonymous') },
    ...data.keys.map(value => ({ value: value.ref, label: value.label })),
  ];
  const accountOptions = data.accounts.map(value => ({
    value: value.ref,
    label: `${value.provider || ''} · ${value.label}`,
  }));
  const windows = rule.windows ?? [];
  const updateWindow = (index: number, field: 'requests' | 'period-ms', value: number) => patch({
    windows: windows.map((window, position) => position === index ? { ...window, [field]: value } : window),
  });

  return (
    <fieldset className={styles.rule} disabled={disabled}>
      <legend>{rule.label || `${t('flow_control.rule')} ${index + 1}`}</legend>
      <p className={styles.ruleSummary}>{ruleSentence(rule, refs, i18n.language)}</p>
      <div className={styles.grid}>
        <Field label={t('flow_control.rule_label')}>
          <input value={rule.label || ''} maxLength={128} onChange={e => patch({ label: e.target.value })} />
        </Field>
        <Field label={t('flow_control.rule_id')}>
          <input value={rule.id} maxLength={64} onChange={e => patch({ id: e.target.value })} />
        </Field>
        <Field label={t('flow_control.stage')}>
          <select value={rule.stage} onChange={e => changeStage(e.target.value)}>
            <option value="request">{t('flow_control.stage_request')}</option>
            <option value="attempt">{t('flow_control.stage_attempt')}</option>
          </select>
        </Field>
        <Field label={t('flow_control.concurrent')}>
          <input
            type="number" min="0" max="100000" step="1"
            value={rule['max-concurrent'] ?? 0}
            onChange={e => patch({ 'max-concurrent': Number(e.target.value) })}
          />
        </Field>
      </div>

      <div className={styles.groupGrid} aria-label={t('flow_control.v3_grouping')}>
        <strong>{t('flow_control.v3_grouping')}</strong>
        <p className={styles.hint}>{t('flow_control.v3_group_hint')}</p>
        {(rule.stage === 'request' ? ['key', 'model'] : ['key', 'model', 'account']).map(dimension => (
          <Field key={dimension} label={t(`flow_control.dim_${dimension}`)}>
            <select
              value={dimensions.includes(dimension) ? 'separate' : 'shared'}
              onChange={e => group(dimension, e.target.value === 'separate')}
            >
              <option value="shared">{t('flow_control.v3_shared')}</option>
              <option value="separate">{t('flow_control.v3_separate')}</option>
            </select>
          </Field>
        ))}
      </div>

      <div className={styles.selectionGrid}>
        <SelectionField
          label={t('flow_control.key_filter')}
          value={selectionOf(rule, 'keys')} options={keyOptions} disabled={disabled}
          onChange={value => onChange(setSelection(rule, 'keys', value))}
        />
        <SelectionField
          label={t(rule.stage === 'attempt' ? 'flow_control.actual_model' : 'flow_control.requested_model')}
          value={selectionOf(rule, 'models')} options={modelOptionsForStage(data, rule.stage)}
          disabled={disabled} allowCustom
          onChange={value => onChange(setSelection(rule, 'models', value))}
        />
        {rule.stage === 'attempt' && (
          <SelectionField
            label={t('flow_control.account_filter')}
            value={selectionOf(rule, 'accounts')} options={accountOptions} disabled={disabled}
            onChange={value => onChange(setSelection(rule, 'accounts', value))}
          />
        )}
      </div>
      {rule.stage === 'attempt' && (
        <>
          <p className={styles.hint}>{t('flow_control.resolved_model_hint')}</p>
          {!data.features?.includes('resolved-model-options') && (
            <p className={styles.notice}>{t('flow_control.unresolved_catalog')}</p>
          )}
          {data['model-options-truncated'] && (
            <p className={styles.notice}>{t('flow_control.catalog_truncated')}</p>
          )}
          <details>
            <summary>{t('flow_control.v3_advanced_filter')}</summary>
            <div className={styles.grid}>
              <Field label={t('flow_control.provider_filter')}>
                <input
                  value={rule.provider || ''} placeholder="*" maxLength={64}
                  onChange={e => patch({ provider: e.target.value })}
                />
              </Field>
              <Field label={t('flow_control.auth_kind')}>
                <select value={rule['auth-kind'] || '*'} onChange={e => patch({ 'auth-kind': e.target.value })}>
                  <option value="*">{t('flow_control.all')}</option>
                  <option value="oauth">OAuth</option>
                  <option value="apikey">API Key</option>
                </select>
              </Field>
            </div>
            <div className={styles.dimensionPicker}>
              {['provider', 'auth-kind'].map(dimension => (
                <label key={dimension}>
                  <input
                    type="checkbox" checked={dimensions.includes(dimension)}
                    onChange={e => group(dimension, e.target.checked)}
                  />
                  {t('flow_control.v3_separate')} · {t(`flow_control.dim_${dimension}`)}
                </label>
              ))}
            </div>
          </details>
        </>
      )}

      <details>
        <summary>{t('flow_control.v3_windows')}</summary>
        <p className={styles.hint}>{t('flow_control.v3_windows_hint')}</p>
        {windows.map((window, windowIndex) => (
          <div key={windowIndex} className={styles.window}>
            <Field label={t('flow_control.window_requests')}>
              <input
                type="number" min="1" value={window.requests}
                onChange={e => updateWindow(windowIndex, 'requests', Number(e.target.value))}
              />
            </Field>
            <Field label={t('flow_control.window_ms')}>
              <input
                type="number" min="1" value={window['period-ms']}
                onChange={e => updateWindow(windowIndex, 'period-ms', Number(e.target.value))}
              />
            </Field>
            <Button
              type="button" size="sm" variant="ghost"
              onClick={() => patch({ windows: windows.filter((_, i) => i !== windowIndex) })}
            >
              {t('flow_control.remove_window')}
            </Button>
          </div>
        ))}
        <Button
          type="button" size="sm" variant="secondary" disabled={disabled || windows.length >= 8}
          onClick={() => patch({ windows: [...windows, { requests: 1, 'period-ms': 1000 }] })}
        >
          {t('flow_control.add_window')}
        </Button>
      </details>
      <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
        {t('flow_control.remove_rule')}
      </Button>
    </fieldset>
  );
}
