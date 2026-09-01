export type UsageImportPreflightIssue =
  | 'usage_version_unsupported'
  | 'usage_shape_invalid'
  | 'usage_v1_token_contract_invalid'
  | 'usage_v1_cache_semantics_ambiguous'
  | 'usage_v2_token_contract_invalid'
  | 'usage_aggregate_overflow';

export interface UsageImportPreflightResult {
  valid: boolean;
  version: number | null;
  detailCount: number;
  currentDetailCount: number;
  currentUsageAvailable: boolean;
  duplicateCount: number;
  overlapCount: number;
  uncertainIdentityCount: number;
  issues: UsageImportPreflightIssue[];
}

type UnknownRecord = Record<string, unknown>;

interface CanonicalTokenCounts {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

interface UsageDetailEntry {
  apiName: string;
  modelName: string;
  detail: UnknownRecord;
  tokens: CanonicalTokenCounts;
  timestampIdentity: string | null;
}

interface CollectedEntries {
  entries: UsageDetailEntry[];
  issue: UsageImportPreflightIssue | null;
}

const REQUIRED_TOKEN_FIELDS = [
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'cached_tokens',
  'total_tokens',
] as const;

const OPTIONAL_TOKEN_FIELDS = ['cache_read_tokens', 'cache_creation_tokens'] as const;

const V1_REQUIRED_TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'total_tokens'] as const;

const V1_OPTIONAL_TOKEN_FIELDS = [
  'reasoning_tokens',
  'cached_tokens',
  ...OPTIONAL_TOKEN_FIELDS,
] as const;

const SNAPSHOT_INTEGER_FIELDS = [
  'total_requests',
  'success_count',
  'failure_count',
  'total_tokens',
] as const;

const AGGREGATE_MAP_FIELDS = [
  'requests_by_day',
  'requests_by_hour',
  'tokens_by_day',
  'tokens_by_hour',
] as const;

const DETAIL_STRING_FIELDS = [
  'source',
  'auth_index',
  'alias',
  'reasoning_effort',
  'service_tier',
  'request_service_tier',
  'outbound_service_tier',
  'response_service_tier',
  'effective_service_tier',
  'failure_reason',
] as const;

const DETAIL_INTEGER_FIELDS = ['latency_ms', 'ttfb_ms', 'failure_status'] as const;
const DETAIL_BOOLEAN_FIELDS = ['failed', 'generate'] as const;

const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && value >= 0;

const readNonNegativeSafeInteger = (value: UnknownRecord, key: string): number | null => {
  const candidate = value[key];
  return isNonNegativeSafeInteger(candidate) ? candidate : null;
};

const validateOptionalIntegerFields = (
  value: UnknownRecord,
  keys: readonly string[],
  options: { nonNegative?: boolean } = {}
): boolean =>
  keys.every((key) => {
    if (!hasOwn(value, key)) return true;
    return options.nonNegative ? isNonNegativeSafeInteger(value[key]) : isSafeInteger(value[key]);
  });

const validateOptionalFields = (
  value: UnknownRecord,
  keys: readonly string[],
  predicate: (candidate: unknown) => boolean
): boolean => keys.every((key) => !hasOwn(value, key) || predicate(value[key]));

const validateAggregateMap = (value: unknown): boolean =>
  isRecord(value) && Object.values(value).every(isSafeInteger);

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const canonicalizeRFC3339Timestamp = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const offsetHour = match[10] ? Number(match[10]) : 0;
  const offsetMinute = match[11] ? Number(match[11]) : 0;
  if (offsetHour > 23 || offsetMinute > 59) return null;

  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, 0);
  if (match[8] !== 'Z') {
    const offset = (offsetHour * 60 + offsetMinute) * 60_000;
    utc.setTime(utc.getTime() + (match[9] === '+' ? -offset : offset));
  }
  if (!Number.isFinite(utc.getTime())) return null;

  const fractionalDigits = (match[7] ?? '').slice(1, 10).replace(/0+$/, '');
  const fraction = fractionalDigits ? `.${fractionalDigits}` : '';
  return `${utc.toISOString().slice(0, 19)}${fraction}Z`;
};

const validateSnapshotMetadata = (snapshot: UnknownRecord): boolean => {
  if (!validateOptionalIntegerFields(snapshot, SNAPSHOT_INTEGER_FIELDS, { nonNegative: true })) {
    return false;
  }
  return AGGREGATE_MAP_FIELDS.every(
    (key) => !hasOwn(snapshot, key) || validateAggregateMap(snapshot[key])
  );
};

