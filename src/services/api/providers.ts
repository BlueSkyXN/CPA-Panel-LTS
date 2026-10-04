/**
 * AI 提供商相关 API
 */

import { apiClient } from './client';
import {
  mutateProviderConfig,
  MODEL_SOURCE_INDEX,
  providerValuesEqual,
  type ModelPayload,
} from './providerGroups';
import { isRecord } from '@/utils/helpers';
import {
  normalizeGeminiKeyConfig,
  normalizeOpenAIProvider,
  normalizeProviderKeyConfig,
} from './transformers';
import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
  ApiKeyEntry,
  ModelAlias,
} from '@/types';

const serializeHeaders = (headers?: Record<string, string>) =>
  headers && Object.keys(headers).length ? headers : undefined;

const RESPONSE_ONLY_FIELDS = ['auth-index', 'authIndex', 'auth_index'] as const;
const RESPONSE_ONLY_FIELD_SET = new Set<string>(RESPONSE_ONLY_FIELDS);

const PROVIDER_COMMON_KEY_FIELDS = [
  'api-key',
  'priority',
  'weight',
  'prefix',
  'base-url',
  'proxy-url',
  'headers',
  'models',
  'excluded-models',
  'disable-cooling',
] as const;

const GEMINI_KEY_FIELDS = PROVIDER_COMMON_KEY_FIELDS;
const INTERACTIONS_KEY_FIELDS = PROVIDER_COMMON_KEY_FIELDS;
const CODEX_KEY_FIELDS = [...PROVIDER_COMMON_KEY_FIELDS, 'websockets'] as const;
const XAI_KEY_FIELDS = CODEX_KEY_FIELDS;
const CLAUDE_KEY_FIELDS = [
  ...PROVIDER_COMMON_KEY_FIELDS,
  'cloak',
  'fingerprint-profile',
  // Remove the deprecated no-op when a Claude entry is saved.
  'experimental-cch-signing',
] as const;
const VERTEX_KEY_FIELDS = [
  'api-key',
  'priority',
  'weight',
  'prefix',
  'base-url',
  'proxy-url',
  'headers',
  'models',
  'excluded-models',
] as const;

const OPENAI_PROVIDER_FIELDS = [
  'name',
  'priority',
  'disabled',
  'prefix',
  'base-url',
  'api-key-entries',
  'headers',
  'models',
  'test-model',
  'disable-cooling',
] as const;

const MODEL_ALIAS_FIELDS = [
  'name',
  'alias',
  'display-name',
  'displayName',
  'display_name',
  'priority',
  'test-model',
  'thinking',
] as const;
const OPENAI_MODEL_ALIAS_FIELDS = [...MODEL_ALIAS_FIELDS, 'image'] as const;

const API_KEY_ENTRY_FIELDS = ['api-key', 'proxy-url', 'weight'] as const;

const CLOAK_FIELDS = ['mode', 'strict-mode', 'sensitive-words', 'cache-user-id'] as const;

const getStringField = (record: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const providerKeyIdentity = (record: Record<string, unknown>) => {
  const apiKey = getStringField(record, ['api-key']);
  if (!apiKey) return '';
  const baseUrl = getStringField(record, ['base-url']);
  return `${apiKey}\u0000${baseUrl}`;
};

const openAIProviderIdentity = (record: Record<string, unknown>) =>
  getStringField(record, ['name']);

export const getOpenAIProviderMutationIndex = (
  provider: OpenAIProviderConfig,
  fallbackIndex: number
) => provider.sourceIndex ?? fallbackIndex;

const apiKeyEntryIdentity = (record: Record<string, unknown>) =>
  getStringField(record, ['api-key']);

const cloneWithoutKnownFields = (
  raw: unknown,
  knownFields: readonly string[]
): Record<string, unknown> => {
  const next: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  [...knownFields, ...RESPONSE_ONLY_FIELDS].forEach((field) => {
    delete next[field];
  });
  return next;
};

const mergeKnownFields = (
  raw: unknown,
  payload: Record<string, unknown>,
  knownFields: readonly string[]
) => {
  const next = cloneWithoutKnownFields(raw, knownFields);
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) {
      next[key] = value;
    }
  });
  return next;
};

const stripResponseOnlyRecordFields = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !RESPONSE_ONLY_FIELD_SET.has(key))
  );
};

