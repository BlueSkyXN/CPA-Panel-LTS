/**
 * 版本相关 API
 */

import { apiClient, ltsExtensionClient } from './client';
import type { ServerRuntimeKind } from '@/types';
import { isRecord } from '@/utils/helpers';

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/server/latest-version'),

  async detectRuntimeKind(): Promise<ServerRuntimeKind> {
    try {
      // Home control-plane probe: not part of the Core v8 contract.
      const data = await ltsExtensionClient.get('/nodes');
      return isRecord(data) && Array.isArray(data.nodes) ? 'home' : 'unknown';
    } catch (error: unknown) {
      const status = isRecord(error) ? error.status : undefined;
      if (status === 404 || status === 405) {
        return 'cpa';
      }
      return 'unknown';
    }
  }
};
