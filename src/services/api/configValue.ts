import type { ApiError } from '@/types';
import { apiClient } from './client';
import { configRevision, configRevisionFromHeaders } from './configRevision';

/** Capture before a config read and check immediately before its dependent write. */
export function guardConfigConnection(): () => void {
  const revision = apiClient.getConnectionRevision();
  return () => {
    if (revision !== apiClient.getConnectionRevision()) {
      throw new DOMException('The management connection changed.', 'AbortError');
    }
  };
}

/** Only an absent persisted config field is optional, not a missing API route. */
export const isMissingConfigValue = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  error.status === 404 &&
  'apiCode' in error &&
  error.apiCode === 'not_found';

export async function getConfigValue<T>(path: string, defaultValue: T): Promise<T> {
  try {
    return await apiClient.get<T>(path);
  } catch (error) {
    if (isMissingConfigValue(error)) return defaultValue;
    throw error;
  }
}

export interface ConfigSnapshot<T> {
  readonly value: T;
  /** ETag of the same response; send it as If-Match when writing a change derived from value. */
  readonly revision: string;
}

/** Read a v8 config node together with the file revision it was derived from. */
export async function readConfigSnapshot<T>(
  path: string,
  defaultValue: T
): Promise<ConfigSnapshot<T>> {
  try {
    const response = await apiClient.getRaw(path);
    return { value: response.data as T, revision: configRevision(response, true) };
  } catch (error) {
    if (isMissingConfigValue(error)) {
      // Core sets ETag before reporting a missing field, so absence is still revisioned.
      const headers = (error as ApiError).headers;
      return { value: defaultValue, revision: configRevisionFromHeaders(headers, true) };
    }
    throw error;
  }
}

/** Current revision for a write that does not depend on previously read data (single scalar). */
export async function fetchConfigRevision(): Promise<string> {
  const response = await apiClient.getRaw('/config.yaml', {
    responseType: 'text',
    headers: { Accept: 'application/yaml, text/yaml, text/plain' },
  });
  return configRevision(response, true);
}

export const ifMatch = (revision: string) => ({ headers: { 'If-Match': revision } });

/**
 * Write one config node. A list/map change must pass the revision of the read it was derived
 * from; omitting it is only valid for an independent scalar whose new value replaces the node.
 * Core clears the ETag after a successful write, so every later write must read again.
 */
export async function putConfigValue(path: string, value: unknown, revision?: string) {
  const assertConnection = guardConfigConnection();
  const current = revision ?? (await fetchConfigRevision());
  assertConnection();
  return apiClient.put(path, value, ifMatch(current));
}

export async function deleteConfigValue(path: string, revision?: string) {
  const assertConnection = guardConfigConnection();
  const current = revision ?? (await fetchConfigRevision());
  assertConnection();
  return apiClient.delete(path, ifMatch(current));
}
