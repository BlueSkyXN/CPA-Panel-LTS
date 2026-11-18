import type {
  CacheObservation,
  CachePayload,
  CacheTrace,
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

export function compareCachePayloads(a: CachePayload, b: CachePayload): string[] | null {
  if (!a.known || !b.known) return null;
  return [...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])]
    .filter((key) => a.fields[key]?.digest !== b.fields[key]?.digest)
    .sort();
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
