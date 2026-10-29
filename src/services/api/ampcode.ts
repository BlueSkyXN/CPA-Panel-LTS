/**
 * Amp CLI Integration (ampcode) 相关 API：v8 顶层 `ampcode` 配置节点（LTS 保留能力）。
 */

import { isRecord } from '@/utils/helpers';
import { putConfigValue, readConfigSnapshot } from './configValue';
import { normalizeAmpcodeConfig } from './transformers';
import type { AmpcodeConfig, AmpcodeModelMapping, AmpcodeUpstreamApiKeyMapping } from '@/types';

const PATH = '/config/ampcode';

export interface AmpcodeSnapshot {
  readonly config: AmpcodeConfig;
  /** Persisted node, retaining fields the editor does not manage. */
  readonly raw: Record<string, unknown>;
  /** ETag of the same read; the save is rejected (412) if the file changed since. */
  readonly revision: string;
}

/** `undefined` leaves a field untouched; `null` removes it. */
export interface AmpcodeChanges {
  upstreamUrl?: string | null;
  upstreamApiKey?: string | null;
  forceModelMappings?: boolean;
  upstreamApiKeys?: AmpcodeUpstreamApiKeyMapping[] | null;
  modelMappings?: AmpcodeModelMapping[] | null;
}

const serializeUpstreamApiKeyMappings = (mappings: AmpcodeUpstreamApiKeyMapping[]) =>
  mappings.map((mapping) => ({
    'upstream-api-key': mapping.upstreamApiKey,
    'api-keys': mapping.apiKeys,
  }));

export function applyAmpcodeChanges(
  raw: Record<string, unknown>,
  changes: AmpcodeChanges
): Record<string, unknown> {
  const next = { ...raw };
  const assign = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (value === null) delete next[key];
    else next[key] = value;
  };
  assign('upstream-url', changes.upstreamUrl);
  assign('upstream-api-key', changes.upstreamApiKey);
  assign('force-model-mappings', changes.forceModelMappings);
  assign(
    'upstream-api-keys',
    changes.upstreamApiKeys === undefined || changes.upstreamApiKeys === null
      ? changes.upstreamApiKeys
      : serializeUpstreamApiKeyMappings(changes.upstreamApiKeys)
  );
  assign(
    'model-mappings',
    changes.modelMappings === undefined || changes.modelMappings === null
      ? changes.modelMappings
      : changes.modelMappings.map(({ from, to }) => ({ from, to }))
  );
  return next;
}

export const ampcodeApi = {
  async getAmpcodeSnapshot(): Promise<AmpcodeSnapshot> {
    const { value, revision } = await readConfigSnapshot<unknown>(PATH, {});
    const raw = isRecord(value) ? value : {};
    return { config: normalizeAmpcodeConfig(raw) ?? {}, raw, revision };
  },

  async getAmpcode(): Promise<AmpcodeConfig> {
    return (await ampcodeApi.getAmpcodeSnapshot()).config;
  },

  /** One revisioned PUT of the whole node: no partially applied multi-request saves. */
  async saveAmpcode(snapshot: AmpcodeSnapshot, changes: AmpcodeChanges): Promise<void> {
    await putConfigValue(PATH, applyAmpcodeChanges(snapshot.raw, changes), snapshot.revision);
  },
};