const stripResponseOnlyProviderFields = (items: unknown[]): unknown[] =>
  items.map((item) => {
    const provider = stripResponseOnlyRecordFields(item);
    if (!isRecord(provider) || !Array.isArray(provider['api-key-entries'])) {
      return provider;
    }
    return {
      ...provider,
      'api-key-entries': provider['api-key-entries'].map(stripResponseOnlyRecordFields),
    };
  });

const findRawRecord = (
  rawRecords: Array<Record<string, unknown> | undefined>,
  usedIndexes: Set<number>,
  payload: Record<string, unknown>,
  index: number,
  getIdentity: (record: Record<string, unknown>) => string,
  fallbackByIndex = true
) => {
  const identity = getIdentity(payload);
  if (identity) {
    for (let i = 0; i < rawRecords.length; i += 1) {
      const candidate = rawRecords[i];
      if (!candidate || usedIndexes.has(i)) continue;
      if (getIdentity(candidate) === identity) {
        usedIndexes.add(i);
        return candidate;
      }
    }
  }

  if (fallbackByIndex) {
    const fallback = rawRecords[index];
    if (fallback && !usedIndexes.has(index)) {
      usedIndexes.add(index);
      return fallback;
    }
  }

  return undefined;
};

const mergeKnownRecordList = (
  rawItems: unknown,
  payloadItems: Record<string, unknown>[],
  knownFields: readonly string[],
  getIdentity: (record: Record<string, unknown>) => string,
  fallbackByIndex = true
) => {
  const rawRecords = Array.isArray(rawItems)
    ? rawItems.map((item) => (isRecord(item) ? item : undefined))
    : [];
  const usedIndexes = new Set<number>();

  return payloadItems.map((payload, index) => {
    const raw = findRawRecord(
      rawRecords,
      usedIndexes,
      payload,
      index,
      getIdentity,
      fallbackByIndex
    );
    return mergeKnownFields(raw, payload, knownFields);
  });
};

type ProviderRecordMerger = (
  raw: unknown,
  payload: Record<string, unknown>
) => Record<string, unknown>;

export function appendLatestProviderRecord(
  latestItems: unknown[],
  payload: Record<string, unknown>,
  mergePayload: ProviderRecordMerger
): unknown[] {
  const identity = payload.name !== undefined ? openAIProviderIdentity : providerKeyIdentity;
  if (latestItems.some((item) => isRecord(item) && identity(item) === identity(payload))) {
    throw new Error('Provider configuration changed or is ambiguous; refresh and try again.');
  }
  return [...latestItems, mergePayload(undefined, payload)];
}

export function replaceLatestProviderRecord(
  latestItems: unknown[],
  isTarget: (record: Record<string, unknown>, index: number) => boolean,
  payload: Record<string, unknown>,
  mergePayload: ProviderRecordMerger,
  matchesSnapshot?: (record: Record<string, unknown>) => boolean
): unknown[] {
  const targets = latestItems.flatMap((item, index) =>
    isRecord(item) && isTarget(item, index) ? [index] : []
  );
  const targetIndex = targets[0] ?? -1;
  if (
    targets.length !== 1 ||
    (matchesSnapshot && !matchesSnapshot(latestItems[targetIndex] as Record<string, unknown>))
  ) {
    throw new Error('Provider configuration changed; refresh and try again.');
  }

  const identity = payload.name !== undefined ? openAIProviderIdentity : providerKeyIdentity;
  if (
    latestItems.some(
      (item, index) =>
        index !== targetIndex && isRecord(item) && identity(item) === identity(payload)
    )
  )
    throw new Error('Provider configuration changed or is ambiguous; refresh and try again.');
  return latestItems.map((item, index) =>
    index === targetIndex ? mergePayload(item, payload) : item
  );
}

const mutateLatestProviderList = async (
  section: string,
  mutate: (latestItems: unknown[]) => unknown[],
  validateSnapshot?: (items: unknown[]) => void
) => {
  await mutateProviderConfig(
    section,
    (items) => stripResponseOnlyProviderFields(mutate(items)),
    undefined,
    validateSnapshot
  );
};