const validateDetailMetadata = (detail: UnknownRecord): boolean =>
  validateOptionalFields(detail, DETAIL_STRING_FIELDS, (value) => typeof value === 'string') &&
  validateOptionalIntegerFields(detail, DETAIL_INTEGER_FIELDS) &&
  validateOptionalFields(detail, DETAIL_BOOLEAN_FIELDS, (value) => typeof value === 'boolean');

const validLegacyTokenStats = (tokens: CanonicalTokenCounts): boolean => {
  const values = Object.values(tokens);
  if (!values.every(isNonNegativeSafeInteger)) return false;
  return tokens.totalTokens !== 0 || values.every((value) => value === 0);
};

const validCanonicalTokenStats = (tokens: CanonicalTokenCounts): boolean => {
  if (!validLegacyTokenStats(tokens) || tokens.cachedTokens !== tokens.cacheReadTokens) {
    return false;
  }
  const cacheInputTokens = tokens.cacheReadTokens + tokens.cacheCreationTokens;
  const minimumTotalTokens = tokens.inputTokens + tokens.outputTokens;
  return (
    Number.isSafeInteger(cacheInputTokens) &&
    cacheInputTokens <= tokens.inputTokens &&
    Number.isSafeInteger(minimumTotalTokens) &&
    minimumTotalTokens <= tokens.totalTokens
  );
};

const readTokenCounts = (
  value: UnknownRecord,
  version: 1 | 2
): { tokens: CanonicalTokenCounts | null; issue: UsageImportPreflightIssue | null } => {
  const invalidCode: UsageImportPreflightIssue =
    version === 1 ? 'usage_v1_token_contract_invalid' : 'usage_v2_token_contract_invalid';

  const requiredFields = version === 1 ? V1_REQUIRED_TOKEN_FIELDS : REQUIRED_TOKEN_FIELDS;
  const optionalFields = version === 1 ? V1_OPTIONAL_TOKEN_FIELDS : OPTIONAL_TOKEN_FIELDS;

  for (const key of requiredFields) {
    if (!hasOwn(value, key) || !isNonNegativeSafeInteger(value[key])) {
      return { tokens: null, issue: invalidCode };
    }
  }
  for (const key of optionalFields) {
    if (hasOwn(value, key) && !isNonNegativeSafeInteger(value[key])) {
      return { tokens: null, issue: invalidCode };
    }
  }

  const tokens: CanonicalTokenCounts = {
    inputTokens: readNonNegativeSafeInteger(value, 'input_tokens') ?? 0,
    outputTokens: readNonNegativeSafeInteger(value, 'output_tokens') ?? 0,
    reasoningTokens: readNonNegativeSafeInteger(value, 'reasoning_tokens') ?? 0,
    cachedTokens: readNonNegativeSafeInteger(value, 'cached_tokens') ?? 0,
    cacheReadTokens: readNonNegativeSafeInteger(value, 'cache_read_tokens') ?? 0,
    cacheCreationTokens: readNonNegativeSafeInteger(value, 'cache_creation_tokens') ?? 0,
    totalTokens: readNonNegativeSafeInteger(value, 'total_tokens') ?? 0,
  };

  if (!validLegacyTokenStats(tokens)) return { tokens: null, issue: invalidCode };

  if (version === 2) {
    if (hasOwn(value, 'uncached_input_tokens') || !validCanonicalTokenStats(tokens)) {
      return { tokens: null, issue: invalidCode };
    }
    return { tokens, issue: null };
  }

  if (!hasOwn(value, 'uncached_input_tokens')) {
    if (
      tokens.cachedTokens !== 0 ||
      tokens.cacheReadTokens !== 0 ||
      tokens.cacheCreationTokens !== 0
    ) {
      return { tokens: null, issue: 'usage_v1_cache_semantics_ambiguous' };
    }
    return validCanonicalTokenStats(tokens)
      ? { tokens, issue: null }
      : { tokens: null, issue: invalidCode };
  }

  const uncachedInputTokens = value.uncached_input_tokens;
  if (!isNonNegativeSafeInteger(uncachedInputTokens) || uncachedInputTokens > tokens.inputTokens) {
    return { tokens: null, issue: invalidCode };
  }

  const legacyCacheCreationAlias =
    tokens.cacheCreationTokens > 0 &&
    tokens.cacheReadTokens === 0 &&
    tokens.cachedTokens === tokens.cacheCreationTokens;
  const cacheReadTokens =
    tokens.cacheReadTokens === 0 && tokens.cachedTokens > 0 && !legacyCacheCreationAlias
      ? tokens.cachedTokens
      : tokens.cacheReadTokens;
  const canonicalInputTokens = uncachedInputTokens + cacheReadTokens + tokens.cacheCreationTokens;
  if (!Number.isSafeInteger(canonicalInputTokens)) {
    return { tokens: null, issue: invalidCode };
  }

  const migrated: CanonicalTokenCounts = {
    ...tokens,
    inputTokens: canonicalInputTokens,
    cachedTokens: legacyCacheCreationAlias ? 0 : cacheReadTokens,
    cacheReadTokens,
  };
  return validCanonicalTokenStats(migrated)
    ? { tokens: migrated, issue: null }
    : { tokens: null, issue: invalidCode };
};

