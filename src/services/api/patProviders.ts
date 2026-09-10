import { apiClient } from './client';
import { pluginsApi } from './plugins';
import { parsePatSummary, type PatProvider } from '@/features/authFiles/patProviders';

export const patProvidersApi = {
  async configuration(provider: PatProvider) {
    const list = await pluginsApi.list();
    const plugin = list.plugins.find(
      (entry) =>
        entry.registered &&
        entry.effectiveEnabled &&
        (entry.metadata?.name === `cpa-provider-${provider}` ||
          entry.id === `cpa-provider-${provider}`)
    );
    if (!list.pluginsEnabled || !plugin) throw new Error('plugin_unavailable');
    const config = await pluginsApi.getConfig(plugin.id);
    return {
      transport: provider === 'codebuddy' ? 'direct_https' : String(config.transport || 'sdk_cli'),
      endpoint:
        provider === 'qoder'
          ? String(config.openapi_endpoint || config.direct_auth_endpoint || '')
          : String(config.endpoint || 'https://copilot.tencent.com/v2/chat/completions'),
    };
  },
  async summary(provider: PatProvider, authIndex: string) {
    const response = await apiClient.get<unknown>(`/plugins/${provider}/summary`, {
      params: { auth_index: authIndex },
    });
    return parsePatSummary(response, provider, authIndex);
  },
};