const savePreservedList = <T extends ProviderKeyConfig | OpenAIProviderConfig>(
  section: string,
  configs: T[],
  baseline: T[],
  serialize: (item: T) => Record<string, unknown>,
  mergePayload: ProviderRecordMerger,
  getIdentity: (record: Record<string, unknown>) => string
) => {
  const expected = structuredClone(baseline.map((item) => providerConfigSnapshot(section, item)));
  const desired = structuredClone(configs);
  return mutateLatestProviderList(
    section,
    (rawItems) => {
      const payloads = desired.map(serialize);
      const identities = payloads.map(getIdentity);
      if (new Set(identities).size !== identities.length)
        throw new Error('Provider configuration changed or is ambiguous; refresh and try again.');
      const rawRecords = rawItems.map((item) => (isRecord(item) ? item : undefined));
      const usedIndexes = new Set<number>();
      return payloads.map((payload, index) => {
        const raw = findRawRecord(rawRecords, usedIndexes, payload, index, getIdentity);
        if (
          raw &&
          providerValuesEqual(
            providerConfigSnapshot(section, normalizeProviderRecord(section, raw)),
            providerConfigSnapshot(section, desired[index])
          )
        )
          return raw;
        return mergePayload(raw, payload);
      });
    },
    (items) => {
      const current = items.map((item) =>
        providerConfigSnapshot(section, normalizeProviderRecord(section, item))
      );
      if (!providerValuesEqual(current, expected))
        throw new Error('Provider configuration changed; refresh and try again.');
    }
  );
};

const deleteProviderKey = (
  section: string,
  apiKey: string,
  baseUrl: string | undefined,
  snapshot: ProviderKeyConfig
) =>
  mutateProviderConfig(
    section,
    (items) =>
      stripResponseOnlyProviderFields(
        items.filter((item) => !isRecord(item) || !matchesProviderKey(item, apiKey, baseUrl))
      ),
    () => {
      const query = new URLSearchParams({
        'api-key': apiKey.trim(),
        'base-url': (baseUrl ?? '').trim(),
      });
      return apiClient.delete(`/${section}?${query}`);
    },
    providerKeySnapshotGuard(section, apiKey, baseUrl, snapshot)
  );

const matchesProviderKey = (record: Record<string, unknown>, apiKey: string, baseUrl?: string) =>
  getStringField(record, ['api-key']) === apiKey.trim() &&
  getStringField(record, ['base-url']) === (baseUrl ?? '').trim();

const matchesOpenAIProvider = (record: Record<string, unknown>, name: string) =>
  openAIProviderIdentity(record) === name.trim();

const mergeModelPayloads = (
  raw: unknown,
  models: unknown,
  knownFields: readonly string[] = MODEL_ALIAS_FIELDS
) => {
  if (!Array.isArray(models)) return undefined;
  const rawModels: unknown[] = isRecord(raw) && Array.isArray(raw.models) ? raw.models : [];
  const used = new Set<number>();
  return models.filter(isRecord).map((payload: ModelPayload) => {
    const sourceIndex = payload[MODEL_SOURCE_INDEX];
    let index = -1;
    if (typeof sourceIndex === 'number') {
      if (
        !Number.isSafeInteger(sourceIndex) ||
        used.has(sourceIndex) ||
        !isRecord(rawModels[sourceIndex])
      ) {
        throw new Error('Provider models changed; refresh and try again.');
      }
      index = sourceIndex;
    } else if (sourceIndex !== null) {
      const candidates = rawModels.flatMap((item, i) =>
        !used.has(i) && isRecord(item) && item.name === payload.name ? [i] : []
      );
      const exact = candidates.filter(
        (i) => (rawModels[i] as Record<string, unknown>).alias === payload.alias
      );
      if (exact.length === 1) index = exact[0];
      else if (candidates.length === 1) index = candidates[0];
      else if (candidates.length)
        throw new Error('Provider models are ambiguous; refresh and try again.');
    }
    if (index >= 0) used.add(index);
    const merged = mergeKnownFields(rawModels[index], payload, knownFields) as ModelPayload;
    merged[MODEL_SOURCE_INDEX] = index >= 0 ? index : null;
    return merged;
  });
};

const mergeProviderKeyPayload = (
  raw: unknown,
  payload: Record<string, unknown>,
  knownFields: readonly string[]
) => {
  const next = mergeKnownFields(raw, payload, knownFields);
  const models = mergeModelPayloads(raw, payload.models);
  if (models) next.models = models;
  if (isRecord(payload.cloak)) {
    next.cloak = mergeKnownFields(
      isRecord(raw) ? raw.cloak : undefined,
      payload.cloak,
      CLOAK_FIELDS
    );
  }
  return next;
};