const readCurrentTokenCounts = (value: UnknownRecord): CanonicalTokenCounts | null => {
  if (hasOwn(value, 'uncached_input_tokens')) {
    return readTokenCounts(value, 1).tokens;
  }
  const canonical = readTokenCounts(value, 2).tokens;
  if (canonical) return canonical;

  // Keep older partial live snapshots usable for best-effort overlap warnings.
  // Imported payloads never use this fallback; their v1/v2 contracts stay strict.
  for (const key of [...REQUIRED_TOKEN_FIELDS, ...OPTIONAL_TOKEN_FIELDS]) {
    if (hasOwn(value, key) && !isNonNegativeSafeInteger(value[key])) return null;
  }
  return {
    inputTokens: readNonNegativeSafeInteger(value, 'input_tokens') ?? 0,
    outputTokens: readNonNegativeSafeInteger(value, 'output_tokens') ?? 0,
    reasoningTokens: readNonNegativeSafeInteger(value, 'reasoning_tokens') ?? 0,
    cachedTokens: readNonNegativeSafeInteger(value, 'cached_tokens') ?? 0,
    cacheReadTokens: readNonNegativeSafeInteger(value, 'cache_read_tokens') ?? 0,
    cacheCreationTokens: readNonNegativeSafeInteger(value, 'cache_creation_tokens') ?? 0,
    totalTokens: readNonNegativeSafeInteger(value, 'total_tokens') ?? 0,
  };
};

const collectUsageDetailEntries = (
  snapshot: UnknownRecord,
  version: 1 | 2,
  strictImportedTokens = true
): CollectedEntries => {
  if (!validateSnapshotMetadata(snapshot) || !isRecord(snapshot.apis)) {
    return { entries: [], issue: 'usage_shape_invalid' };
  }

  const entries: UsageDetailEntry[] = [];
  for (const [rawApiName, apiValue] of Object.entries(snapshot.apis)) {
    const apiName = rawApiName.trim();
    if (!apiName || !isRecord(apiValue) || !isRecord(apiValue.models)) {
      return { entries: [], issue: 'usage_shape_invalid' };
    }
    if (
      !validateOptionalIntegerFields(apiValue, ['total_requests', 'total_tokens'], {
        nonNegative: true,
      })
    ) {
      return { entries: [], issue: 'usage_shape_invalid' };
    }

    for (const [rawModelName, modelValue] of Object.entries(apiValue.models)) {
      const modelName = rawModelName.trim() || 'unknown';
      if (!isRecord(modelValue) || !Array.isArray(modelValue.details)) {
        return { entries: [], issue: 'usage_shape_invalid' };
      }
      if (
        !validateOptionalIntegerFields(modelValue, ['total_requests', 'total_tokens'], {
          nonNegative: true,
        })
      ) {
        return { entries: [], issue: 'usage_shape_invalid' };
      }

      for (const detailValue of modelValue.details) {
        if (!isRecord(detailValue) || !validateDetailMetadata(detailValue)) {
          return { entries: [], issue: 'usage_shape_invalid' };
        }

        let timestampIdentity: string | null = null;
        if (hasOwn(detailValue, 'timestamp') && detailValue.timestamp !== null) {
          const canonicalTimestamp = canonicalizeRFC3339Timestamp(detailValue.timestamp);
          if (!canonicalTimestamp) return { entries: [], issue: 'usage_shape_invalid' };
          if (canonicalTimestamp !== '0001-01-01T00:00:00Z') {
            timestampIdentity = canonicalTimestamp;
          }
        }

        if (!hasOwn(detailValue, 'tokens') || detailValue.tokens === null) {
          return {
            entries: [],
            issue: strictImportedTokens
              ? version === 1
                ? 'usage_v1_token_contract_invalid'
                : 'usage_v2_token_contract_invalid'
              : 'usage_shape_invalid',
          };
        }
        if (!isRecord(detailValue.tokens)) {
          return { entries: [], issue: 'usage_shape_invalid' };
        }
        const tokenResult = strictImportedTokens
          ? readTokenCounts(detailValue.tokens, version)
          : {
              tokens: readCurrentTokenCounts(detailValue.tokens),
              issue: 'usage_shape_invalid' as const,
            };
        if (!tokenResult.tokens)
          return { entries: [], issue: tokenResult.issue ?? 'usage_shape_invalid' };

        entries.push({
          apiName,
          modelName,
          detail: detailValue,
          tokens: tokenResult.tokens,
          timestampIdentity,
        });
      }
    }
  }

  return { entries, issue: null };
};

