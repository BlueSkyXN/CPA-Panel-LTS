import { isRecord } from '@/utils/helpers';
import { ltsExtensionClient } from './client';
import type { CacheDiagnosticsCapabilities, CacheTraceQuery } from '@/types/cacheDiagnostics';
import { decodeCacheSession, decodeCacheTrace, decodeTracePage, isCacheLookupId, normalizeDiagnosticsId } from '@/utils/usage/cacheDiagnostics';

export function captureCacheDiagnosticsClient() {
  const generation = ltsExtensionClient.getConnectionGeneration();
  const client = ltsExtensionClient.captureConnection();
  const isCurrent = () => ltsExtensionClient.isCurrentConnection(generation);
  return {
    isCurrent,
    async trace(id: string, signal?: AbortSignal, instanceId?: string) {
      const normalizedId = normalizeDiagnosticsId(id);
      if (!normalizedId) throw new Error('Invalid diagnostic id');
      const value = await client.get<unknown>(
        `/cache-diagnostics/requests/${encodeURIComponent(normalizedId)}`,
        { signal, params: instanceId ? { instance_id: instanceId } : undefined }
      );
      const trace = isCurrent() ? decodeCacheTrace(value) : null;
      return trace?.id === normalizedId && (!instanceId || trace.instance_id === instanceId)
        ? trace
        : null;
    },
    async capabilities(signal?: AbortSignal): Promise<CacheDiagnosticsCapabilities> {
      const raw = await client.get<unknown>('/cache-diagnostics/capabilities', { signal });
      if (!isRecord(raw)) throw new Error('Invalid cache diagnostics capabilities');
      return {
        version: typeof raw.version === 'number' ? raw.version : undefined,
        recording_enabled: typeof raw.recording_enabled === 'boolean' ? raw.recording_enabled : undefined,
        trace_search_version: typeof raw.trace_search_version === 'number' ? raw.trace_search_version : undefined,
        store: isRecord(raw.store) && isCacheLookupId(raw.store.instance_id)
          ? {
              instance_id: raw.store.instance_id,
              ...(typeof raw.store.active === 'number' && Number.isFinite(raw.store.active) && raw.store.active >= 0
                ? { active: raw.store.active }
                : {}),
            }
          : undefined,
      };
    },
    async traces(query: CacheTraceQuery, signal?: AbortSignal) {
      const value = await client.get<unknown>('/cache-diagnostics/traces', { params: query, signal });
      return isCurrent() ? decodeTracePage(value) : null;
    },
    async session(
      provider: string,
      model: string,
      sessionHash: string,
      diagnosticId: string,
      signal?: AbortSignal
    ) {
      const value = await client.post<unknown>(
        '/cache-diagnostics/session',
        {
          provider,
          model,
          session_hash: sessionHash.toLowerCase(),
          diagnostics_id: diagnosticId.toLowerCase(),
        },
        { signal }
      );
      return isCurrent() ? decodeCacheSession(value) : null;
    },
  };
}