const mergeOpenAIProviderPayload = (raw: unknown, payload: Record<string, unknown>) => {
  const next = mergeKnownFields(raw, payload, OPENAI_PROVIDER_FIELDS);
  const rawApiKeyEntries = isRecord(raw) ? raw['api-key-entries'] : undefined;
  const apiKeyEntries = payload['api-key-entries'];
  if (Array.isArray(apiKeyEntries)) {
    next['api-key-entries'] = mergeKnownRecordList(
      rawApiKeyEntries,
      apiKeyEntries.filter(isRecord),
      API_KEY_ENTRY_FIELDS,
      apiKeyEntryIdentity
    );
  }
  const models = mergeModelPayloads(raw, payload.models, OPENAI_MODEL_ALIAS_FIELDS);
  if (models) next.models = models;
  return next;
};

const extractArrayPayload = (data: unknown, key: string): unknown[] => {
  if (!isRecord(data)) return [];
  const list = data[key];
  return Array.isArray(list) ? list : [];
};

const serializeModelAliases = (models?: ModelAlias[], includeImage = false) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          if (!model?.name) return null;
          const payload: ModelPayload = {
            name: model.name,
            [MODEL_SOURCE_INDEX]: model.sourceIndex,
          };
          if (model.alias) {
            payload.alias = model.alias;
          }
          if (model.displayName?.trim()) {
            payload['display-name'] = model.displayName.trim();
          }
          if (model.priority !== undefined) {
            payload.priority = model.priority;
          }
          if (model.testModel) {
            payload['test-model'] = model.testModel;
          }
          if (model.thinking) {
            payload.thinking = model.thinking;
          }
          if (includeImage) {
            if (model.image) {
              payload.image = true;
            }
          }
          return payload;
        })
        .filter(Boolean)
    : undefined;

const serializeApiKeyEntry = (entry: ApiKeyEntry) => {
  const payload: Record<string, unknown> = { 'api-key': entry.apiKey };
  if (entry.proxyUrl) payload['proxy-url'] = entry.proxyUrl;
  if (entry.weight !== undefined) payload.weight = entry.weight;
  return payload;
};

const serializeProviderKey = (config: ProviderKeyConfig) => {
  const payload: Record<string, unknown> = { 'api-key': config.apiKey };
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.weight !== undefined) payload.weight = config.weight;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl) payload['base-url'] = config.baseUrl;
  if (config.websockets !== undefined) payload.websockets = config.websockets;
  if (config.proxyUrl) payload['proxy-url'] = config.proxyUrl;
  if (config.disableCooling !== undefined) payload['disable-cooling'] = config.disableCooling;
  const headers = serializeHeaders(config.headers);
  if (headers) payload.headers = headers;
  const models = serializeModelAliases(config.models);
  if (models && models.length) payload.models = models;
  if (config.excludedModels && config.excludedModels.length) {
    payload['excluded-models'] = config.excludedModels;
  }
  if (config.cloak) {
    const cloakPayload: Record<string, unknown> = {};
    const mode = config.cloak.mode?.trim();
    if (mode) cloakPayload.mode = mode;
    if (config.cloak.strictMode !== undefined)
      cloakPayload['strict-mode'] = config.cloak.strictMode;
    if (config.cloak.sensitiveWords && config.cloak.sensitiveWords.length) {
      cloakPayload['sensitive-words'] = config.cloak.sensitiveWords;
    }
    if (config.cloak.cacheUserId) {
      cloakPayload['cache-user-id'] = true;
    }
    if (Object.keys(cloakPayload).length) {
      payload.cloak = cloakPayload;
    }
  }
  if (config.fingerprintProfile?.trim()) {
    payload['fingerprint-profile'] = config.fingerprintProfile.trim();
  }
  return payload;
};

const serializeVertexModelAliases = (models?: ModelAlias[]) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          const name = typeof model?.name === 'string' ? model.name.trim() : '';
          const alias = typeof model?.alias === 'string' ? model.alias.trim() : '';
          const displayName =
            typeof model?.displayName === 'string' ? model.displayName.trim() : '';
          if (!name || !alias) return null;
          const payload: Record<string, unknown> = { name, alias };
          if (displayName) payload['display-name'] = displayName;
          if (model.thinking) payload.thinking = model.thinking;
          return payload;
        })
        .filter(Boolean)
    : undefined;

