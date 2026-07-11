export type UsageImportPreflightIssue =
  | 'payload_not_object'
  | 'missing_usage'
  | 'unsupported_version'
  | 'invalid_usage_apis';

export interface UsageImportPreflightResult {
  valid: boolean;
  version: number | null;
  detailCount: number;
  currentDetailCount: number;
  currentUsageAvailable: boolean;
  legacyCacheAliasCount: number;
  canonicalCacheWriteCount: number;
  duplicateCount: number;
  overlapCount: number;
  issues: UsageImportPreflightIssue[];
}

type UnknownRecord = Record<string, unknown>;

interface UsageDetailEntry {
  apiName: string;
  modelName: string;
  detail: UnknownRecord;
}

interface NumericField {
  present: boolean;
  value: number;
}

interface CanonicalCacheIdentity {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  legacyCreationAlias: boolean;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const toFiniteNumber = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
};

const readNumericField = (value: UnknownRecord, keys: readonly string[]): NumericField => {
  for (const key of keys) {
    if (!hasOwn(value, key)) continue;
    return { present: true, value: toFiniteNumber(value[key]) };
  }
  return { present: false, value: 0 };
};

const readText = (value: UnknownRecord, keys: readonly string[]): string => {
  for (const key of keys) {
    const candidate = value[key];
    if (candidate === null || candidate === undefined) continue;
    return String(candidate).trim();
  }
  return '';
};

const readBoolean = (value: UnknownRecord, keys: readonly string[]): boolean => {
  for (const key of keys) {
    if (!hasOwn(value, key)) continue;
    return value[key] === true;
  }
  return false;
};

const collectUsageDetailEntries = (snapshot: UnknownRecord): UsageDetailEntry[] => {
  const apis = isRecord(snapshot.apis) ? snapshot.apis : null;
  if (!apis) return [];

  const entries: UsageDetailEntry[] = [];
  Object.entries(apis).forEach(([apiName, apiValue]) => {
    if (!isRecord(apiValue) || !isRecord(apiValue.models)) return;
    Object.entries(apiValue.models).forEach(([modelName, modelValue]) => {
      if (!isRecord(modelValue) || !Array.isArray(modelValue.details)) return;
      modelValue.details.forEach((detail) => {
        if (!isRecord(detail)) return;
        entries.push({ apiName: apiName.trim(), modelName: modelName.trim(), detail });
      });
    });
  });
  return entries;
};

const resolveCanonicalCacheIdentity = (tokens: UnknownRecord): CanonicalCacheIdentity => {
  const explicitRead = readNumericField(tokens, [
    'cache_read_tokens',
    'cacheReadTokens',
    'CacheReadTokens',
  ]);
  const cachedAlias = readNumericField(tokens, [
    'cached_tokens',
    'cache_tokens',
    'cachedTokens',
    'CachedTokens',
  ]);
  const cacheWrite = readNumericField(tokens, [
    'cache_creation_tokens',
    'cache_write_tokens',
    'cacheCreationTokens',
    'cacheWriteTokens',
    'CacheCreationTokens',
  ]);

  const legacyCreationAlias =
    cacheWrite.value > 0 &&
    (!explicitRead.present || explicitRead.value === 0) &&
    cachedAlias.present &&
    cachedAlias.value === cacheWrite.value;

  const cacheReadTokens = explicitRead.present
    ? explicitRead.value
    : legacyCreationAlias
      ? 0
      : cachedAlias.value;

  return {
    cacheReadTokens,
    cacheWriteTokens: cacheWrite.value,
    legacyCreationAlias,
  };
};

