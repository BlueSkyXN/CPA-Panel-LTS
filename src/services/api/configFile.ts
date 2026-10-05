import { parseDocument, isMap } from 'yaml';
import { apiClient } from './client';
import { configRevision, configRevisionUnavailable } from './configRevision';

export interface ConfigYamlSnapshot {
  readonly content: string;
  readonly generation: number;
  /** ETag of the v8 `/config.yaml` read; every save must send it as If-Match. */
  readonly revision: string;
}

const YAML_ACCEPT = 'application/yaml, text/yaml, text/plain';

function guardConnection(generation: number): void {
  if (!apiClient.isCurrentConnection(generation))
    throw new Error('Configuration connection changed');
}

function assertConfigMapping(content: string): void {
  const doc = parseDocument(content);
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('Invalid configuration mapping');
}

export const configFileApi = {
  async fetchConfigYaml(): Promise<ConfigYamlSnapshot> {
    const generation = apiClient.getConnectionGeneration();
    const response = await apiClient.getRaw('/config.yaml', {
      responseType: 'text',
      headers: { Accept: YAML_ACCEPT },
    });
    guardConnection(generation);
    const data: unknown = response.data;
    if (typeof data !== 'string') throw new Error('Invalid configuration response');
    assertConfigMapping(data);
    return Object.freeze({ content: data, generation, revision: configRevision(response, true) });
  },

  /** 412/428 surface to the caller as a conflict; the draft must be reviewed against a reload. */
  async saveConfigYaml(content: string, snapshot: ConfigYamlSnapshot): Promise<void> {
    const { generation, revision } = snapshot;
    guardConnection(generation);
    assertConfigMapping(content);
    if (!revision) throw configRevisionUnavailable();
    await apiClient.put('/config.yaml', content, {
      headers: {
        'Content-Type': 'application/yaml',
        Accept: 'application/json, text/plain, */*',
        'If-Match': revision,
      },
    });
    guardConnection(generation);
  },
};
