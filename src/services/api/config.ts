import i18n from 'i18next';
import { apiClient } from './client';
import type { ApiError, Config } from '@/types';
import { guardConfigConnection, putConfigValue, readConfigSnapshot } from './configValue';
import { configRevisionFromHeaders } from './configRevision';
import { normalizeConfigResponse } from './transformers';

export const isConfigNotJSONCompatible = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  error.status === 422 &&
  'apiCode' in error &&
  error.apiCode === 'config_not_json_compatible';

const projectionPaths = [
  'observability/logs',
  'observability/usage',
  'requests/proxy-url',
  'routing',
  'access/api-keys',
  'api-keys',
  'quota-exceeded',
  'oauth/providers/aistudio/ws-auth',
  'oauth/providers/antigravity/antigravity-credits',
  'oauth/excluded-models',
  'ampcode',
  'plugins/enabled',
];

async function readConfigProjection(revision: string): Promise<Config> {
  const assertConnection = guardConfigConnection();
  const snapshots = await Promise.all(
    projectionPaths.map(async (path) => ({
      path,
      ...(await readConfigSnapshot<unknown>(`/config/${path}`, undefined)),
    }))
  );
  assertConnection();
  if (snapshots.some((snapshot) => snapshot.revision !== revision)) {
    throw new Error(
      i18n.t('config_management.read_conflict', {
        defaultValue: 'Configuration changed while reading; reload and try again.',
      })
    );
  }
  const view: Record<string, unknown> = {};
  for (const { path, value } of snapshots) {
    if (value === undefined) continue;
    const parts = path.split('/');
    let parent = view;
    for (const part of parts.slice(0, -1)) {
      parent[part] ??= {};
      parent = parent[part] as Record<string, unknown>;
    }
    parent[parts[parts.length - 1]] = value;
  }
  const config = normalizeConfigResponse(view);
  // This view omits plugin-owned YAML and must never authorize a full-document write.
  delete config.raw;
  return config;
}

export const configApi = {
  async getConfig(): Promise<Config> {
    const assertConnection = guardConfigConnection();
    try {
      const raw = await apiClient.get('/config');
      assertConnection();
      return normalizeConfigResponse(raw);
    } catch (error) {
      if (!isConfigNotJSONCompatible(error)) throw error;
      assertConnection();
      const revision = configRevisionFromHeaders((error as ApiError).headers, true);
      return readConfigProjection(revision);
    }
  },

  getRawConfig: () => apiClient.get('/config'),

  updateRequestLog: (enabled: boolean) =>
    putConfigValue('/config/observability/logs/request-log', enabled),
};
