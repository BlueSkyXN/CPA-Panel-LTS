import type { AxiosResponse } from 'axios';
import i18n from 'i18next';

export function configRevisionUnavailable(): Error {
  const fallback = 'Configuration revision unavailable; upgrade Core and reload before saving.';
  return new Error(
    i18n.t('config_management.revision_unavailable', { defaultValue: fallback }) || fallback
  );
}

export function configRevision(response: AxiosResponse, required: boolean): string | undefined {
  const value = response.headers?.etag ?? response.headers?.ETag;
  if (typeof value === 'string' && /^"[a-f0-9]{64}"$/.test(value)) return value;
  if (required) throw configRevisionUnavailable();
  return undefined;
}
