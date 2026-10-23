import type { FlowStatus } from './model';

export type FlowPoint = {
  sampledAt: number;
  requests: number;
  attempts: number;
  waiting: number;
  breakBefore: boolean;
};

/** Keep server sampling times; never manufacture a fixed-duration history. */
export function appendFlowSample(
  previous: FlowPoint[],
  state: FlowStatus,
  { reset = false, discontinuity = false, intervalMs = 2000 } = {}
): FlowPoint[] {
  const points = reset ? [] : previous;
  const sampledAt = Date.parse(state['sampled-at'] ?? '');
  if (!Number.isFinite(sampledAt)) return points;
  const last = points[points.length - 1];
  if (last && sampledAt < last.sampledAt) return points;
  const point: FlowPoint = {
    sampledAt,
    requests: state['active-requests'],
    attempts: state['active-attempts'],
    waiting: state.waiting,
    breakBefore: !!last && (discontinuity || sampledAt - last.sampledAt > Math.max(5000, intervalMs * 3)),
  };
  if (last?.sampledAt === sampledAt) {
    return [...points.slice(0, -1), { ...point, breakBefore: last.breakBefore || point.breakBefore }];
  }
  return [...points, point].slice(-60);
}

export function flowSampleSegments(history: FlowPoint[]): FlowPoint[][] {
  const segments: FlowPoint[][] = [];
  for (const point of history) {
    if (point.breakBefore || !segments.length) segments.push([]);
    segments[segments.length - 1].push(point);
  }
  return segments;
}

export function flowSamplePosition(history: FlowPoint[], point: FlowPoint): number {
  const first = history[0]?.sampledAt ?? point.sampledAt;
  const span = (history[history.length - 1]?.sampledAt ?? first) - first;
  return span > 0 ? (point.sampledAt - first) / span : 0;
}
