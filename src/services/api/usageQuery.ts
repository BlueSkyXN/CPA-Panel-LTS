import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type {
  UsageQueryDetails,
  UsageQueryMetrics,
  UsageQueryRequest,
  UsageQuerySession,
  UsageQuerySummary,
} from '@/types/usageQuery';

const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');
const envelope = (v: unknown): v is Record<string, unknown> =>
  isRecord(v) && v.version === 1 && typeof v.bound === 'string' && v.bound.length > 0;
const ratio = (v: unknown) =>
  isRecord(v) && number(v.numerator) && number(v.denominator) && number(v.samples);
export const isUsageQueryMetrics = (v: unknown): v is UsageQueryMetrics => {
  if (!isRecord(v)) return false;
  if (
    ![
      'requests',
      'success',
      'failure',
      'tokens',
      'input',
      'output',
      'reasoning',
      'cache_read',
      'cache_write',
      'prompt',
      'latency_ms',
      'latency_samples',
      'ttfb_samples',
    ].every((k) => number(v[k]))
  )
    return false;
  if (!['output_tps', 'average_tps', 'visible_tps', 'reasoning_ratio'].every((k) => ratio(v[k])))
    return false;
  return (
    v.prices === undefined ||
    (Array.isArray(v.prices) &&
      v.prices.every(
        (p) =>
          isRecord(p) &&
          typeof p.model === 'string' &&
          ['std', 'fast'].includes(String(p.tier)) &&
          ['effective', 'response', 'outbound', 'request', 'assumed'].includes(
            String(p.evidence)
          ) &&
          ['short', 'long'].includes(String(p.band)) &&
          ['requests', 'tokens', 'prompt', 'cache_read', 'cache_write', 'output'].every((k) =>
            number(p[k])
          )
      ))
  );
};
const invalid = (): never => {
  throw new Error('Invalid usage query response');
};
const detail = (v: unknown) => {
  if (
    !isRecord(v) ||
    typeof v.timestamp !== 'string' ||
    typeof v.source !== 'string' ||
    typeof v.auth_index !== 'string' ||
    typeof v.failed !== 'boolean' ||
    !isRecord(v.tokens)
  )
    return false;
  const tokens = v.tokens;
  return (
    ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens', 'total_tokens'].every(
      (k) => number(tokens[k])
    ) &&
    ['cache_read_tokens', 'cache_creation_tokens'].every(
      (k) => tokens[k] === undefined || number(tokens[k])
    )
  );
};
export function decodeUsageQuerySession(v: unknown): UsageQuerySession {
  if (!envelope(v) || !number(v.now_ms) || !number(v.max_page_size) || !strings(v.models))
    return invalid();
  return v as unknown as UsageQuerySession;
}
export function decodeUsageQuerySummary(v: unknown): UsageQuerySummary {
  if (!envelope(v) || !number(v.now_ms) || !isUsageQueryMetrics(v.totals) || !isRecord(v.groups))
    return invalid();
  for (const groups of Object.values(v.groups)) {
    if (
      !Array.isArray(groups) ||
      !groups.every(
        (g) =>
          isRecord(g) &&
          isUsageQueryMetrics(g.metrics) &&
          ['api', 'model', 'source', 'auth_index'].every(
            (k) => g[k] === undefined || typeof g[k] === 'string'
          ) &&
          (g.start_ms === undefined || number(g.start_ms))
      )
    )
      return invalid();
  }
  return v as unknown as UsageQuerySummary;
}
export function decodeUsageQueryDetails(v: unknown): UsageQueryDetails {
  if (
    !envelope(v) ||
    !number(v.total) ||
    !isUsageQueryMetrics(v.metrics) ||
    !Array.isArray(v.items) ||
    v.items.length > 200 ||
    (v.next_cursor !== undefined && typeof v.next_cursor !== 'string')
  )
    return invalid();
  if (
    !v.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.api === 'string' &&
        typeof item.model === 'string' &&
        detail(item.detail)
    )
  )
    return invalid();
  if (v.options !== undefined) {
    const o = v.options;
    if (
      !isRecord(o) ||
      !isUsageQueryMetrics(o.metrics) ||
      !['models', 'apis', 'auth_indices', 'efforts'].every((k) => strings(o[k])) ||
      !Array.isArray(o.identities) ||
      !o.identities.every(
        (id) => isRecord(id) && typeof id.source === 'string' && typeof id.auth_index === 'string'
      )
    )
      return invalid();
  }
  return v as unknown as UsageQueryDetails;
}

export const usageQueryApi = {
  capabilities: async () =>
    decodeUsageQuerySession(await apiClient.get<unknown>('/usage/query/capabilities')),
  summary: async (q: UsageQueryRequest, signal?: AbortSignal) =>
    decodeUsageQuerySummary(
      await apiClient.post<unknown>('/usage/query/summary', q, { signal, timeout: 30_000 })
    ),
  pricing: async (q: UsageQueryRequest, signal?: AbortSignal) =>
    decodeUsageQuerySummary(
      await apiClient.post<unknown>('/usage/query/pricing', q, { signal, timeout: 30_000 })
    ),
  details: async (q: UsageQueryRequest, signal?: AbortSignal) =>
    decodeUsageQueryDetails(
      await apiClient.post<unknown>('/usage/query/details', q, { signal, timeout: 30_000 })
    ),
};
