import { ltsExtensionClient } from './client';
import { pluginsApi } from './plugins';
import { parsePatSummary, type AccountFormProvider, type PatProvider } from '@/features/authFiles/patProviders';

// Qoder 插件 0.3.0 起固定原生 direct_openai；旧插件（<0.3.0）未配置 transport 时实际仍是 sdk_cli。
const pluginVersionAtLeast = (version: unknown, minimum: string): boolean => {
  if (typeof version !== 'string' || !version) return false;
  const parts = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(version);
  const right = parts(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return true;
};

const QODER_DEFAULT_OPENAPI_ENDPOINT = 'https://openapi.qoder.com.cn';

export const patProvidersApi = {
  async configuration(provider: AccountFormProvider) {
    const list = await pluginsApi.list();
    // zcode-coding-plan 插件 ID 无 cpa-provider- 前缀，按插件 ID/名称直接匹配。
    const plugin = list.plugins.find(
      (entry) =>
        entry.registered &&
        entry.effectiveEnabled &&
        (entry.metadata?.name === `cpa-provider-${provider}` ||
          entry.id === `cpa-provider-${provider}` ||
          entry.metadata?.name === provider ||
          entry.id === provider)
    );
    if (!list.pluginsEnabled || !plugin) throw new Error('plugin_unavailable');
    if (provider === 'zcode-coding-plan') {
      return {
        transport: 'direct_anthropic',
        endpoint: 'https://open.bigmodel.cn/api/anthropic/v1/messages',
      };
    }
    const config = await pluginsApi.getConfig(plugin.id);
    if (provider === 'codebuddy') {
      return {
        transport: 'direct_https',
        endpoint: String(config.endpoint || 'https://copilot.tencent.com/v2/chat/completions'),
      };
    }
    const nativeOnly = pluginVersionAtLeast(plugin.metadata?.version, '0.3.0');
    return {
      transport: nativeOnly ? 'direct_openai' : String(config.transport || 'sdk_cli'),
      endpoint: String(
        config.openapi_endpoint ||
          config.direct_auth_endpoint ||
          (nativeOnly ? QODER_DEFAULT_OPENAPI_ENDPOINT : '')
      ),
    };
  },
  async summary(provider: PatProvider, authIndex: string) {
    const response = await ltsExtensionClient.get<unknown>(`/plugins/${provider}/summary`, {
      params: { auth_index: authIndex },
    });
    return parsePatSummary(response, provider, authIndex);
  },
};
