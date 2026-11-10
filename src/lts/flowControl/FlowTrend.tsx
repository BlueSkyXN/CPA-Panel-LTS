import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnalyticsSection } from '@/components/common/AnalyticsSection';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import { flowSamplePosition, type FlowPoint } from './history';
import {
  buildFlowSeries, FLOW_GROUPS, flowValueSegments, MAX_FLOW_LINES, OTHER_FLOW_LINE,
  type FlowGroupBy, type FlowMetric,
} from './grouping';
import type { FlowCapabilities, FlowView } from './model';
import type { FlowLiveState } from './useStatus';
import styles from './styles.module.scss';

type Props = { history: FlowPoint[]; liveState: FlowLiveState; data: FlowCapabilities | null; view: FlowView; setView: (view: FlowView) => void };

export function FlowTrend({ history, liveState, data, view: observationView, setView }: Props) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<FlowMetric | 'overview'>('overview');
  const [selected, setSelected] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [linesOpen, setLinesOpen] = useState(false);
  const supported = data?.features?.includes('on-demand-grouped-summary') === true;
  const dimension: FlowGroupBy = observationView === 'total' ? 'model' : observationView;
  const grouped = supported && observationView !== 'total';
  const activeMetric = metric === 'overview' ? 'attempts' : metric;
  const view = useMemo(() => grouped ? buildFlowSeries(history, activeMetric, dimension, selected) : null,
    [history, grouped, activeMetric, dimension, selected]);
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
    setMetric(next); setSelected(null); setSearch('');
  };
  const changeView = (next: FlowView) => {
    if (next !== 'total' && metric === 'overview') setMetric('attempts');
    if ((next === 'account' || next === 'provider') && metric === 'requests') setMetric('attempts');
    setSelected(null); setSearch(''); setLinesOpen(false); setView(next);
  };
  const colorOrder = view?.visible.slice().sort() ?? [];
  const series = grouped && view ? view.series.map(line => ({
    ...line, label: groupLabel(line.id), line: styles.trendGrouped,
    color: line.id === OTHER_FLOW_LINE ? 'var(--text-secondary)' : `var(--flow-series-${colorOrder.indexOf(line.id) + 1})`,
    dash: line.id === OTHER_FLOW_LINE ? '3 3' : ['none', '7 3', '2 3', '10 3 2 3'][colorOrder.indexOf(line.id) % 4],
  })) : [
    { id: 'requests', label: metricLabel('requests'), line: styles.trendRequests, color: 'var(--flow-requests)', dash: 'none', values: history.map(point => point.requests) },
    { id: 'attempts', label: metricLabel('attempts'), line: styles.trendActive, color: 'var(--flow-attempts)', dash: '8 3', values: history.map(point => point.attempts) },
    { id: 'waiting', label: metricLabel('waiting'), line: styles.trendWaiting, color: 'var(--flow-waiting)', dash: '3 3', values: history.map(point => point.waiting) },
  ].filter(line => metric === 'overview' || line.id === metric);
  const max = Math.max(1, ...series.flatMap(line => line.values.filter((value): value is number => value !== null)));
  // Build searchable labels/options only while the selection panel is open.
  const matching = linesOpen && view ? [...new Set([...view.options, ...(selected ?? [])])]
    .filter(id => groupLabel(id).toLocaleLowerCase().includes(search.toLocaleLowerCase())) : [];
  const picked = selected ?? view?.visible ?? [];
  const hasValues = series.some(line => line.values.some(value => value !== null));
  const first = history[0];
  const last = history[history.length - 1];
  return (
    <div className={styles.trendPanel} data-testid="flow-trend" data-grouped={grouped} data-view={observationView} data-samples={history.length}>
      <AnalyticsSection title={t('flow_control.trend_title')} description={t('flow_control.trend_scope')} level={3}>
        <div className={styles.trendControls}>
          <label className={styles.field}>
            <span>{t('flow_control.trend_view')}</span>
            <select value={supported ? observationView : 'total'} onChange={event => changeView(event.target.value as FlowView)}>
              <option value="total">{t('flow_control.trend_total')}</option>
              {FLOW_GROUPS.map(value => <option key={value} value={value} disabled={!supported}>{t(`flow_control.trend_by_${value}`)}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>{t('flow_control.trend_metric')}</span>
            <select value={metric} onChange={event => changeMetric(event.target.value as FlowMetric | 'overview')}>
              {(['overview', 'requests', 'attempts', 'waiting'] as const).map(value => <option key={value} value={value}
                disabled={(grouped && value === 'overview') || ((dimension === 'account' || dimension === 'provider') && grouped && value === 'requests')}>{metricLabel(value)}</option>)}
            </select>
          </label>
        </div>
        {supported && <p className={styles.hint}>{t('flow_control.trend_view_reset')}</p>}
        {!supported && <p className={styles.hint}>{t('flow_control.trend_upgrade')}</p>}
        {grouped && <>
          <p className={styles.hint}>{t(`flow_control.trend_${activeMetric}_scope`)}</p>
          <Collapsible label={t('flow_control.trend_choose_lines', { count: picked.length })} open={linesOpen}
            onToggle={event => setLinesOpen(event.currentTarget.open)}>
            {linesOpen && <>
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
            </>}
          </Collapsible>
        </>}
        {grouped && view && view.incomplete > 0 && <p className={styles.warning} role="status">{t('flow_control.trend_incomplete')}</p>}
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
