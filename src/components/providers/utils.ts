import type {
  AmpcodeConfig,
  AmpcodeModelMapping,
  AmpcodeUpstreamApiKeyMapping,
  ApiKeyEntry,
  OpenAIProviderConfig,
} from '@/types';
import {
  buildCandidateUsageSourceIds,
  normalizeAuthIndex,
  type KeyStatBucket,
  type KeyStats,
  type UsageDetail,
} from '@/utils/usage';
import {
  collectUsageDetailsForAuthIndices,
  collectUsageDetailsForCandidates,
  type UsageDetailsByAuthIndex,
  type UsageDetailsBySource,
} from '@/utils/usageIndex';
import {
  buildRecentRequestCompositeKey,
  mergeRecentRequestBucketGroups,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type RecentRequestBucket,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';
import type { AmpcodeFormState, AmpcodeUpstreamApiKeyEntry, ModelEntry } from './types';

export const DISABLE_ALL_MODELS_RULE = '*';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

export const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

export const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

export const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

export const withoutDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return base;
};

export const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const parseExcludedModels = parseTextList;

export const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

export const normalizeOpenAIBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const normalizeClaudeBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return 'https://api.anthropic.com';
  }
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const buildOpenAIModelsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  return `${trimmed}/models`;
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const buildCodexResponsesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (/\/v1\/responses$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1\/models$/i.test(trimmed)) {
    return trimmed.replace(/\/models$/i, '/responses');
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/responses`;
  }
  return `${trimmed}/v1/responses`;
};

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeClaudeBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

const buildGeminiModelResource = (model: string): string => {
  const trimmed = String(model || '')
    .trim()
    .replace(/^\/+/g, '')
    .replace(/:generateContent$/i, '');
  if (!trimmed) return '';

  if (/^(models|tunedModels)\//i.test(trimmed)) {
    return trimmed.split('/').map(encodeURIComponent).join('/');
  }

  return `models/${encodeURIComponent(trimmed)}`;
};

export const buildGeminiGenerateContentEndpoint = (
  baseUrl: string,
  model: string
): string => {
  const resource = buildGeminiModelResource(model);
  if (!resource) return '';

  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    trimmed = DEFAULT_GEMINI_BASE_URL;
  }
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '').replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  if (/:generateContent$/i.test(trimmed)) {
    return trimmed;
  }

  let root = trimmed.replace(/\/+$/g, '');
  if (/\/v1beta\/models$/i.test(root)) {
    root = root.replace(/\/models$/i, '');
  } else if (!/\/v1beta$/i.test(root)) {
    root = root.replace(/\/v1beta(?:\/.*)?$/i, '');
    root = `${root}/v1beta`;
  }

  return `${root}/${resource}:generateContent`;
};

export type ProviderRecentUsageMap = Map<string, Map<string, RecentRequestUsageEntry>>;

const EMPTY_RECENT_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
};

const normalizeProviderRecentKey = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

const getProviderRecentUsageEntry = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestUsageEntry => {
  if (!String(apiKey ?? '').trim()) {
    return EMPTY_RECENT_USAGE_ENTRY;
  }

  const providerKey = normalizeProviderRecentKey(provider);
  const compositeKey = buildRecentRequestCompositeKey(baseUrl, apiKey);
  return usageByProvider.get(providerKey)?.get(compositeKey) ?? EMPTY_RECENT_USAGE_ENTRY;
};

const getProviderRecentBuckets = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestBucket[] =>
  getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl).recentRequests;

export function getProviderRecentStatusData(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): StatusBarData {
  return statusBarDataFromRecentRequests(
    getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl)
  );
}

export function getProviderTotalStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl);
  return { success: entry.success, failure: entry.failed };
}

export function getProviderRecentWindowStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return sumRecentRequests(getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl));
}

const collectOpenAIProviderRecentBuckets = (
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] => {
  if (!provider.apiKeyEntries?.length) {
    return [];
  }

  const groups = provider.apiKeyEntries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
};

export function getOpenAIProviderRecentWindowStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return sumRecentRequests(collectOpenAIProviderRecentBuckets(provider, usageByProvider));
}

export function getOpenAIProviderTotalStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return (provider.apiKeyEntries || []).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider.name,
        entry.apiKey,
        provider.baseUrl
      );
      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getOpenAIProviderRecentStatusData(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectOpenAIProviderRecentBuckets(provider, usageByProvider)
  );
}

// 根据 source (apiKey) 获取统计数据 - 与旧版逻辑一致
export const getStatsBySource = (
  apiKey: string,
  keyStats: KeyStats,
  prefix?: string
): KeyStatBucket => {
  const bySource = keyStats.bySource ?? {};
  const candidates = buildCandidateUsageSourceIds({ apiKey, prefix });
  if (!candidates.length) {
    return { success: 0, failure: 0 };
  }

  let success = 0;
  let failure = 0;
  candidates.forEach((candidate) => {
    const stats = bySource[candidate];
    if (!stats) return;
    success += stats.success;
    failure += stats.failure;
  });

  return { success, failure };
};

type UsageIdentity = {
  authIndex?: unknown;
  apiKey?: string;
  prefix?: string;
};

export const getStatsForIdentity = (
  identity: UsageIdentity,
  keyStats: KeyStats
): KeyStatBucket => {
  const authIndexKey = normalizeAuthIndex(identity.authIndex);
  if (authIndexKey) {
    const stats = keyStats.byAuthIndex?.[authIndexKey];
    if (stats) {
      return { success: stats.success, failure: stats.failure };
    }
  }

  return getStatsBySource(identity.apiKey ?? '', keyStats, identity.prefix);
};

export const collectUsageDetailsForIdentity = (
  identity: UsageIdentity,
  usageDetailsBySource: UsageDetailsBySource,
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex
): UsageDetail[] => {
  const authIndexKey = normalizeAuthIndex(identity.authIndex);
  if (authIndexKey) {
    const details = collectUsageDetailsForAuthIndices(usageDetailsByAuthIndex, [authIndexKey]);
    if (details.length > 0) {
      return details;
    }
  }

  const candidates = buildCandidateUsageSourceIds({
    apiKey: identity.apiKey,
    prefix: identity.prefix,
  });
  if (!candidates.length) {
    return [];
  }

  return collectUsageDetailsForCandidates(usageDetailsBySource, candidates);
};

const mergeUsageDetails = (groups: UsageDetail[][]): UsageDetail[] => {
  let firstDetails: UsageDetail[] | null = null;
  let merged: UsageDetail[] | null = null;

  groups.forEach((details) => {
    if (!details.length) return;
    if (!firstDetails) {
      firstDetails = details;
      return;
    }
    if (!merged) {
      merged = [...firstDetails];
    }
    merged.push(...details);
  });

  return merged ?? firstDetails ?? [];
};

// 对于 OpenAI 提供商，汇总所有 apiKeyEntries 的统计 - 与旧版逻辑一致
export const getOpenAIProviderStats = (
  provider: OpenAIProviderConfig,
  keyStats: KeyStats
): KeyStatBucket => {
  let success = 0;
  let failure = 0;

  if (!provider.apiKeyEntries?.length) {
    const stats = getStatsForIdentity(
      { authIndex: provider.authIndex, prefix: provider.prefix },
      keyStats
    );
    return { success: stats.success, failure: stats.failure };
  }

  if (!normalizeAuthIndex(provider.authIndex) && provider.prefix) {
    const prefixStats = getStatsBySource('', keyStats, provider.prefix);
    success += prefixStats.success;
    failure += prefixStats.failure;
  }

  provider.apiKeyEntries.forEach((entry) => {
    const stats = getStatsForIdentity({ authIndex: entry.authIndex, apiKey: entry.apiKey }, keyStats);
    success += stats.success;
    failure += stats.failure;
  });

  return { success, failure };
};

export const collectOpenAIProviderUsageDetails = (
  provider: OpenAIProviderConfig,
  usageDetailsBySource: UsageDetailsBySource,
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex
): UsageDetail[] => {
  if (!provider.apiKeyEntries?.length) {
    return collectUsageDetailsForIdentity(
      { authIndex: provider.authIndex, prefix: provider.prefix },
      usageDetailsBySource,
      usageDetailsByAuthIndex
    );
  }

  const groups: UsageDetail[][] = [];
  if (!normalizeAuthIndex(provider.authIndex) && provider.prefix) {
    groups.push(
      collectUsageDetailsForIdentity(
        { prefix: provider.prefix },
        usageDetailsBySource,
        usageDetailsByAuthIndex
      )
    );
  }

  provider.apiKeyEntries.forEach((entry) => {
    groups.push(
      collectUsageDetailsForIdentity(
        { authIndex: entry.authIndex, apiKey: entry.apiKey },
        usageDetailsBySource,
        usageDetailsByAuthIndex
      )
    );
  });

  return mergeUsageDetails(groups);
};

export const getProviderConfigKey = (
  config: {
    authIndex?: unknown;
    apiKey?: string;
    baseUrl?: string;
    proxyUrl?: string;
  },
  index: number
): string => {
  const authIndexKey = normalizeAuthIndex(config.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${config.apiKey ?? ''}::${config.baseUrl ?? ''}::${config.proxyUrl ?? ''}::${index}`;
};

