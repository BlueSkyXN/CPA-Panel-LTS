import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/services/api/client';
import { identityForModel, policyFromValues, readExplanations, type FlowCapabilities, type FlowControlValues, type FlowExplanation, type FlowIdentity, type FlowRule } from './model';
import { ruleSentence } from './insights';
import { SelectionField } from './SelectionField';
import styles from './styles.module.scss';
type Props = {
    values: FlowControlValues;
    data: FlowCapabilities | null;
};
export function RuleInspector({ values, data }: Props) {
    const { t, i18n } = useTranslation();
    const [identity, setIdentity] = useState<FlowIdentity>({ stage: 'attempt', key: '' });
    const [models, setModels] = useState<string[]>([]), [draft, setDraft] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(false);
    const [result, setResult] = useState<{
        signature: string;
        rows: FlowExplanation[];
    } | null>(null);
    const [selected, setSelected] = useState(0);
    const signature = JSON.stringify({ identity, models, draft, policy: policyFromValues(values), process: data?.state['process-id'] });
    const latest = useRef(signature);
    latest.current = signature;
    const serial = useRef(0);
    const submit = async () => {
        const run = ++serial.current, submitted = signature;
        setBusy(true);
        setError(false);
        try {
            const raw = await apiClient.post<unknown>('/flow-control/preview', { ...(draft ? { config: policyFromValues(values) } : {}), targets: models.map(m => identityForModel(identity, m)) });
            const rows = readExplanations(raw);
            if (!rows)
                throw new Error('Invalid preview');
            if (latest.current === submitted && serial.current === run) {
                setResult({ signature: submitted, rows });
                setSelected(0);
            }
        }
        catch {
            if (latest.current === submitted && serial.current === run)
                setError(true);
        }
        finally {
            if (serial.current === run)
                setBusy(false);
        }
    };
    const rows: FlowExplanation[] = result?.signature === signature ? result.rows : [];
    const ruleMap = new Map<string, FlowRule>();
    for (const row of rows) {
        for (const match of row.matches) ruleMap.set(match.rule.id, match.rule);
    }
    const ruleList = [...ruleMap.values()];
    const current = rows[selected];
    const refs = { keys: data?.keys ?? [], accounts: data?.accounts ?? [] };
    const options = identity.stage === 'attempt' && data?.['model-options'].length ? data['model-options'].map(m => ({ value: m.ref, label: `${m.provider} · ${m.model}` })) : (data?.models ?? []).map(value => ({ value, label: value }));
    return <details className={styles.inspector} open><summary><strong>{t('flow_control.v3_preview_title')}</strong></summary>
  <p className={styles.hint}>{t('flow_control.v3_preview_hint')}</p>
  <div className={styles.grid}>
   <label className={styles.field}><span>{t('flow_control.stage')}</span><select value={identity.stage} onChange={e => { setIdentity({ stage: e.target.value, key: identity.key }); setModels([]); }}><option value="attempt">{t('flow_control.stage_attempt')}</option><option value="request">{t('flow_control.stage_request')}</option></select></label>
   <label className={styles.field}><span>{t('flow_control.selected_user')}</span><select value={identity.key || ''} onChange={e => setIdentity(old => ({ ...old, key: e.target.value }))}><option value="">{t('flow_control.v3_unknown')}</option><option value="anonymous">{t('flow_control.anonymous')}</option>{refs.keys.map(r => <option key={r.ref} value={r.ref}>{r.label}</option>)}</select></label>
   {identity.stage === 'attempt' && <label className={styles.field}><span>{t('flow_control.account_filter')}</span><select value={identity.account || ''} onChange={e => { const a = refs.accounts.find(r => r.ref === e.target.value); setIdentity(old => ({ ...old, account: e.target.value, provider: a?.provider, 'auth-kind': a?.['auth-kind'] })); }}><option value="">{t('flow_control.v3_unknown')}</option>{refs.accounts.map(r => <option key={r.ref} value={r.ref}>{r.provider} · {r.label}</option>)}</select></label>}
   <label className={styles.field}><span>{t('flow_control.v3_policy_source')}</span><select value={draft ? 'draft' : 'running'} onChange={e => setDraft(e.target.value === 'draft')}><option value="draft">{t('flow_control.v3_draft')}</option><option value="running">{t('flow_control.v3_running')}</option></select></label>
  </div>
  <SelectionField label={t('flow_control.v3_preview_models')} value={models} options={options} allowAll={false} allowCustom onChange={v => setModels(v ?? [])}/>
  <Button type="button" variant="secondary" disabled={!data?.supported || data['schema-version'] < 3 || busy || models.length < 1 || models.length > 24 || models.some(m => m.includes('*'))} onClick={() => { void submit(); }}>{t('flow_control.v3_evaluate')}</Button>
  {models.length > 24 && <p role="alert">{t('flow_control.v3_preview_bound')}</p>}
  {error && <p className="error-box" role="alert">{t('flow_control.explain_error')}</p>}
  {result && rows.length === 0 && <p className={styles.hint}>{t('flow_control.v3_stale_preview')}</p>}
  {rows.length > 0 && <><h4>{t('flow_control.v3_overlap')}</h4><p className={styles.hint}>{t('flow_control.v3_matrix_hint')}</p>
   <div className={styles.table}><table><thead><tr><th>{t('flow_control.model_probe')}</th>{ruleList.map(r => <th key={r.id}>{r.label || r.id}</th>)}<th>{t('flow_control.v3_result')}</th></tr></thead><tbody>{rows.map((row, i) => <tr key={i}><th><button type="button" className={styles.textButton} onClick={() => setSelected(i)}>{row.identity.provider ? `${row.identity.provider} · ` : ''}{row.identity.model}</button></th>{ruleList.map(r => { const cell = row.matches.find(m => m.rule.id === r.id); return <td key={r.id} data-blocked={cell?.known && cell['blocked-by'].length ? true : undefined}>{cell ? (cell.known ? `${cell.active} / ${cell.rule['max-concurrent'] || '∞'}` : '?') : '—'}{cell && <small>{!cell.known ? t('flow_control.v3_unknown') : cell['blocked-by'].join(', ')}</small>}</td>; })}<td>{t(!row.complete ? 'flow_control.live_incomplete' : row['can-start'] ? 'flow_control.live_available' : 'flow_control.live_wait')}</td></tr>)}</tbody></table></div>
   <p className={styles.sampleLine}>{rows[0]['sampled-at']} · {t('flow_control.v3_revision')} {rows[0]['policy-revision']} · {t(draft ? 'flow_control.v3_draft' : 'flow_control.v3_running')}</p>
  </>}
  {current && <div className={styles.conjunction}>{current.matches.length === 0 ? <p>{t('flow_control.no_matching_rules')}</p> : current.matches.map(row => <div key={row.rule.id} className={row.known && row['blocked-by'].length ? styles.constraintBlocked : styles.constraint}><div><strong>{row.rule.label || row.rule.id}</strong><p>{ruleSentence(row.rule, refs, i18n.language)}</p>{!row.known && <small>{t('flow_control.v3_unknown')}: {row.unresolved?.join(' / ')}</small>}</div><span className={styles.capacity}>{row.known ? row.active : '?'} / {row.rule['max-concurrent'] || '∞'}<small>{t('flow_control.v3_delta', { count: row.delta ?? 1 })}</small></span></div>)}</div>}
  <p className={styles.hint}>{t('flow_control.v3_preview_advisory')}</p>
 </details>;
}
