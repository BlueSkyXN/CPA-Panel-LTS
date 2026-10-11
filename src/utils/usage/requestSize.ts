/**
 * Request size and upstream transport fields recorded by CPA-Core-LTS usage details
 * (`size_version` 1, see Core docs/lts/usage-request-size.md). All fields are optional:
 * older Cores and unmeasured requests omit them.
 */

export const REQUEST_SIZE_VERSION_V1 = 1;

export const UPSTREAM_TRANSPORTS = ['http', 'websocket'] as const;
export type UpstreamTransport = (typeof UPSTREAM_TRANSPORTS)[number];

/**
 * Requests at or above this payload size count as large. It matches Core's default
 * `codex.outbound.websocket-threshold-bytes` (768 KiB), the size from which HTTP requests to
 * some upstream regions were observed to fail while websocket succeeded.
 */
export const LARGE_REQUEST_BYTES = 768 * 1024;

export const UPSTREAM_CONNECT_FAILURE_REASON = 'upstream_connect_failure';

export interface RequestSizeFields {
  size_version?: number;
  trace_id?: string;
  client_request_bytes?: number;
  client_request_encoding?: string;
  upstream_transport?: UpstreamTransport;
  upstream_request_bytes?: number;
  upstream_request_wire_bytes?: number;
  upstream_request_encoding?: string;
  upstream_response_bytes?: number;
}

const BYTE_FIELDS = [
  'client_request_bytes',
  'upstream_request_bytes',
  'upstream_request_wire_bytes',
  'upstream_response_bytes',
] as const;

const ENCODING_FIELDS = ['client_request_encoding', 'upstream_request_encoding'] as const;

const TRACE_ID_MAX_LENGTH = 64;

const readPositiveSafeInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const readToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase();
  return token ? token : undefined;
};

export const isUpstreamTransport = (value: unknown): value is UpstreamTransport =>
  typeof value === 'string' && (UPSTREAM_TRANSPORTS as readonly string[]).includes(value);

/**
 * Reads the size fields of one raw usage detail. Size fields are only trusted when
 * `size_version` is 1, mirroring Core's import rule; `trace_id` is independent of the version.
 */
export function extractRequestSize(detail: Record<string, unknown>): RequestSizeFields {
  const fields: RequestSizeFields = {};
  const traceId = typeof detail.trace_id === 'string' ? detail.trace_id.trim() : '';
  if (traceId && traceId.length <= TRACE_ID_MAX_LENGTH && !/[\\/]/.test(traceId)) {
    fields.trace_id = traceId;
  }
  if (detail.size_version !== REQUEST_SIZE_VERSION_V1) return fields;
  fields.size_version = REQUEST_SIZE_VERSION_V1;
  for (const key of BYTE_FIELDS) {
    const value = readPositiveSafeInteger(detail[key]);
    if (value !== undefined) fields[key] = value;
  }
  for (const key of ENCODING_FIELDS) {
    const value = readToken(detail[key]);
    if (value !== undefined) fields[key] = value;
  }
  const transport = readToken(detail.upstream_transport);
  if (isUpstreamTransport(transport)) fields.upstream_transport = transport;
  return fields;
}

/** Upstream payload size, falling back to wire size for encoded bodies (as Core analytics does). */
export function upstreamPayloadBytes(detail: RequestSizeFields): number | null {
  return detail.upstream_request_bytes ?? detail.upstream_request_wire_bytes ?? null;
}

interface FailureLike extends RequestSizeFields {
  failed?: boolean;
  failure_reason?: string | null;
}

/**
 * Derived diagnostic: a failed request whose upstream connection was refused/reset while the
 * request body was large. Such failures usually call for the websocket transport rather than
 * retries; it is a hint, not a stored failure reason.
 */
export function isLargeRequestConnectFailure(detail: FailureLike): boolean {
  if (!detail.failed || detail.failure_reason !== UPSTREAM_CONNECT_FAILURE_REASON) return false;
  const bytes = upstreamPayloadBytes(detail);
  return bytes !== null && bytes >= LARGE_REQUEST_BYTES;
}
