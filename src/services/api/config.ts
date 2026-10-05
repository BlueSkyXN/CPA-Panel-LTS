/**
 * 配置相关 API（v8 原生配置树）
 */

import { apiClient } from './client';
import type { Config } from '@/types';
import { putConfigValue } from './configValue';
import { normalizeConfigResponse } from './transformers';

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）。v8 JSON 视图已为 api-keys 注入 auth_index。
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  /**
   * 获取原始 v8 配置树（不做转换）
   */
  getRawConfig: () => apiClient.get('/config'),

  /**
   * 请求日志开关：独立标量，写入前读取当前 revision 并以 If-Match 提交。
   */
  updateRequestLog: (enabled: boolean) =>
    putConfigValue('/config/observability/logs/request-log', enabled),
};