const buildCanonicalDetailIdentity = (entry: UsageDetailEntry): string => {
  const { detail } = entry;
  const tokens = isRecord(detail.tokens) ? detail.tokens : {};
  const cache = resolveCanonicalCacheIdentity(tokens);
  const input = readNumericField(tokens, ['input_tokens', 'inputTokens', 'InputTokens']);
  const output = readNumericField(tokens, ['output_tokens', 'outputTokens', 'OutputTokens']);
  const reasoning = readNumericField(tokens, [
    'reasoning_tokens',
    'reasoningTokens',
    'ReasoningTokens',
  ]);
  const total = readNumericField(tokens, ['total_tokens', 'totalTokens', 'TotalTokens']);
  const hasBreakdown =
    input.present ||
    output.present ||
    reasoning.present ||
    cache.cacheReadTokens > 0 ||
    cache.cacheWriteTokens > 0;

  return JSON.stringify([
    entry.apiName,
    entry.modelName,
    readText(detail, ['timestamp', 'Timestamp']),
    readText(detail, ['source', 'Source']),
    readText(detail, ['auth_index', 'authIndex', 'AuthIndex']),
    readBoolean(detail, ['failed', 'Failed']),
    readText(detail, ['failure_reason', 'failureReason', 'FailureReason']),
    readNumericField(detail, ['failure_status', 'failureStatus', 'FailureStatus']).value,
    input.value,
    output.value,
    reasoning.value,
    cache.cacheReadTokens,
    cache.cacheWriteTokens,
    hasBreakdown ? null : total.value,
  ]);
};

const resolveCurrentSnapshot = (value: unknown): UnknownRecord | null => {
  if (!isRecord(value)) return null;
  if (isRecord(value.usage)) return value.usage;
  return value;
};

export function analyzeUsageImport(
  payload: unknown,
  currentUsage: unknown = null
): UsageImportPreflightResult {
  const issues: UsageImportPreflightIssue[] = [];
  const payloadRecord = isRecord(payload) ? payload : null;
  if (!payloadRecord) {
    issues.push('payload_not_object');
  }

  const rawVersion = payloadRecord?.version;
  const version =
    rawVersion === undefined
      ? 0
      : typeof rawVersion === 'number' && Number.isInteger(rawVersion)
        ? rawVersion
        : null;
  if (version === null || (version !== 0 && version !== 1)) {
    issues.push('unsupported_version');
  }

  const usageSnapshot = payloadRecord && isRecord(payloadRecord.usage) ? payloadRecord.usage : null;
  if (!usageSnapshot) {
    issues.push('missing_usage');
  } else if (!isRecord(usageSnapshot.apis)) {
    issues.push('invalid_usage_apis');
  }

  const importedEntries = usageSnapshot ? collectUsageDetailEntries(usageSnapshot) : [];
  const currentSnapshot = resolveCurrentSnapshot(currentUsage);
  const currentUsageAvailable = Boolean(currentSnapshot && isRecord(currentSnapshot.apis));
  const currentEntries = currentSnapshot ? collectUsageDetailEntries(currentSnapshot) : [];

  let legacyCacheAliasCount = 0;
  let canonicalCacheWriteCount = 0;
  const importedIdentityCounts = new Map<string, number>();

  importedEntries.forEach((entry) => {
    const tokens = isRecord(entry.detail.tokens) ? entry.detail.tokens : {};
    const cache = resolveCanonicalCacheIdentity(tokens);
    if (cache.legacyCreationAlias) {
      legacyCacheAliasCount += 1;
    } else if (cache.cacheWriteTokens > 0) {
      canonicalCacheWriteCount += 1;
    }

    const identity = buildCanonicalDetailIdentity(entry);
    importedIdentityCounts.set(identity, (importedIdentityCounts.get(identity) ?? 0) + 1);
  });

  let duplicateCount = 0;
  importedIdentityCounts.forEach((count) => {
    if (count > 1) duplicateCount += count - 1;
  });

  const currentIdentities = new Set(currentEntries.map(buildCanonicalDetailIdentity));
  let overlapCount = 0;
  importedIdentityCounts.forEach((_count, identity) => {
    if (currentIdentities.has(identity)) overlapCount += 1;
  });

  return {
    valid: issues.length === 0,
    version,
    detailCount: importedEntries.length,
    currentDetailCount: currentEntries.length,
    currentUsageAvailable,
    legacyCacheAliasCount,
    canonicalCacheWriteCount,
    duplicateCount,
    overlapCount,
    issues,
  };
}
