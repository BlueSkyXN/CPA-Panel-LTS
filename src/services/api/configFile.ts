import { apiClient } from './client';
import { configRevision, configRevisionUnavailable } from './configRevision';
import { parseConfigDocument, usesV8ConfigLayout } from '@/utils/configLayout';

export interface ConfigYamlSnapshot {
  readonly content: string;
  readonly generation: number;
  readonly v8: boolean;
  readonly revision?: string;
}

function guardConnection(generation: number): void {
  if (!apiClient.isCurrentConnection(generation))
    throw new Error('Configuration connection changed');
}

export const configFileApi = {
  async fetchConfigYaml(): Promise<ConfigYamlSnapshot> {
    const generation = apiClient.getConnectionGeneration();
    const response = await apiClient.getRaw('/config.yaml', {
      responseType: 'text',
      headers: { Accept: 'application/yaml, text/yaml, text/plain' },
    });
    guardConnection(generation);
    const data: unknown = response.data;
    if (typeof data !== 'string') throw new Error('Invalid configuration response');
    parseConfigDocument(data);
    const v8 = usesV8ConfigLayout(data);
    let content = data;
    let revision = configRevision(response, false);
    if (v8) {
      const options = {
        managementApiVersion: 'v8' as const,
        responseType: 'text' as const,
        headers: { Accept: 'application/yaml, text/yaml, text/plain' },
      };
      const canonical = await apiClient.getRaw('/config.yaml', options);
      guardConnection(generation);
      if (typeof canonical.data !== 'string') throw new Error('Invalid configuration response');
      parseConfigDocument(canonical.data);
      if (!usesV8ConfigLayout(canonical.data)) throw new Error('Invalid v8 configuration response');
      content = canonical.data;
      revision = configRevision(canonical, true);
    }
    return Object.freeze({ content, generation, v8, revision });
  },

  async saveConfigYaml(content: string, snapshot: ConfigYamlSnapshot): Promise<void> {
    const { generation, revision } = snapshot;
    guardConnection(generation);
    parseConfigDocument(content);
    const v8 = usesV8ConfigLayout(content);
    if (v8 !== snapshot.v8) throw new Error('Configuration layout changed; reload before saving');
    if (v8 && !revision) throw configRevisionUnavailable();
    const options = {
      managementApiVersion: v8 ? ('v8' as const) : ('v0' as const),
      headers: {
        'Content-Type': 'application/yaml',
        Accept: 'application/json, text/plain, */*',
        ...(revision ? { 'If-Match': revision } : {}),
      },
    };
    await apiClient.put('/config.yaml', content, options);
    guardConnection(generation);
  },
};
