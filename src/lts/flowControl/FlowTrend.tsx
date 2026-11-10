import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnalyticsSection } from '@/components/common/AnalyticsSection';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import { flowSamplePosition, type FlowPoint } from './history';
import {
  buildFlowSeries, FLOW_GROUPS, flowGroupOptions, flowValueSegments, MAX_FLOW_LINES, OTHER_FLOW_LINE,
  type FlowFilters, type FlowGroupBy, type FlowMetric,
} from './grouping';
import type { FlowCapabilities } from './model';
import type { FlowLiveState } from './useStatus';
import styles from './styles.module.scss';

type Props = { history: FlowPoint[]; liveState: FlowLiveState; data: FlowCapabilities | null };

export function FlowTrend({ history, liveState, data }: Props) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<FlowMetric | 'overview'>('overview');
  const [dimension, setDimension] = useState<FlowGroupBy>('model');
  const [filters, setFilters] = useState<FlowFilters>({});
  const [selected, setSelected] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const supported = data?.features?.includes('grouped-summary') === true;
  const grouped = supported && metric !== 'overview';
  const activeMetric = metric === 'overview' ? 'attempts' : metric;
  const view = useMemo(() => buildFlowSeries(history, activeMetric, dimension, filters, selected),
    [history, activeMetric, dimension, filters, selected]);
  const options = useMemo(() => Object.fromEntries(FLOW_GROUPS.map(field => [field, flowGroupOptions(history, activeMetric, field)])) as Record<FlowGroupBy, string[]>,
    [history, activeMetric]);
  const formatTime = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour12: false });
  const groupLabel = (id: string, field: FlowGroupBy = dimension) => {
    if (id === OTHER_FLOW_LINE) return t('flow_control.trend_other');
    const values: string[] = JSON.parse(id);
    if (field === 'model') {
      const [stage, provider, model] = values;
      return [provider || (stage === 'request' ? t('flow_control.trend_public_model') : ''), model || t('flow_control.v3_unknown')].filter(Boolean).join(' · ');
    }
    const ref = values[0];
    if (!ref) return t('flow_control.v3_unknown');
    if (field === 'key' && ref === 'anonymous') return t('flow_control.anonymous');
    if (field === 'provider') return ref;
    const refs = field === 'account' ? data?.accounts : data?.keys;
    return refs?.find(item => item.ref === ref)?.label ?? ref.slice(0, 12);
  };
  const metricLabel = (value: FlowMetric | 'overview') => t(`flow_control.${{
    overview: 'trend_overview', requests: 'active_requests', attempts: 'active_attempts', waiting: 'waiting',
  }[value]}`);
  const changeMetric = (next: FlowMetric | 'overview') => {
    setMetric(next); setFilters({}); setSelected(null); setSearch('');
    if (next === 'requests' && (dimension === 'account' || dimension === 'provider')) setDimension('model');
  };
  const changeDimension = (next: FlowGroupBy) => { setDimension(next); setSelected(null); setSearch(''); };
  const colorOrder = view.visible.slice().sort();
  const series = grouped ? view.series.map(line => ({
    ...line, label: groupLabel(line.id), line: styles.trendGrouped,
    color: line.id === OTHER_FLOW_LINE ? 'var(--text-secondary)' : `var(--flow-series-${colorOrder.indexOf(line.id) + 1})`,
    dash: line.id === OTHER_FLOW_LINE ? '3 3' : ['none', '7 3', '2 3', '10 3 2 3'][colorOrder.indexOf(line.id) % 4],
  })) : [
    { id: 'requests', label: metricLabel('requests'), line: styles.trendRequests, color: 'var(--flow-requests)', dash: 'none', values: history.map(point => point.requests) },
    { id: 'attempts', label: metricLabel('attempts'), line: styles.trendActive, color: 'var(--flow-attempts)', dash: '8 3', values: history.map(point => point.attempts) },
    { id: 'waiting', label: metricLabel('waiting'), line: styles.trendWaiting, color: 'var(--flow-waiting)', dash: '3 3', values: history.map(point => point.waiting) },
  ];
  const max = Math.max(1, ...series.flatMap(line => line.values.filter((value): value is number => value !== null)));
  const selectable = [...new Set([...view.options, ...(selected ?? [])])];
  const matching = selectable.filter(id => groupLabel(id).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const picked = selected ?? view.visible;
  const hasFilters = Object.values(filters).some(Boolean);
  const filterSummary = FLOW_GROUPS.filter(field => filters[field]).map(field =>
    `${t(`flow_control.trend_by_${field}`)}: ${groupLabel(filters[field]!, field)}`
  ).join(' · ');
  const hasValues = series.some(line => line.values.some(value => value !== null));
  const first = history[0];
  const last = history[history.length - 1];
  return (
    <div className={styles.trendPanel} data-testid="flow-trend" data-grouped={grouped}>
      <AnalyticsSection title={t('flow_control.trend_title')} description={t('flow_control.trend_scope')} level={3}>
        {supported ? <>
          <div className={styles.trendControls}>
            <label className={styles.field}>
              <span>{t('flow_control.trend_metric')}</span>
              <select value={metric} onChange={event => changeMetric(event.target.value as FlowMetric | 'overview')}>
                {(['overview', 'requests', 'attempts', 'waiting'] as const).map(value => <option key={value} value={value}>{metricLabel(value)}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('flow_control.trend_group_by')}</span>
              <select value={dimension} disabled={!grouped} onChange={event => changeDimension(event.target.value as FlowGroupBy)}>
                {FLOW_GROUPS.map(value => <option key={value} value={value} disabled={metric === 'requests' && (value === 'account' || value === 'provider')}>{t(`flow_control.trend_by_${value}`)}</option>)}
              </select>
            </label>
          </div>
          {grouped && <>
            <p className={styles.hint}>{t(`flow_control.trend_${metric}_scope`)}</p>
            <Collapsible label={[t('flow_control.trend_filters'), filterSummary].filter(Boolean).join(' · ')}>
              <div className={styles.trendFilters}>
                {FLOW_GROUPS.filter(field => metric !== 'requests' || (field !== 'account' && field !== 'provider')).map(field => (
                  <label className={styles.field} key={field}>
                    <span>{t(`flow_control.trend_by_${field}`)}</span>
                    <select value={filters[field] ?? ''} onChange={event => { setFilters(old => ({ ...old, [field]: event.target.value || undefined })); setSelected(null); }}>
                      <option value="">{t('flow_control.all')}</option>
                      {[...new Set([...options[field], ...(filters[field] ? [filters[field]] : [])])].map(id => <option key={id} value={id}>{groupLabel(id, field)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <Button variant="secondary" disabled={!hasFilters} onClick={() => { setFilters({}); setSelected(null); }}>{t('flow_control.trend_clear_filters')}</Button>
            </Collapsible>
            <Collapsible label={t('flow_control.trend_choose_lines', { count: picked.length })}>
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => setSelected(null)}>{t('flow_control.trend_auto_lines')}</Button>
                <Button variant="secondary" onClick={() => setSelected([])}>{t('flow_control.trend_clear_lines')}</Button>
              </div>
              <label className={styles.field}>
                <span>{t('flow_control.trend_search_lines')}</span>
                <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
              </label>
              <div className={styles.checkList}>
                {matching.slice(0, 128).map(id => <label key={id}>
                  <input type="checkbox" checked={picked.includes(id)} disabled={!picked.includes(id) && picked.length >= MAX_FLOW_LINES}
                    onChange={event => setSelected(event.target.checked ? [...picked, id] : picked.filter(value => value !== id))} />
                  {groupLabel(id)}
                </label>)}
              </div>
              <p className={styles.hint}>{t('flow_control.trend_line_limit', { count: MAX_FLOW_LINES })}</p>
            </Collapsible>
          </>}
        </> : <p className={styles.hint}>{t('flow_control.trend_upgrade')}</p>}
        {grouped && view.incomplete > 0 && <p className={styles.warning} role="status">{t('flow_control.trend_incomplete')}</p>}
        <div className={styles.trendLegend}>
          {series.map(({ id, label, color }) => <span key={id}><i style={{ background: color }} />{label}</span>)}
          <span>{t(`flow_control.live_${liveState}`)}</span>
        </div>
        {history.length > 1 && hasValues ? <>
          <div className={styles.trendPlot}>
            <div className={styles.trendScale} aria-hidden="true"><span>{max}</span><span>{max / 2}</span><span>0</span></div>
            <svg className={styles.trend} viewBox="0 0 600 140" role="img" aria-label={t('flow_control.trend_title')} preserveAspectRatio="none">
              <title>{t('flow_control.trend_scope')}</title>
              {[8, 70, 132].map((y) => <path key={y} d={`M0 ${y}H600`} className={styles.trendBase} />)}
              {series.flatMap(({ id, line, label, color, dash, values }) => flowValueSegments(history, values).map((segment, index) => (
                <g key={`${id}-${index}`} style={{ stroke: color, strokeDasharray: dash }} data-series-label={label}>
                  <polyline points={segment.map(({ point, value }) => `${flowSamplePosition(history, point) * 600},${132 - value * 124 / max}`).join(' ')} className={line} />
                  {segment.filter((_, index) => segment.length <= 12 || index === segment.length - 1).map(({ point, value }) => <circle key={point.sampledAt} cx={flowSamplePosition(history, point) * 600} cy={132 - value * 124 / max} r="2.5" className={`${line} ${styles.trendPoint}`}>
                    <title>{formatTime(point.sampledAt)} · {label}: {value}</title>
                  </circle>)}
                </g>
              )))}
            </svg>
          </div>
          <div className={styles.trendTimes}><time dateTime={new Date(first.sampledAt).toISOString()}>{formatTime(first.sampledAt)}</time><time dateTime={new Date(last!.sampledAt).toISOString()}>{formatTime(last!.sampledAt)}</time></div>
        </> : <p className={styles.trendEmpty} role="status">{t(grouped && history.length > 1 ? 'flow_control.trend_no_matches' : history.length ? 'flow_control.trend_collecting' : 'flow_control.trend_empty')}</p>}
        {history.length > 0 && <Collapsible label={t('flow_control.trend_readings')}>
          <div className={styles.table}><table>
            <thead><tr><th>{t('flow_control.sampled')}</th>{series.map(({ id, label }) => <th key={id}>{label}</th>)}</tr></thead>
            <tbody>{history.map((point, index) => <tr key={point.sampledAt}><th scope="row">{formatTime(point.sampledAt)}</th>{series.map(({ id, values }) => <td key={id}>{values[index] ?? '—'}</td>)}</tr>)}</tbody>
          </table></div>
        </Collapsible>}
      </AnalyticsSection>
    </div>
  );
}
