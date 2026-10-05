import type { AxiosResponse } from 'axios';
import i18n from 'i18next';

export function configRevisionUnavailable(): Error {
  const fallback = 'Configuration revision unavailable; upgrade Core and reload before saving.';
  return new Error(
    i18n.t('config_management.revision_unavailable', { defaultValue: fallback }) || fallback
  );
}

const readHeader = (headers: unknown, name: string): unknown => {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, name);
    if (value !== undefined && value !== null) return value;
  }
  const record = headers as Record<string, unknown>;
  return record[name] ?? record[name.toLowerCase()] ?? record.ETag;
};

/** Core v8 ETag is the strong sha256 revision of the persisted configuration file. */
export function configRevisionFromHeaders(headers: unknown, required: true): string;
export function configRevisionFromHeaders(headers: unknown, required: boolean): string | undefined;
export function configRevisionFromHeaders(headers: unknown, required: boolean): string | undefined {
  const value = readHeader(headers, 'etag');
  if (typeof value === 'string' && /^"[a-f0-9]{64}"$/.test(value)) return value;
  if (required) throw configRevisionUnavailable();
  return undefined;
}

export function configRevision(response: AxiosResponse, required: true): string;
export function configRevision(response: AxiosResponse, required: boolean): string | undefined;
export function configRevision(response: AxiosResponse, required: boolean): string | undefined {
  return configRevisionFromHeaders(response.headers, required);
}

/** 412/428 mean the edit was based on an obsolete or missing revision: reload, never retry blindly. */
export const isConfigRevisionConflict = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  (error.status === 412 || error.status === 428);
