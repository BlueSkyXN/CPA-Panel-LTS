import { useTranslation } from 'react-i18next';
import { AnalyticsSection } from '@/components/common/AnalyticsSection';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import { flowSamplePosition, flowSampleSegments, type FlowPoint } from './history';
import type { FlowLiveState } from './useStatus';
import styles from './styles.module.scss';

export function FlowTrend({ history, liveState }: { history: FlowPoint[]; liveState: FlowLiveState }) {
  const { t, i18n } = useTranslation();
  const formatTime = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour12: false });
  const max = Math.max(1, ...history.flatMap((point) => [point.requests, point.attempts, point.waiting]));
  const series = [
    { key: 'requests', label: t('flow_control.active_requests'), line: styles.trendRequests, dot: styles.dotRequests },
    { key: 'attempts', label: t('flow_control.active_attempts'), line: styles.trendActive, dot: styles.dotActive },
    { key: 'waiting', label: t('flow_control.waiting'), line: styles.trendWaiting, dot: styles.dotWaiting },
  ] as const;
  const first = history[0];
  const last = history[history.length - 1];
  return (
    <div className={styles.trendPanel}>
      <AnalyticsSection title={t('flow_control.trend_title')} description={t('flow_control.trend_scope')} level={3}>
        <div className={styles.trendLegend}>
          {series.map(({ key, label, dot }) => <span key={key}><i className={dot} />{label}</span>)}
          <span>{t(`flow_control.live_${liveState}`)}</span>
        </div>
        {history.length > 1 ? <>
          <div className={styles.trendPlot}>
            <div className={styles.trendScale} aria-hidden="true"><span>{max}</span><span>{max / 2}</span><span>0</span></div>
            <svg className={styles.trend} viewBox="0 0 600 140" role="img" aria-label={t('flow_control.trend_title')} preserveAspectRatio="none">
              <title>{t('flow_control.trend_scope')}</title>
              {[8, 70, 132].map((y) => <path key={y} d={`M0 ${y}H600`} className={styles.trendBase} />)}
              {series.flatMap(({ key, line, label }) => flowSampleSegments(history).map((segment, index) => (
                <g key={`${key}-${index}`}>
                  <polyline points={segment.map((point) => `${flowSamplePosition(history, point) * 600},${132 - point[key] * 124 / max}`).join(' ')} className={line} />
                  {segment.map((point) => <circle key={point.sampledAt} cx={flowSamplePosition(history, point) * 600} cy={132 - point[key] * 124 / max} r="4" className={`${line} ${styles.trendPoint}`}>
                    <title>{formatTime(point.sampledAt)} · {label}: {point[key]}</title>
                  </circle>)}
                </g>
              )))}
            </svg>
          </div>
          <div className={styles.trendTimes}><time dateTime={new Date(first.sampledAt).toISOString()}>{formatTime(first.sampledAt)}</time><time dateTime={new Date(last!.sampledAt).toISOString()}>{formatTime(last!.sampledAt)}</time></div>
        </> : <p className={styles.trendEmpty} role="status">{t(history.length ? 'flow_control.trend_collecting' : 'flow_control.trend_empty')}</p>}
        {history.length > 0 && <Collapsible label={t('flow_control.trend_readings')}>
          <div className={styles.table}><table>
            <thead><tr><th>{t('flow_control.sampled')}</th>{series.map(({key,label}) => <th key={key}>{label}</th>)}</tr></thead>
            <tbody>{history.map((point) => <tr key={point.sampledAt}><th scope="row">{formatTime(point.sampledAt)}</th>{series.map(({key}) => <td key={key}>{point[key]}</td>)}</tr>)}</tbody>
          </table></div>
        </Collapsible>}
      </AnalyticsSection>
    </div>
  );
}
