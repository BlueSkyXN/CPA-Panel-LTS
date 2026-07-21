export type UsageImportPreflightIssue =
  | 'payload_not_object'
  | 'missing_usage'
  | 'unsupported_version'
  | 'invalid_usage_apis'
  | 'unsupported_legacy_token_contract';

export interface UsageImportPreflightResult {
  valid: boolean;
  version: number | null;
  detailCount: number;
  currentDetailCount: number;
  currentUsageAvailable: boolean;
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

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const toFiniteNumber = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
};

const readCanonicalNumericField = (value: UnknownRecord, key: string): NumericField => {
  if (!hasOwn(value, key)) return { present: false, value: 0 };
  return { present: true, value: toFiniteNumber(value[key]) };
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

const buildCanonicalDetailIdentity = (entry: UsageDetailEntry): string => {
  const { detail } = entry;
  const tokens = isRecord(detail.tokens) ? detail.tokens : {};
  const tokenIdentity = [
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cached_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'total_tokens',
  ].map((key) => {
    const field = readCanonicalNumericField(tokens, key);
    return [field.present, field.value];
  });

  return JSON.stringify([
    entry.apiName,
    entry.modelName,
    readText(detail, ['timestamp']),
    readText(detail, ['source']),
    readText(detail, ['auth_index']),
    readBoolean(detail, ['failed']),
    readText(detail, ['failure_reason']),
    readCanonicalNumericField(detail, 'failure_status').value,
    tokenIdentity,
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
  if (
    importedEntries.some((entry) => {
      const tokens = isRecord(entry.detail.tokens) ? entry.detail.tokens : {};
      return hasOwn(tokens, 'uncached_input_tokens');
    })
  ) {
    issues.push('unsupported_legacy_token_contract');
    return {
      valid: false,
      version,
      detailCount: importedEntries.length,
      currentDetailCount: 0,
      currentUsageAvailable: false,
      duplicateCount: 0,
      overlapCount: 0,
      issues,
    };
  }

  const currentSnapshot = resolveCurrentSnapshot(currentUsage);
  const currentUsageAvailable = Boolean(currentSnapshot && isRecord(currentSnapshot.apis));
  const currentEntries = currentSnapshot ? collectUsageDetailEntries(currentSnapshot) : [];

  const importedIdentityCounts = new Map<string, number>();

  importedEntries.forEach((entry) => {
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
    duplicateCount,
    overlapCount,
    issues,
  };
}