const serializeVertexKey = (config: ProviderKeyConfig) => {
  const payload: Record<string, unknown> = { 'api-key': config.apiKey };
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.weight !== undefined) payload.weight = config.weight;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl) payload['base-url'] = config.baseUrl;
  if (config.proxyUrl) payload['proxy-url'] = config.proxyUrl;
  const headers = serializeHeaders(config.headers);
  if (headers) payload.headers = headers;
  const models = serializeVertexModelAliases(config.models);
  if (models && models.length) payload.models = models;
  if (config.excludedModels && config.excludedModels.length) {
    payload['excluded-models'] = config.excludedModels;
  }
  return payload;
};

const serializeGeminiKey = (config: GeminiKeyConfig) => {
  const payload: Record<string, unknown> = { 'api-key': config.apiKey };
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.weight !== undefined) payload.weight = config.weight;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl) payload['base-url'] = config.baseUrl;
  if (config.proxyUrl) payload['proxy-url'] = config.proxyUrl;
  if (config.disableCooling !== undefined) payload['disable-cooling'] = config.disableCooling;
  const headers = serializeHeaders(config.headers);
  if (headers) payload.headers = headers;
  const models = serializeModelAliases(config.models);
  if (models && models.length) payload.models = models;
  if (config.excludedModels && config.excludedModels.length) {
    payload['excluded-models'] = config.excludedModels;
  }
  return payload;
};

const serializeOpenAIProvider = (provider: OpenAIProviderConfig) => {
  const payload: Record<string, unknown> = {
    name: provider.name,
    'base-url': provider.baseUrl,
    'api-key-entries': Array.isArray(provider.apiKeyEntries)
      ? provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry))
      : [],
  };
  if (provider.prefix?.trim()) payload.prefix = provider.prefix.trim();
  if (provider.disabled !== undefined) payload.disabled = provider.disabled;
  const headers = serializeHeaders(provider.headers);
  if (headers) payload.headers = headers;
  const models = serializeModelAliases(provider.models, true);
  if (models && models.length) payload.models = models;
  if (provider.priority !== undefined) payload.priority = provider.priority;
  if (provider.testModel) payload['test-model'] = provider.testModel;
  if (provider.disableCooling !== undefined) payload['disable-cooling'] = provider.disableCooling;
  return payload;
};

export const providerConfigSnapshot = (
  section: string,
  provider: ProviderKeyConfig | OpenAIProviderConfig
): Record<string, unknown> => {
  if (section === 'openai-compatibility') {
    const openai = provider as OpenAIProviderConfig;
    return { ...serializeOpenAIProvider(openai), disabled: openai.disabled ?? false };
  }
  if (section === 'vertex-api-key') return serializeVertexKey(provider as ProviderKeyConfig);
  if (section === 'gemini-api-key' || section === 'interactions-api-key')
    return serializeGeminiKey(provider as GeminiKeyConfig);
  return serializeProviderKey(provider as ProviderKeyConfig);
};

const normalizeProviderRecord = (section: string, raw: unknown) => {
  const result =
    section === 'openai-compatibility'
      ? normalizeOpenAIProvider(raw)
      : section === 'gemini-api-key' || section === 'interactions-api-key'
        ? normalizeGeminiKeyConfig(raw)
        : normalizeProviderKeyConfig(raw);
  if (!result) throw new Error('Invalid provider configuration');
  return result;
};

const providerKeySnapshotGuard = (
  section: string,
  apiKey: string,
  baseUrl: string | undefined,
  snapshot: ProviderKeyConfig
) => {
  const expected = structuredClone(providerConfigSnapshot(section, snapshot));
  const matchesIdentity =
    snapshot.apiKey.trim() === apiKey.trim() &&
    (snapshot.baseUrl ?? '').trim() === (baseUrl ?? '').trim();
  return (items: unknown[]) => {
    const matches = items.filter(
      (item) => isRecord(item) && matchesProviderKey(item, apiKey, baseUrl)
    );
    if (
      matches.length !== 1 ||
      !matchesIdentity ||
      !providerValuesEqual(
        providerConfigSnapshot(section, normalizeProviderRecord(section, matches[0])),
        expected
      )
    )
      throw new Error('Provider configuration changed or is ambiguous; refresh and try again.');
  };
};