export const getOpenAIProviderKey = (provider: OpenAIProviderConfig, index: number): string => {
  const authIndexKey = normalizeAuthIndex(provider.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${provider.name}::${provider.baseUrl}::${provider.prefix ?? ''}::${index}`;
};

export const getOpenAIEntryKey = (entry: ApiKeyEntry, index: number): string => {
  const authIndexKey = normalizeAuthIndex(entry.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${entry.apiKey}::${entry.proxyUrl ?? ''}::${index}`;
};

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
  apiKey: input?.apiKey ?? '',
  proxyUrl: input?.proxyUrl ?? '',
  headers: input?.headers ?? {},
});

export const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return mappings.map((mapping) => ({
    name: mapping.from ?? '',
    alias: mapping.to ?? '',
  }));
};

export const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeModelMapping[] = [];

  entries.forEach((entry) => {
    const from = entry.name.trim();
    const to = entry.alias.trim();
    if (!from || !to) return;
    const key = from.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push({ from, to });
  });

  return mappings;
};

export const ampcodeUpstreamApiKeysToEntries = (
  mappings?: AmpcodeUpstreamApiKeyMapping[]
): AmpcodeUpstreamApiKeyEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ upstreamApiKey: '', clientApiKeysText: '' }];
  }

  return mappings.map((mapping) => ({
    upstreamApiKey: mapping.upstreamApiKey ?? '',
    clientApiKeysText: Array.isArray(mapping.apiKeys) ? mapping.apiKeys.join('\n') : '',
  }));
};

export const entriesToAmpcodeUpstreamApiKeys = (
  entries: AmpcodeUpstreamApiKeyEntry[]
): AmpcodeUpstreamApiKeyMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeUpstreamApiKeyMapping[] = [];

  entries.forEach((entry) => {
    const upstreamApiKey = String(entry?.upstreamApiKey ?? '').trim();
    if (!upstreamApiKey || seen.has(upstreamApiKey)) return;

    const apiKeys = Array.from(new Set(parseTextList(String(entry?.clientApiKeysText ?? ''))));
    if (!apiKeys.length) return;

    seen.add(upstreamApiKey);
    mappings.push({ upstreamApiKey, apiKeys });
  });

  return mappings;
};

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
  upstreamUrl: ampcode?.upstreamUrl ?? '',
  upstreamApiKey: '',
  forceModelMappings: ampcode?.forceModelMappings ?? false,
  mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
  upstreamApiKeyEntries: ampcodeUpstreamApiKeysToEntries(ampcode?.upstreamApiKeys),
});
