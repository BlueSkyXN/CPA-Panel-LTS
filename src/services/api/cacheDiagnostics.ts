import { ltsExtensionClient } from './client';
import { decodeCacheSession, decodeCacheTrace } from '@/utils/usage/cacheDiagnostics';

export function captureCacheDiagnosticsClient() {
  const generation = ltsExtensionClient.getConnectionGeneration();
  const client = ltsExtensionClient.captureConnection();
  const isCurrent = () => ltsExtensionClient.isCurrentConnection(generation);
  return {
    isCurrent,
    async trace(id: string) {
      if (!/^[a-f0-9]{64}$/i.test(id)) throw new Error('Invalid diagnostic id');
      const value = await client.get<unknown>(
        `/cache-diagnostics/requests/${encodeURIComponent(id)}`
      );
      const trace = isCurrent() ? decodeCacheTrace(value) : null;
      return trace?.id === id ? trace : null;
    },
    async capabilities() {
      return client.get<{ version?: number; recording_enabled?: boolean }>(
        '/cache-diagnostics/capabilities'
      );
    },
    async session(provider: string, model: string, sessionHash: string, diagnosticId: string) {
      const value = await client.post<unknown>('/cache-diagnostics/session', {
        provider,
        model,
        session_hash: sessionHash,
        diagnostics_id: diagnosticId,
      });
      return isCurrent() ? decodeCacheSession(value) : null;
    },
  };
}