const openAIProviderSnapshotGuard = (index: number, snapshot: OpenAIProviderConfig) => {
  const expected = structuredClone(providerConfigSnapshot('openai-compatibility', snapshot));
  const name = snapshot.name.trim();
  const sourceIndex = snapshot.sourceIndex;
  return (items: unknown[]) => {
    const current = normalizeOpenAIProvider(items[index], index);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      (sourceIndex !== undefined && sourceIndex !== index) ||
      !name ||
      items.filter((item) => isRecord(item) && matchesOpenAIProvider(item, name)).length !== 1 ||
      !current ||
      current.name.trim() !== name ||
      !providerValuesEqual(providerConfigSnapshot('openai-compatibility', current), expected)
    ) {
      throw new Error('Provider configuration changed or is ambiguous; refresh and try again.');
    }
  };
};

export const providersApi = {
  async getGeminiKeys(): Promise<GeminiKeyConfig[]> {
    const data = await apiClient.get('/gemini-api-key');
    const list = extractArrayPayload(data, 'gemini-api-key');
    return list.map((item) => normalizeGeminiKeyConfig(item)).filter(Boolean) as GeminiKeyConfig[];
  },

  saveGeminiKeys: async (configs: GeminiKeyConfig[], baseline: GeminiKeyConfig[]) =>
    savePreservedList(
      'gemini-api-key',
      configs,
      baseline,
      serializeGeminiKey,
      (raw, payload) => mergeProviderKeyPayload(raw, payload, GEMINI_KEY_FIELDS),
      providerKeyIdentity
    ),

  createGeminiKey: (config: GeminiKeyConfig) =>
    mutateLatestProviderList('gemini-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeGeminiKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, GEMINI_KEY_FIELDS)
      )
    ),

  updateGeminiKey: (
    apiKey: string,
    baseUrl: string | undefined,
    config: GeminiKeyConfig,
    snapshot: GeminiKeyConfig
  ) =>
    mutateLatestProviderList(
      'gemini-api-key',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record) => matchesProviderKey(record, apiKey, baseUrl),
          serializeGeminiKey(config),
          (raw, payload) => mergeProviderKeyPayload(raw, payload, GEMINI_KEY_FIELDS)
        ),
      providerKeySnapshotGuard('gemini-api-key', apiKey, baseUrl, snapshot)
    ),

  deleteGeminiKey: (apiKey: string, baseUrl: string | undefined, snapshot: GeminiKeyConfig) =>
    deleteProviderKey('gemini-api-key', apiKey, baseUrl, snapshot),

  createInteractionsKey: (config: GeminiKeyConfig) =>
    mutateLatestProviderList('interactions-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeGeminiKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, INTERACTIONS_KEY_FIELDS)
      )
    ),

  updateInteractionsKey: (
    apiKey: string,
    baseUrl: string | undefined,
    config: GeminiKeyConfig,
    snapshot: GeminiKeyConfig
  ) =>
    mutateLatestProviderList(
      'interactions-api-key',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record) => matchesProviderKey(record, apiKey, baseUrl),
          serializeGeminiKey(config),
          (raw, payload) => mergeProviderKeyPayload(raw, payload, INTERACTIONS_KEY_FIELDS)
        ),
      providerKeySnapshotGuard('interactions-api-key', apiKey, baseUrl, snapshot)
    ),

  deleteInteractionsKey: (apiKey: string, baseUrl: string | undefined, snapshot: GeminiKeyConfig) =>
    deleteProviderKey('interactions-api-key', apiKey, baseUrl, snapshot),

  async getCodexConfigs(): Promise<ProviderKeyConfig[]> {
    const data = await apiClient.get('/codex-api-key');
    const list = extractArrayPayload(data, 'codex-api-key');
    return list
      .map((item) => normalizeProviderKeyConfig(item))
      .filter(Boolean) as ProviderKeyConfig[];
  },

  saveCodexConfigs: async (configs: ProviderKeyConfig[], baseline: ProviderKeyConfig[]) =>
    savePreservedList(
      'codex-api-key',
      configs,
      baseline,
      serializeProviderKey,
      (raw, payload) => mergeProviderKeyPayload(raw, payload, CODEX_KEY_FIELDS),
      providerKeyIdentity
    ),

  createCodexConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('codex-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeProviderKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, CODEX_KEY_FIELDS)
      )
    ),

  updateCodexConfig: (
    apiKey: string,
    baseUrl: string | undefined,
    config: ProviderKeyConfig,
    snapshot: ProviderKeyConfig
  ) =>
    mutateLatestProviderList(
      'codex-api-key',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record) => matchesProviderKey(record, apiKey, baseUrl),
          serializeProviderKey(config),
          (raw, payload) => mergeProviderKeyPayload(raw, payload, CODEX_KEY_FIELDS)
        ),
      providerKeySnapshotGuard('codex-api-key', apiKey, baseUrl, snapshot)
    ),

  deleteCodexConfig: (apiKey: string, baseUrl: string | undefined, snapshot: ProviderKeyConfig) =>
    deleteProviderKey('codex-api-key', apiKey, baseUrl, snapshot),

  async getXAIConfigs(): Promise<ProviderKeyConfig[]> {
    const data = await apiClient.get('/xai-api-key');
    const list = extractArrayPayload(data, 'xai-api-key');
    return list
      .map((item) => normalizeProviderKeyConfig(item))
      .filter(Boolean) as ProviderKeyConfig[];
  },

  saveXAIConfigs: async (configs: ProviderKeyConfig[], baseline: ProviderKeyConfig[]) =>
    savePreservedList(
      'xai-api-key',
      configs,
      baseline,
      serializeProviderKey,
      (raw, payload) => mergeProviderKeyPayload(raw, payload, XAI_KEY_FIELDS),
      providerKeyIdentity
    ),

  createXAIConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('xai-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeProviderKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, XAI_KEY_FIELDS)
      )
    ),

  updateXAIConfig: (
    apiKey: string,
    baseUrl: string | undefined,
    config: ProviderKeyConfig,
    snapshot: ProviderKeyConfig
  ) =>
    mutateLatestProviderList(
      'xai-api-key',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record) => matchesProviderKey(record, apiKey, baseUrl),
          serializeProviderKey(config),
          (raw, payload) => mergeProviderKeyPayload(raw, payload, XAI_KEY_FIELDS)
        ),
      providerKeySnapshotGuard('xai-api-key', apiKey, baseUrl, snapshot)
    ),

  deleteXAIConfig: (apiKey: string, baseUrl: string | undefined, snapshot: ProviderKeyConfig) =>
    deleteProviderKey('xai-api-key', apiKey, baseUrl, snapshot),

  async getClaudeConfigs(): Promise<ProviderKeyConfig[]> {
    const data = await apiClient.get('/claude-api-key');
    const list = extractArrayPayload(data, 'claude-api-key');
    return list
      .map((item) => normalizeProviderKeyConfig(item))
      .filter(Boolean) as ProviderKeyConfig[];
  },

  saveClaudeConfigs: async (configs: ProviderKeyConfig[], baseline: ProviderKeyConfig[]) =>
    savePreservedList(
      'claude-api-key',
      configs,
      baseline,
      serializeProviderKey,
      (raw, payload) => mergeProviderKeyPayload(raw, payload, CLAUDE_KEY_FIELDS),
      providerKeyIdentity
    ),

  createClaudeConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('claude-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeProviderKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, CLAUDE_KEY_FIELDS)
      )
    ),

  updateClaudeConfig: (
    apiKey: string,
    baseUrl: string | undefined,
    config: ProviderKeyConfig,
    snapshot: ProviderKeyConfig
  ) =>
    mutateLatestProviderList(
      'claude-api-key',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record) => matchesProviderKey(record, apiKey, baseUrl),
          serializeProviderKey(config),
          (raw, payload) => mergeProviderKeyPayload(raw, payload, CLAUDE_KEY_FIELDS)
        ),
      providerKeySnapshotGuard('claude-api-key', apiKey, baseUrl, snapshot)
    ),

  deleteClaudeConfig: (apiKey: string, baseUrl: string | undefined, snapshot: ProviderKeyConfig) =>
    deleteProviderKey('claude-api-key', apiKey, baseUrl, snapshot),

  async getVertexConfigs(): Promise<ProviderKeyConfig[]> {
    const data = await apiClient.get('/vertex-api-key');
    const list = extractArrayPayload(data, 'vertex-api-key');
    return list
      .map((item) => normalizeProviderKeyConfig(item))
      .filter(Boolean) as ProviderKeyConfig[];
  },

  saveVertexConfigs: async (configs: ProviderKeyConfig[], baseline: ProviderKeyConfig[]) =>
    savePreservedList(
      'vertex-api-key',
      configs,
      baseline,
      serializeVertexKey,
      (raw, payload) => mergeProviderKeyPayload(raw, payload, VERTEX_KEY_FIELDS),
      providerKeyIdentity
    ),

  createVertexConfig: (config: ProviderKeyConfig) =>
    mutateLatestProviderList('vertex-api-key', (latestItems) =>
      appendLatestProviderRecord(latestItems, serializeVertexKey(config), (raw, payload) =>
        mergeProviderKeyPayload(raw, payload, VERTEX_KEY_FIELDS)
      )
    ),

  updateVertexConfig: (
    apiKey: string,
    baseUrl: string | undefined,
    config: ProviderKeyConfig,
    snapshot: ProviderKeyConfig
  ) =>
    mutateLatestProviderList(
      'vertex-api-key',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record) => matchesProviderKey(record, apiKey, baseUrl),
          serializeVertexKey(config),
          (raw, payload) => mergeProviderKeyPayload(raw, payload, VERTEX_KEY_FIELDS)
        ),
      providerKeySnapshotGuard('vertex-api-key', apiKey, baseUrl, snapshot)
    ),

  deleteVertexConfig: (apiKey: string, baseUrl: string | undefined, snapshot: ProviderKeyConfig) =>
    deleteProviderKey('vertex-api-key', apiKey, baseUrl, snapshot),

  async getOpenAIProviders(): Promise<OpenAIProviderConfig[]> {
    const data = await apiClient.get('/openai-compatibility');
    const list = extractArrayPayload(data, 'openai-compatibility');
    return list
      .map((item, index) => normalizeOpenAIProvider(item, index))
      .filter(Boolean) as OpenAIProviderConfig[];
  },

  saveOpenAIProviders: async (
    providers: OpenAIProviderConfig[],
    baseline: OpenAIProviderConfig[]
  ) =>
    savePreservedList(
      'openai-compatibility',
      providers,
      baseline,
      serializeOpenAIProvider,
      mergeOpenAIProviderPayload,
      openAIProviderIdentity
    ),

  createOpenAIProvider: (provider: OpenAIProviderConfig) =>
    mutateLatestProviderList('openai-compatibility', (latestItems) =>
      appendLatestProviderRecord(
        latestItems,
        serializeOpenAIProvider(provider),
        mergeOpenAIProviderPayload
      )
    ),

  updateOpenAIProvider: (
    name: string,
    index: number,
    provider: OpenAIProviderConfig,
    snapshot: OpenAIProviderConfig
  ) =>
    mutateLatestProviderList(
      'openai-compatibility',
      (latestItems) =>
        replaceLatestProviderRecord(
          latestItems,
          (record, currentIndex) => currentIndex === index && matchesOpenAIProvider(record, name),
          serializeOpenAIProvider(provider),
          mergeOpenAIProviderPayload
        ),
      openAIProviderSnapshotGuard(index, snapshot)
    ),

  updateOpenAIProviderDisabled: (
    index: number,
    disabled: boolean,
    snapshot: OpenAIProviderConfig
  ) => {
    const validateSnapshot = openAIProviderSnapshotGuard(index, snapshot);
    const name = snapshot.name;
    return mutateProviderConfig(
      'openai-compatibility',
      (items) =>
        stripResponseOnlyProviderFields(
          items.map((item, current) =>
            current === index ? { ...(item as Record<string, unknown>), disabled } : item
          )
        ),
      () => apiClient.patch('/openai-compatibility', { name, value: { disabled } }),
      validateSnapshot
    );
  },

  deleteOpenAIProvider: (index: number, snapshot: OpenAIProviderConfig) => {
    const validateSnapshot = openAIProviderSnapshotGuard(index, snapshot);
    const name = snapshot.name;
    return mutateProviderConfig(
      'openai-compatibility',
      (items) => stripResponseOnlyProviderFields(items.filter((_, current) => current !== index)),
      () => apiClient.delete(`/openai-compatibility?name=${encodeURIComponent(name)}`),
      validateSnapshot
    );
  },
};
