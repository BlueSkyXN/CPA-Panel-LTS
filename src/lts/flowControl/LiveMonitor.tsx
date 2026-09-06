import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/services/api/client';
import { asRecord, canObserveLive, type FlowActivity, type FlowCapabilities } from './model';
import { referenceLabel } from './insights';
import { type FlowLiveState } from './useStatus';
import styles from './styles.module.scss';
type Point = {
    requests: number;
    attempts: number;
    waiting: number;
};
type Props = {
    data: FlowCapabilities | null;
    live: boolean;
    setLive: (v: boolean) => void;
    liveState: FlowLiveState;
    history: Point[];
    onRefresh: () => void;
};
function Trend({ history, label }: {
    history: Point[];
    label: string;
}) {
    const max = Math.max(1, ...history.flatMap(p => [p.attempts, p.waiting]));
    const points = (field: 'attempts' | 'waiting') => history.map((p, i) => `${i * 300 / Math.max(1, history.length - 1)},${55 - p[field] * 48 / max}`).join(' ');
    return <svg className={styles.trend} viewBox="0 0 300 60" role="img" aria-label={label} preserveAspectRatio="none"><path d="M0 55H300" className={styles.trendBase}/><polyline points={points('attempts')} className={styles.trendActive}/><polyline points={points('waiting')} className={styles.trendWaiting}/></svg>;
}
function mib(n: number | undefined | null) { return n == null ? '?' : `${(n / 1048576).toFixed(1)} MiB`; }
export function LiveMonitor({ data, live, setLive, liveState, history, onRefresh }: Props) {
    const { t } = useTranslation();
    const s = data?.state;
    const [filters, setFilters] = useState({ state: '', stage: '', model: '' });
    const [detail, setDetail] = useState<{
        activity: FlowActivity[];
        total: number;
        offset: number;
        time: string;
        signature: string;
    } | null>(null);
    const [loading, setLoading] = useState(false), [error, setError] = useState(false);
    const signature = JSON.stringify({ filters, process: s?.['process-id'] });
    const latest = useRef(signature);
    latest.current = signature;
    const serial = useRef(0);
    const load = async (offset: number) => { setLoading(true); setError(false); const submitted = signature, run = ++serial.current; try {
        const q = new URLSearchParams({ ...filters, offset: String(offset), limit: '100' });
        const raw = asRecord(await apiClient.get<unknown>(`/flow-control/details?${q}`));
        if (!raw || !Array.isArray(raw.activity) || typeof raw['matching-total'] !== 'number')
            throw new Error('Invalid details');
        if (latest.current === submitted && serial.current === run)
            setDetail({ activity: raw.activity as FlowActivity[], total: raw['matching-total'], offset, time: String(raw['sampled-at'] || ''), signature: submitted });
    }
    catch {
        if (latest.current === submitted && serial.current === run)
            setError(true);
    }
    finally {
        if (serial.current === run)
            setLoading(false);
    } };
    const page = detail?.signature === signature ? detail : null;
    const lookup = (id: string) => s?.policy?.rules?.find(r => r.id === id)?.label || id;
    const canLive = canObserveLive(data);
    return <section className={styles.liveMonitor} aria-label={t('flow_control.runtime')}>
  <div className={styles.heading}><div><h4>{t('flow_control.runtime')}</h4><p className={styles.hint}>{t('flow_control.v3_live_desc')}</p></div><div className={styles.actions}><span className={styles.liveBadge} data-state={liveState}>{t(`flow_control.live_${liveState}`)}</span><Button type="button" variant={live ? 'primary' : 'secondary'} disabled={!live && !canLive} onClick={() => setLive(!live)}>{t(live ? 'flow_control.stop_live' : 'flow_control.start_live')}</Button><Button type="button" variant="secondary" onClick={onRefresh}>{t('flow_control.refresh')}</Button></div></div>
  {!canLive && <p className={styles.hint}>{t('flow_control.v3_realtime_off')}</p>}
  <div className={styles.kpis}>
   <div><span>{t('flow_control.active_requests')}</span><strong>{s?.['active-requests'] ?? '—'}</strong></div>
   <div><span>{t('flow_control.active_attempts')}</span><strong>{s?.['active-attempts'] ?? '—'}</strong></div>
   <div><span>{t('flow_control.waiting')}</span><strong>{s?.waiting ?? '—'}</strong></div>
   <div><span>{t('flow_control.queued_bytes')}</span><strong className={styles.smallMetric}>{mib(s?.['queued-bytes'])}</strong></div>
  </div>
  <p className={styles.hint}>{t('flow_control.counts_hint')}</p>
  {history.length > 1 && <div className={styles.trendPanel}><Trend history={history} label={t('flow_control.trend_label')}/><small>{t('flow_control.trend_label')}</small></div>}
  <p className={styles.sampleLine}>{s?.['sampled-at'] || '—'} · {t('flow_control.v3_revision')} {s?.['policy-revision'] ?? '—'} · {t('flow_control.v3_oldest')} {Math.round((s?.['oldest-wait-ms'] ?? 0) / 1000)} s</p>
  {!!Object.keys(s?.['blocked-by-rule'] ?? {}).length && <p className={styles.hint}>{t('flow_control.v3_recent_blockers')}: {Object.entries(s?.['blocked-by-rule'] ?? {}).map(([key, n]) => <span key={key} className={styles.blocker}>{lookup(key)} · {n}</span>)}</p>}
  {s?.resources && <details><summary>{t('flow_control.v3_resource_snapshot')}</summary><div className={styles.status}><span>{t('flow_control.v3_heap')}: {mib(s.resources['heap-object-bytes'])}</span><span>{t('flow_control.v3_managed')}: {mib(s.resources['go-managed-bytes'])}</span><span>{t('flow_control.v3_goroutines')}: {s.resources.goroutines}</span><span>{t('flow_control.v3_disk_free')}: {mib(s.resources['filesystem-free-bytes'])}</span></div><p className={styles.hint}>{t('flow_control.v3_resource_note')}</p><small>{s.resources['sampled-at']} / {s.resources['filesystem-sampled-at']}</small></details>}
  <details className={styles.details}><summary>{t('flow_control.v3_manual_details')}</summary>
   <p className={styles.hint}>{t('flow_control.v3_detail_hint')}</p><div className={styles.grid}>
    <label className={styles.field}><span>{t('flow_control.v3_state')}</span><select value={filters.state} onChange={e => setFilters(v => ({ ...v, state: e.target.value }))}><option value="">{t('flow_control.all')}</option>{['waiting', 'running', 'draining'].map(v => <option key={v} value={v}>{t(`flow_control.phase_${v}`)}</option>)}</select></label>
    <label className={styles.field}><span>{t('flow_control.stage')}</span><select value={filters.stage} onChange={e => setFilters(v => ({ ...v, stage: e.target.value }))}><option value="">{t('flow_control.all')}</option><option value="request">{t('flow_control.stage_request')}</option><option value="attempt">{t('flow_control.stage_attempt')}</option></select></label>
    <label className={styles.field}><span>{t('flow_control.v3_exact_model')}</span><input value={filters.model} maxLength={256} onChange={e => setFilters(v => ({ ...v, model: e.target.value }))}/></label>
   </div><Button type="button" variant="secondary" disabled={loading || !data || data['schema-version'] < 3} onClick={() => { void load(0); }}>{t('flow_control.v3_load_details')}</Button>
   {error && <p role="alert">{t('flow_control.error')}</p>}
   {page && <><p className={styles.sampleLine}>{page.time} · {page.activity.length ? page.offset + 1 : 0}–{page.offset + page.activity.length} / {page.total}</p><div className={styles.table}><table><thead><tr><th>{t('flow_control.v3_state')}</th><th>{t('flow_control.v3_request_id')}</th><th>{t('flow_control.selected_user')}</th><th>{t('flow_control.model_probe')}</th><th>{t('flow_control.account_filter')}</th><th>{t('flow_control.v3_age')}</th><th>{t('flow_control.v3_blockers')}</th></tr></thead><tbody>{page.activity.map(row => <tr key={row.id}><td><span className={styles.phase} data-phase={row.state}>{t(`flow_control.phase_${row.state}`)}</span><small>{t(`flow_control.stage_${row.stage}`)}</small></td><td><code>{row['request-id'] || row.id}</code></td><td>{referenceLabel(row.key, data?.keys ?? [])}</td><td>{row.provider && `${row.provider} · `}{row.model}</td><td>{row.account ? referenceLabel(row.account, data?.accounts ?? []) : '—'}</td><td>{(row['elapsed-ms'] / 1000).toFixed(1)} s{row.state === 'waiting' && <small>{t('flow_control.v3_remaining_wait')}: {((row['wait-remaining-ms'] ?? 0) / 1000).toFixed(1)} s</small>}</td><td>{row['blocking-rules']?.map(r => <span className={styles.blocker} key={r}>{lookup(r)}</span>)}</td></tr>)}{page.activity.length === 0 && <tr><td colSpan={7} className={styles.empty}>{t('flow_control.v3_no_details')}</td></tr>}</tbody></table></div><div className={styles.actions}><Button type="button" size="sm" variant="secondary" disabled={loading || page.offset === 0} onClick={() => { void load(Math.max(0, page.offset - 100)); }}>{t('flow_control.v3_previous')}</Button><Button type="button" size="sm" variant="secondary" disabled={loading || page.offset + 100 >= page.total || page.offset >= 10000} onClick={() => { void load(page.offset + 100); }}>{t('flow_control.v3_next')}</Button></div></>}
  </details>
 </section>;
}
