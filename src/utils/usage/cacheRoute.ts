import type {
  CacheRouteKey, CacheRouteKind, CacheRouteReference, CacheRouteSelection, CacheRouteSummary,
} from '@/types/cacheDiagnostics';
import { isRecord } from '@/utils/helpers';

const kinds = ['cache_group', 'pck', 'outbound_session', 'input_session', 'named_cache'] as const;
const sourcePaths = [
  '', 'session_metadata', 'strict_prefix', 'prompt_cache_key', 'Session-Id', 'Session_id',
  'X-Session-Id', 'X-Claude-Code-Session-Id', 'X-Claude-Remote-Session-Id', 'X-Grok-Conv-Id', 'X-Tbh-Session-Id',
  'session_id', 'cachedContent', 'cached_content', 'request.cachedContent', 'request.cached_content',
];
const methods = ['inbound', 'client', 'outbound', 'strict_prefix', 'retained_group'] as const;

export const isCacheDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function readCacheRouteReference(value: unknown): CacheRouteReference | undefined {
  if (!isRecord(value) || !kinds.includes(value.kind as CacheRouteKind) || !isCacheDigest(value.digest) ||
      (value.scope !== undefined && value.scope !== '' && !isCacheDigest(value.scope)) ||
      (value.source !== undefined && (typeof value.source !== 'string' || !sourcePaths.includes(value.source))) ||
      !methods.includes(value.method as CacheRouteReference['method'])) return undefined;
  return {
    kind: value.kind as CacheRouteKind,
    digest: value.digest,
    scope: typeof value.scope === 'string' ? value.scope : undefined,
    method: value.method as CacheRouteReference['method'],
    source: typeof value.source === 'string' ? value.source : undefined,
  };
}

export function cacheRouteOrder(refs: CacheRouteReference[]): CacheRouteReference[] {
  return [...refs].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
}

export function cacheRouteKey(ref: CacheRouteReference): CacheRouteKey | undefined {
  return ref.scope ? { kind: ref.kind, digest: ref.digest, scope: ref.scope } : undefined;
}

export function cacheRouteMatches(route: CacheRouteSummary | undefined, key: CacheRouteKey) {
  return route?.references.some((ref) =>
    ref.kind === key.kind && ref.digest === key.digest && ref.scope === key.scope
  ) ?? false;
}

export function readCacheRoute(value: unknown): CacheRouteSummary | undefined {
  if (!isRecord(value) || value.version !== 1 ||
      typeof value.attempt_count !== 'number' || !Number.isInteger(value.attempt_count) ||
      value.attempt_count < 0 || value.attempt_count > 32 ||
      (value.references !== undefined && (!Array.isArray(value.references) || value.references.length > 12))) {
    return undefined;
  }
  const references = (value.references ?? []).map(readCacheRouteReference);
  if (references.some((ref) => ref === undefined)) return undefined;
  let selection: CacheRouteSelection | undefined;
  if (value.selection !== undefined) {
    const s = value.selection;
    if (!isRecord(s) || typeof s.method !== 'string' ||
        !['selection', 'session_binding', 'lcp', 'websocket_connection'].includes(s.method) ||
        typeof s.result !== 'string' || !['selected', 'failed', 'reused', 'committed', 'candidate_found'].includes(s.result) ||
        (s.prefix_length !== undefined && (!Number.isSafeInteger(s.prefix_length) || Number(s.prefix_length) < 0)) ||
        (s.prefix_unit !== undefined && !['', 'canonical_turns', 'strict_input_items'].includes(String(s.prefix_unit)))) return undefined;
    selection = {
      method: s.method, result: s.result,
      prefix_length: typeof s.prefix_length === 'number' ? s.prefix_length : undefined,
      prefix_unit: typeof s.prefix_unit === 'string' ? s.prefix_unit : undefined,
    };
  }
  const logical = value.logical_digest;
  const previous = value.previous_response_digest;
  const responses = value.response_digests;
  if ((logical !== undefined && logical !== '' && !isCacheDigest(logical)) ||
      (previous !== undefined && previous !== '' && !isCacheDigest(previous)) ||
      (responses !== undefined && (!Array.isArray(responses) || responses.length > 32 || !responses.every(isCacheDigest))) ||
      ['no_parsed_response', 'truncated', 'official_loss'].some((key) =>
        value[key] !== undefined && typeof value[key] !== 'boolean')) return undefined;
  return {
    version: 1, references: references.filter((ref): ref is CacheRouteReference => ref !== undefined),
    selection, attempt_count: value.attempt_count,
    no_parsed_response: value.no_parsed_response === true || undefined,
    truncated: value.truncated === true || undefined,
    logical_digest: typeof logical === 'string' ? logical : undefined,
    previous_response_digest: typeof previous === 'string' ? previous : undefined,
    response_digests: responses,
    official_loss: value.official_loss === true || undefined,
  };
}
