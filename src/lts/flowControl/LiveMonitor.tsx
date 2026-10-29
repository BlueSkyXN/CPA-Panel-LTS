import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import { FlowTrend } from './FlowTrend';
import type { FlowPoint } from './history';
import { Button } from '@/components/ui/Button';
import {
  IconNetwork,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import { FLOW_CONTROL_ENDPOINTS } from '@/services/api/flowControl';
import { ltsExtensionClient } from '@/services/api/client';
import { asRecord, canObserveLive, type FlowActivity, type FlowCapabilities } from './model';
import { referenceLabel } from './insights';
import { type FlowLiveState } from './useStatus';
import styles from './styles.module.scss';

type Props = {
  data: FlowCapabilities | null;
  live: boolean;
  setLive: (value: boolean) => void;
  liveState: FlowLiveState;
  history: FlowPoint[];
  onRefresh: () => void;
};
type DetailsPage = {
  activity: FlowActivity[];
  total: number;
  offset: number;
  time: string;
  signature: string;
};

const DETAILS_PAGE_SIZE = 100;

type KpiCard = {
  key: string;
  label: string;
  value: ReactNode;
  icon: ReactNode;
  meta?: ReactNode;
};

function mib(value: number | undefined | null) {
  return value == null ? '?' : `${(value / 1048576).toFixed(1)} MiB`;
}

export function LiveMonitor({ data, live, setLive, liveState, history, onRefresh }: Props) {
  const { t } = useTranslation();
  const state = data?.state;
  const [filters, setFilters] = useState({ state: '', stage: '', model: '' });
  const [detail, setDetail] = useState<DetailsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const signature = JSON.stringify({ filters, process: state?.['process-id'] });
  const latest = useRef(signature);
  latest.current = signature;
  const serial = useRef(0);

  // Detail requests are manual and bounded. Never recompute them on a summary tick.
  const load = async (offset: number) => {
    const submitted = signature;
    const run = ++serial.current;
    setLoading(true);
    setError(false);
    try {
      const query = new URLSearchParams({ ...filters, offset: String(offset), limit: String(DETAILS_PAGE_SIZE) });
      const raw = asRecord(await ltsExtensionClient.get<unknown>(`${FLOW_CONTROL_ENDPOINTS.details}?${query}`));
      if (!raw || !Array.isArray(raw.activity) || typeof raw['matching-total'] !== 'number') {
        throw new Error('Invalid flow-control details');
      }
      if (latest.current === submitted && serial.current === run) {
        setDetail({
          activity: raw.activity as FlowActivity[],
          total: raw['matching-total'],
          offset,
          time: String(raw['sampled-at'] || ''),
          signature: submitted,
        });
      }
    } catch {
      if (latest.current === submitted && serial.current === run) setError(true);
    } finally {
      if (serial.current === run) setLoading(false);
    }
  };

  const page = detail?.signature === signature ? detail : null;
  const lookup = (id: string) => state?.policy?.rules?.find((rule) => rule.id === id)?.label || id;
  const canLive = canObserveLive(data);
  const blockers = Object.entries(state?.['blocked-by-rule'] ?? {});
  const resources = state?.resources;

  return (
    <section className={styles.liveMonitor} aria-label={t('flow_control.runtime')}>
      <div className={styles.heading}>
        <div>
          <h2>{t('flow_control.runtime')}</h2>
          <p className={styles.hint}>{t('flow_control.v3_live_desc')}</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.liveBadge} data-state={liveState}>{t(`flow_control.live_${liveState}`)}</span>
          <Button type="button" variant={live ? 'primary' : 'secondary'} disabled={!live && !canLive}
            onClick={() => setLive(!live)}>
            {t(live ? 'flow_control.stop_live' : 'flow_control.start_live')}
          </Button>
          <Button type="button" variant="secondary" aria-label={t('flow_control.refresh')} onClick={onRefresh}>{t('usage_stats.refresh')}</Button>
        </div>
      </div>
      {!canLive && <p className={styles.hint}>{t('flow_control.v3_realtime_off')}</p>}
      <div className={styles.kpis}>
        {([
          {
            key: 'requests',
            label: t('flow_control.active_requests'),
            value: state?.['active-requests'] ?? '—',
            icon: <IconNetwork size={15} />,
          },
          {
            key: 'attempts',
            label: t('flow_control.active_attempts'),
            value: state?.['active-attempts'] ?? '—',
            icon: <IconTrendingUp size={15} />,
          },
          {
            key: 'waiting',
            label: t('flow_control.waiting'),
            value: state?.waiting ?? '—',
            icon: <IconTimer size={15} />,
            meta:
              state?.['waiting-requests'] != null || state?.['waiting-attempts'] != null
                ? t('flow_control.waiting_split', {
                    requests: state?.['waiting-requests'] ?? 0,
                    attempts: state?.['waiting-attempts'] ?? 0,
                  })
                : undefined,
          },
        ] as KpiCard[]).map((card) => (
          <div
            key={card.key}
            className={styles.kpi}
            data-metric={card.key}
          >
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>{card.label}</span>
              <span className={styles.kpiIcon}>{card.icon}</span>
            </div>
            <strong>{card.value}</strong>
            {card.meta && <small className={styles.kpiMeta}>{card.meta}</small>}
          </div>
        ))}
      </div>
      <dl className={styles.secondaryMetrics}>
        <div><dt>{t('flow_control.queued_bytes')}</dt><dd>{mib(state?.['queued-bytes'])}</dd></div>
        <div><dt>{t('flow_control.admitted_total')}</dt><dd>{state?.admitted ?? '—'}</dd></div>
        <div><dt>{t('flow_control.rejected_total')}</dt><dd>{state?.rejected ?? '—'}</dd>
          <small>{t('flow_control.timed_out_total')}: {state?.['timed-out'] ?? '—'} · {t('flow_control.canceled_total')}: {state?.canceled ?? '—'}</small>
        </div>
      </dl>
      <div className={styles.waitSummary}>
        <span>{t('flow_control.v3_oldest')}</span>
        <strong>{state?.['oldest-wait-ms'] == null ? '—' : `${(state['oldest-wait-ms'] / 1000).toFixed(1)} s`}</strong>
        {blockers.length > 0 && <div>
          <span>{t('flow_control.v3_recent_blockers')}</span>
          {blockers.map(([key, count]) => <span key={key} className={styles.blocker}>{lookup(key)} · {count}</span>)}
        </div>}
      </div>
      <FlowTrend history={history} liveState={liveState} />
      <p className={styles.sampleLine}>
        {t('flow_control.sampled')}: {state?.['sampled-at'] ? new Date(state['sampled-at']).toLocaleString() : '—'}
        {' · '}{t('flow_control.v3_revision')} {state?.['policy-revision'] ?? '—'}
      </p>
      {resources && (
        <Collapsible label={t('flow_control.v3_resource_snapshot')}>
          <div className={styles.status}>
            <span>{t('flow_control.v3_heap')}: {mib(resources['heap-object-bytes'])}</span>
            <span>{t('flow_control.v3_managed')}: {mib(resources['go-managed-bytes'])}</span>
            <span>{t('flow_control.v3_goroutines')}: {resources.goroutines}</span>
            <span>{t('flow_control.v3_disk_free')}: {mib(resources['filesystem-free-bytes'])}</span>
          </div>
          <p className={styles.hint}>{t('flow_control.v3_resource_note')}</p>
          <small>{resources['sampled-at']} / {resources['filesystem-sampled-at']}</small>
        </Collapsible>
      )}
      <Collapsible className={styles.detailsPanel} label={t('flow_control.v3_manual_details')}>
        <p className={styles.hint}>{t('flow_control.v3_detail_hint')}</p>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>{t('flow_control.v3_state')}</span>
            <select value={filters.state} onChange={(event) => setFilters((old) => ({ ...old, state: event.target.value }))}>
              <option value="">{t('flow_control.all')}</option>
              {['waiting', 'running', 'draining'].map((value) => (
                <option key={value} value={value}>{t(`flow_control.phase_${value}`)}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('flow_control.stage')}</span>
            <select value={filters.stage} onChange={(event) => setFilters((old) => ({ ...old, stage: event.target.value }))}>
              <option value="">{t('flow_control.all')}</option>
              <option value="request">{t('flow_control.stage_request')}</option>
              <option value="attempt">{t('flow_control.stage_attempt')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('flow_control.v3_exact_model')}</span>
            <input value={filters.model} maxLength={256}
              onChange={(event) => setFilters((old) => ({ ...old, model: event.target.value }))} />
          </label>
        </div>
        <Button type="button" variant="secondary" disabled={loading || !data || data['schema-version'] < 3}
          onClick={() => { void load(0); }}>
          {t('flow_control.v3_load_details')}
        </Button>
        {error && <p role="alert">{t('flow_control.error')}</p>}
        {page && (
          <>
            <p className={styles.sampleLine}>
              {page.time} · {page.activity.length ? page.offset + 1 : 0}–{page.offset + page.activity.length} / {page.total}
            </p>
            <div className={styles.table}>
              <table>
                <thead><tr>
                  <th>{t('flow_control.v3_state')}</th>
                  <th>{t('flow_control.v3_request_id')}</th>
                  <th>{t('flow_control.selected_user')}</th>
                  <th>{t('flow_control.model_probe')}</th>
                  <th>{t('flow_control.account_filter')}</th>
                  <th>{t('flow_control.v3_age')}</th>
                  <th>{t('flow_control.v3_blockers')}</th>
                </tr></thead>
                <tbody>
                  {page.activity.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className={styles.phase} data-phase={row.state}>{t(`flow_control.phase_${row.state}`)}</span>
                        <small>{t(`flow_control.stage_${row.stage}`)}</small>
                      </td>
                      <td><code>{row['request-id'] || row.id}</code></td>
                      <td>{referenceLabel(row.key, data?.keys ?? [])}</td>
                      <td>{row.provider && `${row.provider} · `}{row.model}</td>
                      <td>{row.account ? referenceLabel(row.account, data?.accounts ?? []) : '—'}</td>
                      <td>
                        {(row['elapsed-ms'] / 1000).toFixed(1)} s
                        {row.state === 'waiting' && (
                          <small>
                            {t('flow_control.v3_remaining_wait')}: {((row['wait-remaining-ms'] ?? 0) / 1000).toFixed(1)} s
                          </small>
                        )}
                      </td>
                      <td>
                        {row['blocking-rules']?.map((id) => <span className={styles.blocker} key={id}>{lookup(id)}</span>)}
                      </td>
                    </tr>
                  ))}
                  {page.activity.length === 0 && (
                    <tr><td colSpan={7} className={styles.empty}>{t('flow_control.v3_no_details')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className={styles.actions}>
              <Button type="button" size="sm" variant="secondary" disabled={loading || page.offset === 0}
                onClick={() => { void load(Math.max(0, page.offset - DETAILS_PAGE_SIZE)); }}>
                {t('flow_control.v3_previous')}
              </Button>
              <Button type="button" size="sm" variant="secondary"
                disabled={loading || page.offset + DETAILS_PAGE_SIZE >= page.total || page.offset >= 10000}
                onClick={() => { void load(page.offset + DETAILS_PAGE_SIZE); }}>
                {t('flow_control.v3_next')}
              </Button>
            </div>
          </>
        )}
      </Collapsible>
    </section>
  );
}
