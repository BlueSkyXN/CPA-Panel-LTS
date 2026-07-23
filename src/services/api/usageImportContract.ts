export const USAGE_IMPORT_ERROR_CODES = [
  'usage_version_unsupported',
  'usage_shape_invalid',
  'usage_v1_token_contract_invalid',
  'usage_v1_cache_semantics_ambiguous',
  'usage_v2_token_contract_invalid',
  'usage_aggregate_overflow',
] as const;

export type UsageImportErrorCode = (typeof USAGE_IMPORT_ERROR_CODES)[number];

export const USAGE_IMPORT_ERROR_TRANSLATION_KEYS: Record<
  UsageImportErrorCode,
  `usage_stats.import_error_${UsageImportErrorCode}`
> = {
  usage_version_unsupported: 'usage_stats.import_error_usage_version_unsupported',
  usage_shape_invalid: 'usage_stats.import_error_usage_shape_invalid',
  usage_v1_token_contract_invalid: 'usage_stats.import_error_usage_v1_token_contract_invalid',
  usage_v1_cache_semantics_ambiguous: 'usage_stats.import_error_usage_v1_cache_semantics_ambiguous',
  usage_v2_token_contract_invalid: 'usage_stats.import_error_usage_v2_token_contract_invalid',
  usage_aggregate_overflow: 'usage_stats.import_error_usage_aggregate_overflow',
};

export const USAGE_IMPORT_MIGRATION = 'v1_uncached_input_tokens_to_v2' as const;

export interface UsageImportReceipt {
  added: number;
  skipped: number;
  total_requests: number;
  failed_requests: number;
  schema_version?: 2;
  migrated_from_version?: 1;
  migration?: typeof USAGE_IMPORT_MIGRATION;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isUsageImportErrorCode = (value: unknown): value is UsageImportErrorCode =>
  typeof value === 'string' && (USAGE_IMPORT_ERROR_CODES as readonly string[]).includes(value);

export function decodeUsageImportReceipt(value: unknown): UsageImportReceipt | null {
  if (!isRecord(value)) return null;
  if (
    !isNonNegativeSafeInteger(value.added) ||
    !isNonNegativeSafeInteger(value.skipped) ||
    !isNonNegativeSafeInteger(value.total_requests) ||
    !isNonNegativeSafeInteger(value.failed_requests) ||
    (Object.prototype.hasOwnProperty.call(value, 'schema_version') && value.schema_version !== 2)
  ) {
    return null;
  }

  const hasMigrationVersion = Object.prototype.hasOwnProperty.call(value, 'migrated_from_version');
  const hasMigrationName = Object.prototype.hasOwnProperty.call(value, 'migration');
  if (hasMigrationVersion !== hasMigrationName) return null;
  if (
    hasMigrationVersion &&
    (value.schema_version !== 2 ||
      value.migrated_from_version !== 1 ||
      value.migration !== USAGE_IMPORT_MIGRATION)
  ) {
    return null;
  }

  return {
    added: value.added,
    skipped: value.skipped,
    total_requests: value.total_requests,
    failed_requests: value.failed_requests,
    ...(value.schema_version === 2 ? { schema_version: 2 as const } : {}),
    ...(hasMigrationVersion
      ? {
          migrated_from_version: 1 as const,
          migration: USAGE_IMPORT_MIGRATION,
        }
      : {}),
  };
}

export function getUsageImportErrorCode(error: unknown): UsageImportErrorCode | null {
  if (!isRecord(error)) return null;
  const candidates = [error.data, error.details, error];
  for (const candidate of candidates) {
    if (isRecord(candidate) && isUsageImportErrorCode(candidate.code)) {
      return candidate.code;
    }
  }
  return null;
}

export const getUsageImportErrorTranslationKey = (
  code: UsageImportErrorCode
): `usage_stats.import_error_${UsageImportErrorCode}` => USAGE_IMPORT_ERROR_TRANSLATION_KEYS[code];

export function isMigratedV1UsageImportReceipt(
  receipt: UsageImportReceipt
): receipt is UsageImportReceipt & {
  schema_version: 2;
  migrated_from_version: 1;
  migration: typeof USAGE_IMPORT_MIGRATION;
} {
  return (
    receipt.schema_version === 2 &&
    receipt.migrated_from_version === 1 &&
    receipt.migration === USAGE_IMPORT_MIGRATION
  );
}