const buildCanonicalDetailIdentity = (entry: UsageDetailEntry): string => {
  const { detail, tokens } = entry;
  return JSON.stringify([
    entry.apiName,
    entry.modelName,
    entry.timestampIdentity,
    typeof detail.source === 'string' ? detail.source : '',
    typeof detail.auth_index === 'string' ? detail.auth_index : '',
    detail.failed === true,
    typeof detail.failure_reason === 'string' ? detail.failure_reason : '',
    isSafeInteger(detail.failure_status) ? detail.failure_status : 0,
    tokens.inputTokens,
    tokens.outputTokens,
    tokens.reasoningTokens,
    tokens.cachedTokens,
    tokens.cacheReadTokens,
    tokens.cacheCreationTokens,
    tokens.totalTokens,
  ]);
};

const resolveCurrentSnapshot = (value: unknown): UnknownRecord | null => {
  if (!isRecord(value)) return null;
  if (isRecord(value.usage)) return value.usage;
  return value;
};

const invalidResult = (
  issue: UsageImportPreflightIssue,
  version: number | null,
  detailCount = 0
): UsageImportPreflightResult => ({
  valid: false,
  version,
  detailCount,
  currentDetailCount: 0,
  currentUsageAvailable: false,
  duplicateCount: 0,
  overlapCount: 0,
  uncertainIdentityCount: 0,
  issues: [issue],
});

export function analyzeUsageImport(
  payload: unknown,
  currentUsage: unknown = null
): UsageImportPreflightResult {
  if (!isRecord(payload)) return invalidResult('usage_shape_invalid', null);

  const rawVersion = payload.version;
  if (!isSafeInteger(rawVersion)) {
    return invalidResult(
      rawVersion === undefined ? 'usage_version_unsupported' : 'usage_shape_invalid',
      null
    );
  }
  if (rawVersion !== 1 && rawVersion !== 2) {
    return invalidResult('usage_version_unsupported', rawVersion);
  }
  const version: 1 | 2 = rawVersion;

  if (!isRecord(payload.usage)) return invalidResult('usage_shape_invalid', version);
  const imported = collectUsageDetailEntries(payload.usage, version);
  if (imported.issue) return invalidResult(imported.issue, version, imported.entries.length);

  const currentSnapshot = resolveCurrentSnapshot(currentUsage);
  const current = currentSnapshot
    ? collectUsageDetailEntries(currentSnapshot, 2, false)
    : { entries: [], issue: 'usage_shape_invalid' as UsageImportPreflightIssue };
  const currentUsageAvailable = Boolean(currentSnapshot && !current.issue);
  const currentEntries = currentUsageAvailable ? current.entries : [];

  const importedIdentityCounts = new Map<string, number>();
  imported.entries.forEach((entry) => {
    if (entry.timestampIdentity === null) return;
    const identity = buildCanonicalDetailIdentity(entry);
    importedIdentityCounts.set(identity, (importedIdentityCounts.get(identity) ?? 0) + 1);
  });

  let duplicateCount = 0;
  importedIdentityCounts.forEach((count) => {
    if (count > 1) duplicateCount += count - 1;
  });

  const currentIdentities = new Set(
    currentEntries
      .filter((entry) => entry.timestampIdentity !== null)
      .map(buildCanonicalDetailIdentity)
  );
  let overlapCount = 0;
  importedIdentityCounts.forEach((_count, identity) => {
    if (currentIdentities.has(identity)) overlapCount += 1;
  });

  return {
    valid: true,
    version,
    detailCount: imported.entries.length,
    currentDetailCount: currentEntries.length,
    currentUsageAvailable,
    duplicateCount,
    overlapCount,
    uncertainIdentityCount: imported.entries.filter((entry) => entry.timestampIdentity === null)
      .length,
    issues: [],
  };
}
