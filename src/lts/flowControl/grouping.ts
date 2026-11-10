import type { FlowPoint } from './history';
import type { FlowSummaryGroup } from './model';

export type FlowMetric = 'requests' | 'attempts' | 'waiting';
export type FlowGroupBy = 'model' | 'account' | 'key' | 'provider';
export const FLOW_GROUPS: FlowGroupBy[] = ['model', 'account', 'key', 'provider'];
export const MAX_FLOW_LINES = 8;
export const OTHER_FLOW_LINE = 'other';

export function flowGroupValue(row: FlowSummaryGroup, dimension: FlowGroupBy): string {
  return JSON.stringify(dimension === 'model'
    ? [row.stage, row.provider ?? '', row.model ?? '']
    : [dimension === 'key' ? row.key || 'anonymous' : row[dimension] ?? '']);
}

function metricValue(row: FlowSummaryGroup, metric: FlowMetric): number {
  if (metric === 'waiting') return row.waiting;
  return row.stage === (metric === 'requests' ? 'request' : 'attempt') ? row.active : 0;
}

export function aggregateFlowPoint(
  point: FlowPoint, metric: FlowMetric, dimension: FlowGroupBy,
): Map<string, number> | null {
  const breakdown = point.breakdown;
  const omittedKey = metric === 'requests' ? 'active-requests' : metric === 'attempts' ? 'active-attempts' : 'waiting';
  // Missing or truncated data cannot produce an exact line count for this view.
  if (!breakdown || breakdown.view !== dimension || breakdown.omitted[omittedKey] > 0) return null;
  const values = new Map<string, number>();
  for (const row of breakdown.groups) {
    const count = metricValue(row, metric);
    if (!count) continue;
    const id = flowGroupValue(row, dimension);
    values.set(id, (values.get(id) ?? 0) + count);
  }
  return values;
}

export function buildFlowSeries(
  history: FlowPoint[], metric: FlowMetric, dimension: FlowGroupBy,
  selected: string[] | null = null,
) {
  const samples = history.map(point => aggregateFlowPoint(point, metric, dimension));
  const scores = new Map<string, number>();
  for (const sample of samples) {
    for (const [id, count] of sample ?? []) scores.set(id, (scores.get(id) ?? 0) + count);
  }
  const ranked = [...scores.keys()].sort((a, b) => (scores.get(b)! - scores.get(a)!) || a.localeCompare(b));
  const visible = selected === null ? ranked.slice(0, MAX_FLOW_LINES) : [...new Set(selected)].slice(0, MAX_FLOW_LINES);
  const visibleSet = new Set(visible);
  const other = selected === null && ranked.some(id => !visibleSet.has(id));
  const ids = [...visible, ...(other ? [OTHER_FLOW_LINE] : [])];
  return {
    visible, options: ranked, incomplete: samples.filter(sample => sample === null).length,
    series: ids.map(id => ({
      id,
      values: samples.map(sample => {
        if (sample === null) return null;
        if (id !== OTHER_FLOW_LINE) return sample.get(id) ?? 0;
        let total = 0;
        for (const [key, count] of sample) if (!visibleSet.has(key)) total += count;
        return total;
      }),
    })),
  };
}

export function flowValueSegments(history: FlowPoint[], values: Array<number | null>) {
  const segments: Array<Array<{ point: FlowPoint; value: number }>> = [];
  let segment: Array<{ point: FlowPoint; value: number }> | undefined;
  history.forEach((point, index) => {
    const value = values[index];
    if (value == null) { segment = undefined; return; }
    if (!segment || point.breakBefore) { segment = []; segments.push(segment); }
    segment.push({ point, value });
  });
  return segments;
}
