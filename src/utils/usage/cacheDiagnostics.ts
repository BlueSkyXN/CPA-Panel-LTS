import type { TFunction } from 'i18next';
import { isCacheDigest, readCacheRoute, readCacheRouteReference } from './cacheRoute';
import type {
  CacheObservation,
  CacheAttempt,
  CacheFieldDiff,
  CachePayload,
  CacheTrace,
  CacheTraceLocation,
  CacheTraceRow,
  CacheTracePage,
  CacheRouteReference,
  CacheSessionSnapshot,
} from '@/types/cacheDiagnostics';

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 256) : '');
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const list = (v: unknown, limit: number): unknown[] => (Array.isArray(v) ? v.slice(0, limit) : []);

export function readCacheObservation(value: unknown): CacheObservation | undefined {
  const root = object(value);
  if (root?.version !== 1) return undefined;
  const field = (v: unknown) => {
    const f = object(v);
    const state = f?.state;
    if (state !== 'present' && state !== 'absent' && state !== 'invalid') return undefined;
    const n = count(f?.value);
    if (state === 'present' && n === undefined) return undefined;
    if (state !== 'present' && f?.value !== undefined) return undefined;
    if (
      f?.source !== undefined &&
      f.source !== null &&
      (typeof f.source !== 'string' || new TextEncoder().encode(f.source).length > 96)
    )
      return undefined;
    return {
      state,
      ...(state === 'present' ? { value: n } : {}),
      source: text(f?.source),
    } as const;
  };
  const read = field(root.read);
  const write = field(root.write);
  return read && write ? { version: 1, read, write } : undefined;
}

function payload(value: unknown): CachePayload {
  const p = object(value);
  const fields = object(p?.fields) ?? {};
  const valid =
    Object.keys(fields).length <= 32 &&
    Object.values(fields).every((field) => {
      const f = object(field);
      return typeof f?.digest === 'string' && /^[a-f0-9]{64}$/i.test(f.digest);
    });
  return {
    known: p?.known === true && valid,
    reason: text(p?.reason),
    bytes: count(p?.bytes) ?? 0,
    fields: Object.fromEntries(
      Object.entries(fields)
        .slice(0, 32)
        .flatMap(([k, v]) => {
          const f = object(v);
          return f && typeof f.digest === 'string'
            ? [[k.slice(0, 128), { digest: text(f.digest), value: text(f.value) }]]
            : [];
        })
    ),
  };
}

export function decodeCacheTrace(value: unknown): CacheTrace | null {
  const r = object(value);
  if (
    r?.version !== 1 ||
    typeof r.id !== 'string' ||
    !Array.isArray(r.events) ||
    !Array.isArray(r.attempts)
  )
    return null;
  return {
    version: 1,
    id: text(r.id),
    instance_id: text(r.instance_id),
    logical_request_id: text(r.logical_request_id),
    session_hash: text(r.session_hash),
    trace_id: text(r.trace_id),
    input_session: readCacheRouteReference(r.input_session),
    model: text(r.model),
    source_format: text(r.source_format),
    created_at: text(r.created_at),
    updated_at: text(r.updated_at),
    input: payload(r.input),
    truncated: r.truncated === true || r.events.length > 128 || r.attempts.length > 32,
    events: list(r.events, 128).flatMap((v) => {
      const e = object(v);
      if (!e) return [];
      return [
        {
          sequence: count(e.sequence) ?? 0,
          decision_id: text(e.decision_id),
          execution_id: text(e.execution_id),
          selection_id: text(e.selection_id),
          layer: text(e.layer),
          method: text(e.method),
          result: text(e.result),
          reason: text(e.reason),
          auth_index: text(e.auth_index),
          object_hash: text(e.object_hash),
          identity_hash: text(e.identity_hash),
          prefix_length: count(e.prefix_length),
          prefix_unit: text(e.prefix_unit),
          examined: count(e.examined),
          changes: list(e.changes, 32).map(text),
        },
      ];
    }),
    attempts: list(r.attempts, 32).flatMap((v) => {
      const a = object(v);
      if (!a) return [];
      const d = object(a.diagnostic);
      const control = object(a.cache_control);
      const buckets = object(a.cache_write_by_ttl);
      return [
        {
          number: count(a.number) ?? 0,
          decision_id: text(a.decision_id),
          execution_id: text(a.execution_id),
          provider: text(a.provider),
          model: text(a.model),
          auth_index: text(a.auth_index),
          auth_type: text(a.auth_type),
          transport: text(a.transport),
          endpoint: text(a.endpoint),
          status: count(a.status),
          outcome: text(a.outcome),
          input: a.input === undefined ? undefined : payload(a.input),
          input_tokens: count(a.input_tokens),
          cache_references: list(a.cache_references, 12).map(readCacheRouteReference)
            .filter((ref): ref is CacheRouteReference => ref !== undefined),
          cache_write_by_ttl: buckets ? Object.fromEntries(
            ['5m', '30m', '1h', '12h'].flatMap((ttl) => {
              const number = count(buckets[ttl]);
              return number === undefined ? [] : [[ttl, number]];
            })
          ) : undefined,
          cache_control: control && count(control.breakpoints) !== undefined ? {
            breakpoints: count(control.breakpoints) ?? 0,
            five_minutes: count(control.five_minutes), one_hour: count(control.one_hour),
          } : undefined,
          request: payload(a.request),
          response_id: text(a.response_id),
          response_model: text(a.response_model),
          response_status: text(a.response_status),
          observation_state: text(a.observation_state),
          comparison_id_sent: text(a.comparison_id_sent),
          diagnostic_returned: a.diagnostic_returned === true,
          diagnostic: d
            ? {
                type: text(d.type),
                reason: text(d.reason),
                cache_missed_tokens: count(d.cache_missed_tokens),
                comparison_reusable_tokens: count(d.comparison_reusable_tokens),
              }
            : undefined,
          cache_observation: readCacheObservation(a.cache_observation),
          response_truncated: a.response_truncated === true,
        },
      ];
    }),
  };
}

