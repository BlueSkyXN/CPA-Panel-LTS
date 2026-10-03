import { apiClient } from './client';
import { parseConfigDocument, usesV8ConfigLayout } from '@/utils/configLayout';

let loadedGeneration: number | undefined;
let loadedV8 = false;

function guardConnection(generation: number): void {
  if (!apiClient.isCurrentConnection(generation)) throw new Error('Configuration connection changed');
}

export const configFileApi = {
  async fetchConfigYaml(): Promise<string> {
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
    }
    loadedGeneration = generation;
    loadedV8 = v8;
    return content;
  },

  async saveConfigYaml(content: string): Promise<void> {
    if (loadedGeneration === undefined) throw new Error('Configuration must be loaded before saving');
    const generation = loadedGeneration;
    guardConnection(generation);
    parseConfigDocument(content);
    const v8 = usesV8ConfigLayout(content);
    if (v8 !== loadedV8) throw new Error('Configuration layout changed; reload before saving');
    const options = {
      managementApiVersion: v8 ? 'v8' as const : 'v0' as const,
      headers: {
        'Content-Type': 'application/yaml',
        Accept: 'application/json, text/plain, */*',
      },
    };
    await apiClient.put('/config.yaml', content, options);
    guardConnection(generation);
  },
};
