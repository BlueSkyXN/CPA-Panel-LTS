import { REQUEST_SIZE_VERSION_V1 } from './requestSize';

/** Inclusive lower bounds in bytes; mirrors Core `analyticsRequestSizeEdges`. */
export const REQUEST_SIZE_EDGES = [
  0,
  64 * 1024,
  256 * 1024,
  512 * 1024,
  768 * 1024,
  1024 * 1024,
  2 * 1024 * 1024,
] as const;

export interface RequestSizeDistribution {
  edges: number[];
  requests: number[];
  failures: number[];
  websocketRequests: number[];
  websocketFailures: number[];
  sampleCount: number;
  unmeasured: number;
}

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Buckets details by measured upstream request payload, falling back to the wire size for
 * encoded bodies, exactly like Core's exact analytics. Returns null when no detail carries a
 * measurement so callers can omit the field (Core omits it too).
 */
export function buildRequestSizeDistribution(
  details: Iterable<unknown>
): RequestSizeDistribution | null {
  const n = REQUEST_SIZE_EDGES.length;
  const result: RequestSizeDistribution = {
    edges: [...REQUEST_SIZE_EDGES],
    requests: new Array(n).fill(0),
    failures: new Array(n).fill(0),
    websocketRequests: new Array(n).fill(0),
    websocketFailures: new Array(n).fill(0),
    sampleCount: 0,
    unmeasured: 0,
  };
  for (const raw of details) {
    if (raw === null || typeof raw !== 'object') continue;
    const detail = raw as Record<string, unknown>;
    const bytes = positive(detail.upstream_request_bytes) || positive(detail.upstream_request_wire_bytes);
    if (detail.size_version !== REQUEST_SIZE_VERSION_V1 || bytes <= 0) {
      result.unmeasured++;
      continue;
    }
    let i = n - 1;
    while (i > 0 && bytes < REQUEST_SIZE_EDGES[i]) i--;
    result.sampleCount++;
    result.requests[i]++;
    const websocket = detail.upstream_transport === 'websocket';
    if (websocket) result.websocketRequests[i]++;
    if (detail.failed === true) {
      result.failures[i]++;
      if (websocket) result.websocketFailures[i]++;
    }
  }
  return result.sampleCount > 0 ? result : null;
}

const isCountList = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0);

/** Validates a Core `data.requestSize` payload; bucket counts must stay internally consistent. */
export function isRequestSizeDistribution(value: unknown): value is RequestSizeDistribution {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const edges = v.edges;
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > 64) return false;
  if (
    !edges.every(
      (edge, i) =>
        typeof edge === 'number' &&
        Number.isSafeInteger(edge) &&
        edge >= 0 &&
        (i === 0 ? edge === 0 : edge > (edges[i - 1] as number))
    )
  )
    return false;
  const n = edges.length;
  if (
    !isCountList(v.requests, n) ||
    !isCountList(v.failures, n) ||
    !isCountList(v.websocketRequests, n) ||
    !isCountList(v.websocketFailures, n)
  )
    return false;
  const sampleCount = v.sampleCount;
  const unmeasured = v.unmeasured;
  if (
    typeof sampleCount !== 'number' ||
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < 0 ||
    typeof unmeasured !== 'number' ||
    !Number.isSafeInteger(unmeasured) ||
    unmeasured < 0
  )
    return false;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const requests = v.requests[i];
    if (
      v.failures[i] > requests ||
      v.websocketRequests[i] > requests ||
      v.websocketFailures[i] > v.websocketRequests[i] ||
      v.websocketFailures[i] > v.failures[i]
    )
      return false;
    total += requests;
  }
  return total === sampleCount;
}