export function decodeCacheSession(value: unknown): CacheSessionSnapshot | null {
  const r = object(value);
  if (!r || typeof r.status !== 'string' || !Array.isArray(r.bindings)) return null;
  const oauth = object(r.oauth);
  return {
    instance_id: text(r.instance_id),
    oauth: oauth
      ? {
          status: text(oauth.status),
          at: text(oauth.at),
          truncated: oauth.truncated === true,
          rows: list(oauth.rows, 64).flatMap((value) => {
            const row = object(value);
            return row
              ? [
                  {
                    kind: text(row.kind),
                    object_hash: text(row.object_hash),
                    group_hash: text(row.group_hash),
                    prefix_length: count(row.prefix_length),
                    prefix_unit: text(row.prefix_unit),
                    last_activity: text(row.last_activity),
                    expires_at: text(row.expires_at),
                    expired: row.expired === true,
                  },
                ]
              : [];
          }),
        }
      : undefined,
    status: text(r.status),
    at: text(r.at),
    session_hash: text(r.session_hash),
    truncated: r.truncated === true,
    bindings: list(r.bindings, 64).flatMap((v) => {
      const b = object(v);
      return b
        ? [
            {
              kind: text(b.kind),
              auth_index: text(b.auth_index),
              prefix_length: count(b.prefix_length),
              prefix_unit: text(b.prefix_unit),
              expires_at: text(b.expires_at),
              expired: b.expired === true,
            },
          ]
        : [];
    }),
  };
}

const TURN_EXPECTED_FIELDS = new Set([
  'input',
  'messages',
  'contents',
  'previous_response_id',
  'prompt_cache_options.comparison_response_id',
  'diagnostics.previous_message_id',
  'thread.previous_message_id',
]);

export function compareCachePayloads(a: CachePayload, b: CachePayload): string[] | null {
  if (!a.known || !b.known) return null;
  return [...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])]
    .filter((key) => a.fields[key]?.digest !== b.fields[key]?.digest)
    .sort();
}

export function diffCachePayloads(before: CachePayload, after: CachePayload): CacheFieldDiff[] | null {
  if (!before.known || !after.known) return null;
  const diffs: CacheFieldDiff[] = [];
  for (const field of [...new Set([...Object.keys(before.fields), ...Object.keys(after.fields)])].sort()) {
    const prev = before.fields[field];
    const next = after.fields[field];
    if (prev?.digest === next?.digest) continue;
    diffs.push({
      field,
      kind: !prev ? 'added' : !next ? 'removed' : 'changed',
      beforeValue: prev?.value || undefined,
      afterValue: next?.value || undefined,
      turnExpected: TURN_EXPECTED_FIELDS.has(field),
    });
  }
  return diffs.sort((a, b) => Number(a.turnExpected) - Number(b.turnExpected) || a.field.localeCompare(b.field));
}

export function shortCredentialLabel(value: string): string {
  if (value.length <= 12) return value;
  if (/^[a-f0-9]+$/i.test(value)) return `${value.slice(0, 6)}…`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

// Legacy snapshots and paged query views both pass through the usage collectors.
export function extractCacheDiagnosticFields(detail: Record<string, unknown>) {
  const identifier = (value: unknown) =>
    typeof value === 'string' && value.length <= 192 ? value : undefined;
  return {
    request_id: identifier(detail.request_id),
    diagnostics_id: identifier(detail.diagnostics_id),
    diagnostics_instance_id: identifier(detail.diagnostics_instance_id),
    cache_observation: readCacheObservation(detail.cache_observation),
  };
}

export const isCacheLookupId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9_.:/-]{1,192}$/i.test(value);

