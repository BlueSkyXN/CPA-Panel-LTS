/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';
import { decodeUsageImportReceipt, type UsageImportReceipt } from './usageImportContract';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export type UsageImportResponse = UsageImportReceipt;

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () =>
    apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: async (payload: unknown) => {
    const response = await apiClient.post<unknown>('/usage/import', payload, {
      timeout: USAGE_TIMEOUT_MS,
    });
    const receipt = decodeUsageImportReceipt(response);
    if (!receipt) throw new Error('Invalid usage import receipt');
    return receipt;
  },

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', {
        timeout: USAGE_TIMEOUT_MS,
      });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  },
};
