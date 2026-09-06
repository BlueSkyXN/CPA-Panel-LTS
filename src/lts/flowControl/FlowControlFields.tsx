import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { apiClient } from '@/services/api/client';
import { asRecord, dimensionsForRule, flowIssues, nextRule, parseRules, policyFromValues, selectionOf, setSelection, mergeMigration, type FlowControlValues, type FlowRule, type FlowSupport } from './model';
import { useFlowControlStatus, type FlowLiveState } from './useStatus';
import { SelectionField } from './SelectionField';
import { RuleInspector } from './RuleInspector';
import { LiveMonitor } from './LiveMonitor';
import { ruleSentence } from './insights';
import styles from './styles.module.scss';
type Props = {
    values: FlowControlValues;
    disabled?: boolean;
    onChange: (patch: Partial<FlowControlValues>) => void;
};
function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) {
    return <label className={styles.field}><span>{label}</span>{children}</label>;
}
export function FlowControlFieldsView({ values, disabled = false, onChange, support, onRefresh, live = false, setLive = () => { }, liveState = 'off', history = [] }: Props & {
    support: FlowSupport;
    onRefresh: () => void;
    live?: boolean;
    setLive?: (value: boolean) => void;
    liveState?: FlowLiveState;
    history?: Array<{
        requests: number;
        attempts: number;
        waiting: number;
    }>;
}) {
    const { t, i18n } = useTranslation();
    const id = useId();
    const data = support.state === 'ready' ? support.data : null;
    const supported = !disabled && data?.supported === true && data['schema-version'] >= 3;
    const legacy = Number(values.flowControlVersion || 0) < 3;
    const editable = supported && !legacy;
    const rules = parseRules(values.flowControlRulesText);
    const issues = flowIssues(values);
    const refs = { keys: data?.keys ?? [], accounts: data?.accounts ?? [] };
    const [migration, setMigration] = useState<{
        config: Record<string, unknown>;
        issues: Array<{
            rule?: string;
            reason: string;
        }>;
        ready: boolean;
        source: string;
    } | null>(null);
    const [migrationError, setMigrationError] = useState(false), [migrationBusy, setMigrationBusy] = useState(false), [ack, setAck] = useState(false);
    const source = JSON.stringify(policyFromValues(values));
    const previewMigration = async () => {
        setMigrationBusy(true);
        setMigrationError(false);
        setAck(false);
        try {
            const raw = asRecord(await apiClient.post<unknown>('/flow-control/migration-preview', policyFromValues(values)));
            if (!raw || !asRecord(raw.config) || !Array.isArray(raw.issues))
                throw new Error('Invalid migration');
            setMigration({ config: raw.config as Record<string, unknown>, issues: raw.issues as Array<{
                    rule?: string;
                    reason: string;
                }>, ready: raw.ready === true, source });
        }
        catch {
            setMigrationError(true);
        }
        finally {
            setMigrationBusy(false);
        }
    };
    const changeRules = (items: FlowRule[]) => onChange({ flowControlRulesText: JSON.stringify(items, null, 2) });
    const updateRule = (index: number, rule: FlowRule) => rules && changeRules(rules.map((r, i) => i === index ? rule : r));
    const patchRule = (index: number, patch: Partial<FlowRule>) => rules && updateRule(index, { ...rules[index], ...patch });
    const scalar = (field: keyof FlowControlValues, label: string, placeholder: string, allow = editable) => <Field label={t(`flow_control.${label}`)}><input type="number" min="0" step="1" disabled={!allow} value={String(values[field])} placeholder={placeholder} onChange={e => onChange({ [field]: e.target.value })}/></Field>;
    const keyOptions = [{ value: 'anonymous', label: t('flow_control.anonymous') }, ...refs.keys.map(r => ({ value: r.ref, label: r.label }))];
    const accountOptions = refs.accounts.map(r => ({ value: r.ref, label: `${r.provider || ''} · ${r.label}` }));
    const modelOptions = (stage: string) => stage === 'attempt' && data?.['model-options'].length ? data['model-options'].map(r => ({ value: r.ref, label: `${r.provider} · ${r.model}` })) : (data?.models ?? []).map(value => ({ value, label: value }));
    return <section className={styles.card} aria-labelledby={`${id}-title`} data-testid="flow-control-settings">
    <div className={styles.heading}><h3 id={`${id}-title`}>{t('flow_control.title')}</h3><ToggleSwitch checked={values.flowControlEnabled} disabled={!supported} label={t('flow_control.enabled')} ariaLabel={t('flow_control.enabled')} onChange={flowControlEnabled => onChange({ flowControlEnabled })}/></div>
    <p className={styles.hint}>{t('flow_control.v3_description')}</p>
    {support.state !== 'ready' && <p role="status">{t(`flow_control.${support.state}`)}</p>}
    {data && data['schema-version'] < 3 && <p className={styles.notice}>{t('flow_control.v3_required')}</p>}
    {data && !data.supported && <p className={styles.notice}>{t('flow_control.home_unsupported')}</p>}
    {data?.['configuration-error'] && <p className="error-box">{t('flow_control.runtime_error')}</p>}
    <LiveMonitor data={data} live={live} setLive={setLive} liveState={liveState} history={history} onRefresh={onRefresh}/>
    <details className={styles.inspector}><summary>{t('flow_control.v3_observation')}</summary>
      <p className={styles.hint}>{t('flow_control.v3_observation_hint')}</p>
      <div className={styles.grid}>
        <ToggleSwitch checked={values.flowControlRealtime} disabled={!supported} label={t('flow_control.v3_realtime')} ariaLabel={t('flow_control.v3_realtime')} onChange={flowControlRealtime => onChange({ flowControlRealtime })}/>
        <ToggleSwitch checked={values.flowControlResources} disabled={!supported} label={t('flow_control.v3_resources')} ariaLabel={t('flow_control.v3_resources')} onChange={flowControlResources => onChange({ flowControlResources })}/>
        {scalar('flowControlIntervalMs', 'v3_interval', '2000', supported)}
        {scalar('flowControlMaxObservers', 'v3_observers', '4', supported)}
      </div>
    </details>
    {legacy && <section className={styles.notice} aria-label={t('flow_control.v3_migration')}>
      <h4>{t('flow_control.v3_migration')}</h4><p>{t('flow_control.v3_migration_hint')}</p>
      <Button type="button" variant="secondary" disabled={!supported || migrationBusy} onClick={() => { void previewMigration(); }}>{t('flow_control.v3_migration_preview')}</Button>
      {migrationError && <p role="alert">{t('flow_control.v3_migration_error')}</p>}
      {migration && migration.source === source && <>
        {migration.issues.map((v, i) => <p key={i} role="status">{v.rule ? `${v.rule}: ` : ''}{v.reason}</p>)}
        {migration.ready && <><p>{t('flow_control.v3_migration_ready')}</p><label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>{t('flow_control.v3_migration_ack')}</label>
          <Button type="button" variant="secondary" disabled={!ack || !rules || !supported} onClick={() => { const converted = migration.config.rules ?? []; if (rules && Array.isArray(converted))
                    onChange({ flowControlVersion: '3', flowControlRulesText: JSON.stringify(mergeMigration(rules, converted as FlowRule[]), null, 2) }); }}>{t('flow_control.v3_apply_draft')}</Button></>}
      </>}
      {!!rules?.length && <div className={styles.table}><table><tbody>{rules.map(r => <tr key={r.id}><th>{r.label || r.id}</th><td>{ruleSentence(r, refs, i18n.language)}</td></tr>)}</tbody></table></div>}
    </section>}
    {!legacy && <>
      <RuleInspector values={values} data={data}/>
      <h4>{t('flow_control.edit_policy')}</h4>
      <div className={styles.grid}>{scalar('flowControlMaxWaiting', 'max_waiting', '0')}{scalar('flowControlMaxWaitingPerKey', 'max_waiting_key', t('flow_control.same_as_queue'))}{scalar('flowControlMaxWaitMs', 'wait_ms', '0')}{scalar('flowControlMaxBytes', 'queue_bytes', '67108864')}</div>
      <p className={styles.hint}>{t('flow_control.v3_wait_hint')}</p>
      <details><summary>{t('flow_control.memory_bounds')}</summary><div className={styles.grid}>{scalar('flowControlMaxBuckets', 'max_buckets', '10000')}{scalar('flowControlMaxHistory', 'max_history', '200000')}</div></details>
      <p className={styles.notice}>{t('flow_control.v3_rule_hint')}</p>
      {!rules && <p className="error-box">{t('flow_control.invalid_rules')}</p>}
      {issues.length > 0 && <div className="error-box" role="alert">{issues.slice(0, 8).map((x, i) => <div key={i}>{x.rule ? `${x.rule}: ` : ''}{t(`flow_control.${x.code}`)}</div>)}</div>}
      {rules?.map((r, index) => <fieldset key={index} className={styles.rule} disabled={!editable}>
        <legend>{r.label || `${t('flow_control.rule')} ${index + 1}`}</legend>
        <p className={styles.ruleSummary}>{ruleSentence(r, refs, i18n.language)}</p>
        <div className={styles.grid}>
          <Field label={t('flow_control.rule_label')}><input value={r.label || ''} maxLength={128} onChange={e => patchRule(index, { label: e.target.value })}/></Field>
          <Field label={t('flow_control.rule_id')}><input value={r.id} maxLength={64} onChange={e => patchRule(index, { id: e.target.value })}/></Field>
          <Field label={t('flow_control.stage')}><select value={r.stage} onChange={e => { const next = { ...r, stage: e.target.value, scope: 'custom', 'group-by': dimensionsForRule(r).filter(d => e.target.value !== 'request' || ['key', 'model'].includes(d)) }; if (next.stage === 'request') {
                if (selectionOf(next, 'models') !== undefined) {
                    delete next.model;
                    next.models = [];
                }
                delete next.account;
                delete next.accounts;
                delete next.credential;
                delete next.provider;
                delete next['auth-kind'];
            } updateRule(index, next); }}><option value="request">{t('flow_control.stage_request')}</option><option value="attempt">{t('flow_control.stage_attempt')}</option></select></Field>
          <Field label={t('flow_control.concurrent')}><input type="number" min="0" max="100000" step="1" value={r['max-concurrent'] ?? 0} onChange={e => patchRule(index, { 'max-concurrent': Number(e.target.value) })}/></Field>
        </div>
        <div className={styles.groupGrid} aria-label={t('flow_control.v3_grouping')}>
          <strong>{t('flow_control.v3_grouping')}</strong><p className={styles.hint}>{t('flow_control.v3_group_hint')}</p>
          {(r.stage === 'request' ? ['key', 'model'] : ['key', 'model', 'account']).map(d => <Field key={d} label={t(`flow_control.dim_${d}`)}><select value={dimensionsForRule(r).includes(d) ? 'separate' : 'shared'} onChange={e => patchRule(index, { scope: 'custom', 'group-by': e.target.value === 'separate' ? [...new Set([...dimensionsForRule(r), d])] : dimensionsForRule(r).filter(v => v !== d) })}><option value="shared">{t('flow_control.v3_shared')}</option><option value="separate">{t('flow_control.v3_separate')}</option></select></Field>)}
        </div>
        <div className={styles.selectionGrid}>
          <SelectionField label={t('flow_control.key_filter')} value={selectionOf(r, 'keys')} options={keyOptions} onChange={v => updateRule(index, setSelection(r, 'keys', v))} disabled={!editable}/>
          <SelectionField label={t(r.stage === 'attempt' ? 'flow_control.actual_model' : 'flow_control.requested_model')} value={selectionOf(r, 'models')} options={modelOptions(r.stage)} allowCustom onChange={v => updateRule(index, setSelection(r, 'models', v))} disabled={!editable}/>
          {r.stage === 'attempt' && <SelectionField label={t('flow_control.account_filter')} value={selectionOf(r, 'accounts')} options={accountOptions} onChange={v => updateRule(index, setSelection(r, 'accounts', v))} disabled={!editable}/>}
        </div>
        {r.stage === 'attempt' && <details><summary>{t('flow_control.v3_advanced_filter')}</summary><div className={styles.grid}>
          <Field label={t('flow_control.provider_filter')}><input value={r.provider || ''} placeholder="*" maxLength={64} onChange={e => patchRule(index, { provider: e.target.value })}/></Field>
          <Field label={t('flow_control.auth_kind')}><select value={r['auth-kind'] || '*'} onChange={e => patchRule(index, { 'auth-kind': e.target.value })}><option value="*">{t('flow_control.all')}</option><option value="oauth">OAuth</option><option value="apikey">API Key</option></select></Field>
        </div><div className={styles.dimensionPicker}>{['provider', 'auth-kind'].map(d => <label key={d}><input type="checkbox" checked={dimensionsForRule(r).includes(d)} onChange={e => patchRule(index, { scope: 'custom', 'group-by': e.target.checked ? [...new Set([...dimensionsForRule(r), d])] : dimensionsForRule(r).filter(v => v !== d) })}/>{t('flow_control.v3_separate')} · {t(`flow_control.dim_${d}`)}</label>)}</div></details>}
        <details><summary>{t('flow_control.v3_windows')}</summary>
          <p className={styles.hint}>{t('flow_control.v3_windows_hint')}</p>
          {r.windows?.map((w, wi) => <div key={wi} className={styles.window}><Field label={t('flow_control.window_requests')}><input type="number" min="1" value={w.requests} onChange={e => patchRule(index, { windows: r.windows?.map((a, i) => i === wi ? { ...a, requests: Number(e.target.value) } : a) })}/></Field><Field label={t('flow_control.window_ms')}><input type="number" min="1" value={w['period-ms']} onChange={e => patchRule(index, { windows: r.windows?.map((a, i) => i === wi ? { ...a, 'period-ms': Number(e.target.value) } : a) })}/></Field><Button type="button" size="sm" variant="ghost" onClick={() => patchRule(index, { windows: r.windows?.filter((_, i) => i !== wi) })}>{t('flow_control.remove_window')}</Button></div>)}
          <Button type="button" size="sm" variant="secondary" disabled={!editable || (r.windows?.length ?? 0) >= 8} onClick={() => patchRule(index, { windows: [...(r.windows ?? []), { requests: 1, 'period-ms': 1000 }] })}>{t('flow_control.add_window')}</Button>
        </details>
        <Button type="button" size="sm" variant="ghost" onClick={() => changeRules(rules.filter((_, i) => i !== index))}>{t('flow_control.remove_rule')}</Button>
      </fieldset>)}
      <Button type="button" variant="secondary" disabled={!editable || !rules || rules.length >= 128} onClick={() => rules && changeRules([...rules, nextRule(rules)])}>{t('flow_control.add_rule')}</Button>
    </>}
  </section>;
}
export function FlowControlFields(props: Props) { const { support, refresh, live, setLive, liveState, history } = useFlowControlStatus(); return <FlowControlFieldsView {...props} support={support} onRefresh={refresh} live={live} setLive={setLive} liveState={liveState} history={history}/>; }
