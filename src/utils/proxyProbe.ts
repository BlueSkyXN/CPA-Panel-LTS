export interface ProxyProbeResponse {
  status?: string;
  code?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const errorMessage = (error: unknown): string => {
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (error instanceof Error) return error.message;
  return '';
};

export type ProxyProbeOutcome =
  | { state: 'success'; code: 'reachable' | 'direct' }
  | { state: 'error'; code: string };

const KNOWN_ERROR_CODES = new Set([
  'empty',
  'invalid_proxy_url',
  'connection_refused',
  'timeout',
  'proxy_auth_required',
  'proxy_auth_failed',
  'tls_failed',
  'probe_failed',
  'unsupported',
]);

const isUnsupportedProbe = (err: unknown): boolean => {
  if (!isRecord(err)) return false;
  const status = typeof err.status === 'number' ? err.status : undefined;
  return status === 404 || status === 405;
};

export const interpretProxyProbe = (
  response: ProxyProbeResponse | null | undefined
): ProxyProbeOutcome => {
  const status = typeof response?.status === 'string' ? response.status : '';
  const code = typeof response?.code === 'string' ? response.code : '';

  if (status === 'ok' && code === 'reachable') return { state: 'success', code: 'reachable' };
  if (status === 'skipped' && code === 'direct') return { state: 'success', code: 'direct' };
  if (code && KNOWN_ERROR_CODES.has(code)) return { state: 'error', code };
  return { state: 'error', code: 'probe_failed' };
};

export const proxyProbeErrorCode = (err: unknown): string => {
  if (isUnsupportedProbe(err)) return 'unsupported';
  if (isRecord(err)) {
    const details = isRecord(err.details) ? err.details : isRecord(err.data) ? err.data : null;
    const code = typeof details?.code === 'string' ? details.code : '';
    if (KNOWN_ERROR_CODES.has(code)) return code;
    if (err.code === 'ECONNABORTED' || errorMessage(err).toLowerCase().includes('timeout')) {
      return 'timeout';
    }
  }
  return 'probe_failed';
};