export function decodeTraceLocation(value: unknown): CacheTraceLocation {
  const v = object(value);
  return {
    instance_id: isCacheLookupId(v?.instance_id) ? v.instance_id : undefined,
    diagnostics_id: isCacheDigest(v?.diagnostics_id) ? v.diagnostics_id : undefined,
    trace_id: isCacheLookupId(v?.trace_id) ? v.trace_id : undefined,
    request_id: isCacheLookupId(v?.request_id) ? v.request_id : undefined,
    attempt: count(v?.attempt),
  };
}

export function decodeTraceRow(value: unknown): CacheTraceRow | null {
  const v = object(value);
  if (!v || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) ||
      typeof v.model !== 'string' || typeof v.available !== 'boolean') return null;
  const location = decodeTraceLocation(v);
  if (v.available && (!location.instance_id || !location.diagnostics_id)) return null;
  const previous = decodeTraceLocation(v.previous);
  const previousSource = v.previous_source;
  return {
    ...location, at: v.at, model: text(v.model), auth_index: text(v.auth_index),
    trace_id: text(v.trace_id), logical_request_id: text(v.logical_request_id), response_id: text(v.response_id),
    available: v.available, matched: list(v.matched, 5).filter(isCacheLookupId),
    input_tokens: count(v.input_tokens), cache_observation: readCacheObservation(v.cache_observation),
    cache_route: readCacheRoute(v.cache_route),
    attempt_count: count(v.attempt_count), status: count(v.status), outcome: text(v.outcome),
    previous_source: previousSource === 'previous_response_id' || previousSource === 'thread.previous_message_id' ||
      previousSource === 'diagnostics.previous_message_id' ? previousSource : undefined,
    previous: previous.instance_id === location.instance_id && previous.diagnostics_id
      ? previous : undefined,
  };
}

export function decodeTracePage(value: unknown): CacheTracePage {
  const v = object(value);
  if (v?.version !== 1 || !isCacheLookupId(v.current_instance_id) || !Array.isArray(v.items) ||
      v.items.length > 100 || typeof v.history_included !== 'boolean' ||
      (v.next_cursor !== undefined &&
        (typeof v.next_cursor !== 'string' || !/^[a-z0-9_-]{1,2048}$/i.test(v.next_cursor)))) {
    throw new Error('Invalid cache trace page');
  }
  const items = v.items.map(decodeTraceRow);
  if (items.some((item) => item === null || item.available && item.instance_id !== v.current_instance_id)) {
    throw new Error('Invalid cache trace row');
  }
  return {
    version: 1, current_instance_id: v.current_instance_id,
    next_cursor: typeof v.next_cursor === 'string' ? v.next_cursor : undefined,
    items: items.filter((item): item is CacheTraceRow => item?.available === true),
  };
}

type CacheField = CacheObservation['read'];

export function cacheFieldText(t: TFunction, item?: CacheField, observed = false) {
  if (item?.state === 'present') return item.value?.toLocaleString() ?? '—';
  return t(item ? `cache_diagnostics.${item.state}` : observed ? 'cache_diagnostics.not_observed' : 'cache_diagnostics.legacy_unknown');
}

export function cacheFieldSummary(t: TFunction, item?: CacheField) {
  if (item?.state === 'present') return item.value?.toLocaleString() ?? '—';
  if (item?.state === 'absent') return t('cache_analysis.summary_absent');
  if (item?.state === 'invalid') return t('cache_analysis.summary_invalid');
  return t('cache_analysis.summary_unknown');
}

export function cacheAttemptFailed(attempt: { status?: number; outcome?: string; response_status?: string }) {
  return (attempt.status ?? 0) >= 400 || attempt.response_status === 'failed' ||
    ['transport_error', 'send_error', 'read_error', 'decode_error', 'upstream_error'].includes(attempt.outcome ?? '');
}

export function cacheExecutionPath(attempts: readonly CacheAttempt[]) {
  if (attempts.length < 2) return null;
  const failure = attempts.slice(0, -1).find(cacheAttemptFailed);
  const from = failure ?? attempts[0];
  const final = attempts[attempts.length - 1];
  return {
    from,
    final,
    failedBeforeFinal: Boolean(failure),
    changedCredential: Boolean(from.auth_index && final.auth_index && from.auth_index !== final.auth_index),
  };
}

export function cacheAttemptTransport(transport: string) {
  return transport === 'websocket' ? 'WebSocket' : transport === 'http' ? 'HTTP' : transport || '—';
}

export function readRate(input?: number, read?: CacheField): number | null {
  return input !== undefined && input > 0 && read?.state === 'present' &&
    read.value !== undefined && read.value <= input ? read.value / input : null;
}
