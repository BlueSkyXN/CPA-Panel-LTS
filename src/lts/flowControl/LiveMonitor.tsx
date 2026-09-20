import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconDiamond,
  IconNetwork,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import { FLOW_CONTROL_ENDPOINTS } from '@/services/api/flowControl';
import { apiClient } from '@/services/api/client';
import { asRecord, canObserveLive, type FlowActivity, type FlowCapabilities } from './model';
import { referenceLabel } from './insights';
import { type FlowLiveState } from './useStatus';
import styles from './styles.module.scss';

type Point = { requests: number; attempts: number; waiting: number };
type Props = {
  data: FlowCapabilities | null;
  live: boolean;
  setLive: (value: boolean) => void;
  liveState: FlowLiveState;
  history: Point[];
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

function Trend({ history, label }: { history: Point[]; label: string }) {
  const max = Math.max(1, ...history.flatMap((point) => [point.requests, point.attempts, point.waiting]));
  const points = (field: 'requests' | 'attempts' | 'waiting') =>
    history.map((point, index) => {
      const x = (index * 300) / Math.max(1, history.length - 1);
      return `${x},${55 - (point[field] * 48) / max}`;
    }).join(' ');
  const area = history.length > 1
    ? `M0,55 L${points('attempts')} L300,55 Z`
    : '';

  return (
    <svg className={styles.trend} viewBox="0 0 300 60" role="img" aria-label={label} preserveAspectRatio="none">
      <defs>
        <linearGradient id="flow-trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#477fa5" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#477fa5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 55H300" className={styles.trendBase} />
      {area && <path d={area} fill="url(#flow-trend-fill)" />}
      <polyline points={points('requests')} className={styles.trendRequests} />
      <polyline points={points('attempts')} className={styles.trendActive} />
      <polyline points={points('waiting')} className={styles.trendWaiting} />
    </svg>
  );
}

type KpiCard = {
  key: string;
  label: string;
  value: ReactNode;
  icon: ReactNode;
  accent: string;
  soft: string;
  border: string;
  small?: boolean;
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
      const raw = asRecord(await apiClient.get<unknown>(`${FLOW_CONTROL_ENDPOINTS.details}?${query}`));
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
          <h4>{t('flow_control.runtime')}</h4>
          <p className={styles.hint}>{t('flow_control.v3_live_desc')}</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.liveBadge} data-state={liveState}>{t(`flow_control.live_${liveState}`)}</span>
          <Button type="button" variant={live ? 'primary' : 'secondary'} disabled={!live && !canLive}
            onClick={() => setLive(!live)}>
            {t(live ? 'flow_control.stop_live' : 'flow_control.start_live')}
          </Button>
          <Button type="button" variant="secondary" onClick={onRefresh}>{t('flow_control.refresh')}</Button>
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
            accent: '#477fa5',
            soft: 'rgba(71, 127, 165, 0.16)',
            border: 'rgba(71, 127, 165, 0.34)',
          },
          {
            key: 'attempts',
            label: t('flow_control.active_attempts'),
            value: state?.['active-attempts'] ?? '—',
            icon: <IconTrendingUp size={15} />,
            accent: '#8b5cf6',
            soft: 'rgba(139, 92, 246, 0.16)',
            border: 'rgba(139, 92, 246, 0.32)',
          },
          {
            key: 'waiting',
            label: t('flow_control.waiting'),
            value: state?.waiting ?? '—',
            icon: <IconTimer size={15} />,
            accent: '#d97706',
            soft: 'rgba(217, 119, 6, 0.16)',
            border: 'rgba(217, 119, 6, 0.32)',
            meta:
              state?.['waiting-requests'] != null || state?.['waiting-attempts'] != null
                ? t('flow_control.waiting_split', {
                    requests: state?.['waiting-requests'] ?? 0,
                    attempts: state?.['waiting-attempts'] ?? 0,
                  })
                : undefined,
          },
          {
            key: 'queued-bytes',
            label: t('flow_control.queued_bytes'),
            value: mib(state?.['queued-bytes']),
            icon: <IconDiamond size={15} />,
            accent: '#64748b',
            soft: 'rgba(100, 116, 139, 0.16)',
            border: 'rgba(100, 116, 139, 0.34)',
            small: true,
          },
          {
            key: 'admitted',
            label: t('flow_control.admitted_total'),
            value: state?.admitted ?? '—',
            icon: <IconCheckCircle2 size={15} />,
            accent: '#22a45d',
            soft: 'rgba(34, 164, 93, 0.16)',
            border: 'rgba(34, 164, 93, 0.32)',
          },
          {
            key: 'rejected',
            label: t('flow_control.rejected_total'),
            value: state?.rejected ?? '—',
            icon: <IconAlertTriangle size={15} />,
            accent: '#c25a4a',
            soft: 'rgba(194, 90, 74, 0.16)',
            border: 'rgba(194, 90, 74, 0.32)',
            meta:
              `${t('flow_control.timed_out_total')}: ${state?.['timed-out'] ?? 0}` +
              ` · ${t('flow_control.canceled_total')}: ${state?.canceled ?? 0}`,
          },
        ] as KpiCard[]).map((card) => (
          <div
            key={card.key}
            className={styles.kpi}
            style={
              {
                '--accent': card.accent,
                '--accent-soft': card.soft,
                '--accent-border': card.border,
              } as CSSProperties
            }
          >
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>{card.label}</span>
              <span className={styles.kpiIcon}>{card.icon}</span>
            </div>
            <strong className={card.small ? styles.smallMetric : undefined}>{card.value}</strong>
            {card.meta && <small className={styles.kpiMeta}>{card.meta}</small>}
          </div>
        ))}
      </div>
      <p className={styles.hint}>{t('flow_control.counts_hint')}</p>
      {history.length > 1 && (
        <div className={styles.trendPanel}>
          <Trend history={history} label={t('flow_control.trend_label')} />
          <div className={styles.trendSide}>
            <div className={styles.trendLegend}>
              <span><i className={styles.dotRequests} />{t('flow_control.active_requests')}</span>
              <span><i className={styles.dotActive} />{t('flow_control.active_attempts')}</span>
              <span><i className={styles.dotWaiting} />{t('flow_control.waiting')}</span>
            </div>
            <small>{t('flow_control.trend_label')}</small>
          </div>
        </div>
      )}
      <p className={styles.sampleLine}>
        {state?.['sampled-at'] || '—'} · {t('flow_control.v3_revision')} {state?.['policy-revision'] ?? '—'}
        {' · '}{t('flow_control.v3_oldest')} {Math.round((state?.['oldest-wait-ms'] ?? 0) / 1000)} s
      </p>
      {blockers.length > 0 && (
        <p className={styles.hint}>
          {t('flow_control.v3_recent_blockers')}: {blockers.map(([key, count]) => (
            <span key={key} className={styles.blocker}>{lookup(key)} · {count}</span>
          ))}
        </p>
      )}
      {resources && (
        <details>
          <summary>{t('flow_control.v3_resource_snapshot')}</summary>
          <div className={styles.status}>
            <span>{t('flow_control.v3_heap')}: {mib(resources['heap-object-bytes'])}</span>
            <span>{t('flow_control.v3_managed')}: {mib(resources['go-managed-bytes'])}</span>
            <span>{t('flow_control.v3_goroutines')}: {resources.goroutines}</span>
            <span>{t('flow_control.v3_disk_free')}: {mib(resources['filesystem-free-bytes'])}</span>
          </div>
          <p className={styles.hint}>{t('flow_control.v3_resource_note')}</p>
          <small>{resources['sampled-at']} / {resources['filesystem-sampled-at']}</small>
        </details>
      )}
      <details className={styles.details}>
        <summary>{t('flow_control.v3_manual_details')}</summary>
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
      </details>
    </section>
  );
}
