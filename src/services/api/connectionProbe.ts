import axios from 'axios';
import { computeApiUrl } from '@/utils/connection';
import { validateConnectionBase } from '@/services/storage/connectionProfiles';
import { assertV8ConfigMapping } from './configFile';
import { configRevision } from './configRevision';

/** 临时客户端不安装全局拦截器，失败与能力响应均不能改变活动实例。 */
export async function probeConnection(
  apiBase: string,
  managementKey: string,
  signal?: AbortSignal
): Promise<void> {
  const base = validateConnectionBase(apiBase);
  const client = axios.create({
    baseURL: computeApiUrl(base),
    timeout: 15_000,
    signal,
    headers: { Authorization: `Bearer ${managementKey.trim()}` },
  });
  const response = await client.get<unknown>('/config.yaml', {
    responseType: 'text',
    headers: { Accept: 'application/yaml, text/yaml, text/plain' },
  });
  assertV8ConfigMapping(response.data);
  configRevision(response, true);
}
