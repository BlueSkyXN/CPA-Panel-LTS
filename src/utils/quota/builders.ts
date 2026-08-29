/**
 * Builder functions for constructing quota data structures.
 */

import type {
  AntigravityQuotaBucket,
  AntigravityQuotaGroup,
  AntigravityQuotaSummaryPayload,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  KimiUsagePayload,
  KimiUsageDetail,
  KimiLimitItem,
  KimiLimitWindow,
  KimiQuotaRow,
  XaiBillingConfig,
  XaiBillingPayload,
  XaiAutoTopupRule,
  XaiBillingPeriod,
  XaiBillingPeriodType,
  XaiBillingSummary,
  XaiProductUsageSummary,
} from '@/types';
import { GEMINI_CLI_GROUP_LOOKUP, GEMINI_CLI_GROUP_ORDER } from './constants';
import { normalizeNumberValue, normalizeQuotaFraction, normalizeStringValue } from './parsers';
import { isIgnoredGeminiCliModel } from './validators';

export function pickEarlierResetTime(current?: string, next?: string): string | undefined {
  if (!current) return next;
  if (!next) return current;
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (Number.isNaN(currentTime)) return next;
  if (Number.isNaN(nextTime)) return current;
  return currentTime <= nextTime ? current : next;
}

export function minNullableNumber(current: number | null, next: number | null): number | null {
  if (current === null) return next;
  if (next === null) return current;
  return Math.min(current, next);
}

export function buildGeminiCliQuotaBuckets(
  buckets: GeminiCliParsedBucket[]
): GeminiCliQuotaBucketState[] {
  if (buckets.length === 0) return [];

  type GeminiCliQuotaBucketGroup = {
    id: string;
    label: string;
    tokenType: string | null;
    modelIds: string[];
    preferredModelId?: string;
    preferredBucket?: GeminiCliParsedBucket;
    fallbackRemainingFraction: number | null;
    fallbackRemainingAmount: number | null;
    fallbackResetTime: string | undefined;
  };

  const grouped = new Map<string, GeminiCliQuotaBucketGroup>();

  buckets.forEach((bucket) => {
    if (isIgnoredGeminiCliModel(bucket.modelId)) return;
    const group = GEMINI_CLI_GROUP_LOOKUP.get(bucket.modelId);
    const groupId = group?.id ?? bucket.modelId;
    const label = group?.label ?? bucket.modelId;
    const tokenKey = bucket.tokenType ?? '';
    const mapKey = `${groupId}::${tokenKey}`;
    const existing = grouped.get(mapKey);

    if (!existing) {
      const preferredModelId = group?.preferredModelId;
      const preferredBucket =
        preferredModelId && bucket.modelId === preferredModelId ? bucket : undefined;
      grouped.set(mapKey, {
        id: `${groupId}${tokenKey ? `-${tokenKey}` : ''}`,
        label,
        tokenType: bucket.tokenType,
        modelIds: [bucket.modelId],
        preferredModelId,
        preferredBucket,
        fallbackRemainingFraction: bucket.remainingFraction,
        fallbackRemainingAmount: bucket.remainingAmount,
        fallbackResetTime: bucket.resetTime,
      });
      return;
    }

    existing.fallbackRemainingFraction = minNullableNumber(
      existing.fallbackRemainingFraction,
      bucket.remainingFraction
    );
    existing.fallbackRemainingAmount = minNullableNumber(
      existing.fallbackRemainingAmount,
      bucket.remainingAmount
    );
    existing.fallbackResetTime = pickEarlierResetTime(existing.fallbackResetTime, bucket.resetTime);
    existing.modelIds.push(bucket.modelId);

    if (existing.preferredModelId && bucket.modelId === existing.preferredModelId) {
      existing.preferredBucket = bucket;
    }
  });

  const toGroupOrder = (bucket: GeminiCliQuotaBucketGroup): number => {
    const tokenSuffix = bucket.tokenType ? `-${bucket.tokenType}` : '';
    const groupId = bucket.id.endsWith(tokenSuffix)
      ? bucket.id.slice(0, bucket.id.length - tokenSuffix.length)
      : bucket.id;
    return GEMINI_CLI_GROUP_ORDER.get(groupId) ?? Number.MAX_SAFE_INTEGER;
  };

  return Array.from(grouped.values())
    .sort((a, b) => {
      const orderDiff = toGroupOrder(a) - toGroupOrder(b);
      if (orderDiff !== 0) return orderDiff;
      const tokenTypeA = a.tokenType ?? '';
      const tokenTypeB = b.tokenType ?? '';
      return tokenTypeA.localeCompare(tokenTypeB);
    })
    .map((bucket) => {
      const uniqueModelIds = Array.from(new Set(bucket.modelIds));
      const preferred = bucket.preferredBucket;
      const remainingFraction = preferred
        ? preferred.remainingFraction
        : bucket.fallbackRemainingFraction;
      const remainingAmount = preferred
        ? preferred.remainingAmount
        : bucket.fallbackRemainingAmount;
      const resetTime = preferred ? preferred.resetTime : bucket.fallbackResetTime;
      return {
        id: bucket.id,
        label: bucket.label,
        remainingFraction,
        remainingAmount,
        resetTime,
        tokenType: bucket.tokenType,
        modelIds: uniqueModelIds,
      };
    });
}

const ANTIGRAVITY_BUCKET_WINDOW_ORDER = new Map<string, number>([
  ['weekly', 0],
  ['week', 0],
  ['5h', 1],
  ['five-hour', 1],
  ['five_hour', 1],
]);

function toStableId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function getAntigravityWindowOrder(bucket: AntigravityQuotaBucket): number {
  const window = bucket.window?.toLowerCase();
  if (!window) return Number.MAX_SAFE_INTEGER;
  return ANTIGRAVITY_BUCKET_WINDOW_ORDER.get(window) ?? Number.MAX_SAFE_INTEGER;
}

export function buildAntigravityQuotaGroups(
  payload: AntigravityQuotaSummaryPayload
): AntigravityQuotaGroup[] {
  const groups = Array.isArray(payload.groups) ? payload.groups : [];

  return groups
    .map((group, groupIndex): AntigravityQuotaGroup | null => {
      const label =
        normalizeStringValue(group.displayName ?? group.display_name) ??
        `Quota Group ${groupIndex + 1}`;
      const groupId = toStableId(label, `quota-group-${groupIndex + 1}`);
      const buckets = Array.isArray(group.buckets) ? group.buckets : [];
      const parsedBuckets = buckets
        .map((bucket, bucketIndex): AntigravityQuotaBucket | null => {
          const remainingFraction = normalizeQuotaFraction(
            bucket.remainingFraction ?? bucket.remaining_fraction
          );
          if (remainingFraction === null) return null;

          const window = normalizeStringValue(bucket.window) ?? undefined;
          const rawId =
            normalizeStringValue(bucket.bucketId ?? bucket.bucket_id) ??
            `${groupId}-${window ?? `bucket-${bucketIndex + 1}`}`;
          const bucketLabel =
            normalizeStringValue(bucket.displayName ?? bucket.display_name) ?? rawId;

          return {
            id: rawId,
            label: bucketLabel,
            window,
            remainingFraction,
            resetTime: normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined,
            description: normalizeStringValue(bucket.description) ?? undefined,
          };
        })
        .filter((bucket): bucket is AntigravityQuotaBucket => bucket !== null)
        .sort((a, b) => {
          const orderDiff = getAntigravityWindowOrder(a) - getAntigravityWindowOrder(b);
          if (orderDiff !== 0) return orderDiff;
          return a.label.localeCompare(b.label);
        });

      if (parsedBuckets.length === 0) return null;

      return {
        id: groupId,
        label,
        description: normalizeStringValue(group.description) ?? undefined,
        buckets: parsedBuckets,
      };
    })
    .filter((group): group is AntigravityQuotaGroup => group !== null);
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  return null;
}

type KimiRowLabel = Pick<KimiQuotaRow, 'label' | 'labelKey' | 'labelParams'>;

function formatKimiResetDuration(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

function kimiAbsoluteResetMs(data: Record<string, unknown>): number | null {
  for (const key of ['reset_at', 'resetAt', 'reset_time', 'resetTime']) {
    const raw = data[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw < 1e12 ? raw * 1000 : raw;
    }
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const trimmed = raw.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = new Date(trimmed.replace(/(\.\d{6})\d+/, '$1')).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}

function kimiResetMs(data: Record<string, unknown>): number | null {
  const absolute = kimiAbsoluteResetMs(data);
  if (absolute !== null) return absolute;
  for (const key of ['reset_in', 'resetIn', 'ttl']) {
    const seconds = toInt(data[key]);
    if (seconds !== null && seconds > 0) return Date.now() + seconds * 1000;
  }
  return null;
}

function kimiResetHint(data: Record<string, unknown>): string | undefined {
  const absolute = kimiAbsoluteResetMs(data);
  if (absolute !== null) {
    const delta = absolute - Date.now();
    if (delta <= 0) return undefined;
    return formatKimiResetDuration(Math.floor(delta / 60000));
  }
  for (const key of ['reset_in', 'resetIn', 'ttl']) {
    const seconds = toInt(data[key]);
    if (seconds !== null && seconds > 0) {
      return formatKimiResetDuration(Math.floor(seconds / 60));
    }
  }
  return undefined;
}

type KimiTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week';

function normalizeKimiTimeUnit(rawTimeUnit: unknown): KimiTimeUnit | null {
  const unit =
    typeof rawTimeUnit === 'string'
      ? rawTimeUnit
          .trim()
          .toUpperCase()
          .replace(/^TIME_UNIT_/, '')
      : '';
  if (unit === 'SECONDS' || unit === 'SECOND') return 'second';
  if (!unit || unit === 'MINUTES' || unit === 'MINUTE') return 'minute';
  if (unit === 'HOURS' || unit === 'HOUR') return 'hour';
  if (unit === 'DAYS' || unit === 'DAY') return 'day';
  if (unit === 'WEEKS' || unit === 'WEEK') return 'week';
  return null;
}

function kimiDurationToken(duration: number, rawTimeUnit: unknown): string {
  const unit = normalizeKimiTimeUnit(rawTimeUnit);
  if (unit === 'second') return `${duration}s`;
  if (unit === 'hour') return `${duration}h`;
  if (unit === 'day') return `${duration}d`;
  if (unit === 'week') return `${duration}w`;
  return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
}

function kimiLimitLabel(
  item: KimiLimitItem,
  detail: KimiUsageDetail | KimiLimitItem,
  window: KimiLimitWindow,
  index: number
): KimiRowLabel {
  for (const key of ['name', 'title', 'scope'] as const) {
    const val = (item as Record<string, unknown>)[key] ?? (detail as Record<string, unknown>)[key];
    if (typeof val === 'string' && val.trim()) return { label: val.trim() };
  }

  const duration =
    toInt(window.duration) ??
    toInt((item as Record<string, unknown>).duration) ??
    toInt((detail as Record<string, unknown>).duration);
  const timeUnit =
    (window as Record<string, unknown>).timeUnit ??
    (window as Record<string, unknown>).time_unit ??
    (item as Record<string, unknown>).timeUnit ??
    (item as Record<string, unknown>).time_unit ??
    (detail as Record<string, unknown>).timeUnit ??
    (detail as Record<string, unknown>).time_unit;

  if (duration !== null && duration > 0) {
    return {
      labelKey: 'kimi_quota.limit_window',
      labelParams: {
        duration: kimiDurationToken(duration, timeUnit),
      },
    };
  }

  return {
    labelKey: 'kimi_quota.limit_index',
    labelParams: {
      index: index + 1,
    },
  };
}

function toKimiUsageRow(
  data: Record<string, unknown>,
  fallbackLabel: KimiRowLabel
):
  | (KimiRowLabel & { used: number; limit: number; resetHint?: string; resetAtMs?: number | null })
  | null {
  const limit = toInt(data.limit);
  let used = toInt(data.used);
  if (used === null) {
    const remaining = toInt(data.remaining);
    if (remaining !== null && limit !== null) {
      used = limit - remaining;
    }
  }
  if (used === null && limit === null) return null;
  const explicitLabel =
    (typeof data.name === 'string' && data.name.trim()) ||
    (typeof data.title === 'string' && data.title.trim());
  const label = explicitLabel ? { label: explicitLabel } : fallbackLabel;
  return {
    ...label,
    used: used ?? 0,
    limit: limit ?? 0,
    resetHint: kimiResetHint(data),
    resetAtMs: kimiResetMs(data),
  };
}

export function buildKimiQuotaRows(payload: KimiUsagePayload): KimiQuotaRow[] {
  const rows: KimiQuotaRow[] = [];

  const limits = payload.limits;
  if (Array.isArray(limits)) {
    limits.forEach((item, idx) => {
      const detail = (item.detail && typeof item.detail === 'object' ? item.detail : item) as
        | KimiUsageDetail
        | KimiLimitItem;
      const window = (
        item.window && typeof item.window === 'object' ? item.window : {}
      ) as KimiLimitWindow;
      const fallbackLabel = kimiLimitLabel(item, detail, window, idx);
      const row = toKimiUsageRow(detail as Record<string, unknown>, fallbackLabel);
      if (row) {
        rows.push({ id: `limit-${idx}`, ...row });
      }
    });
  }

  const usage = payload.usage;
  if (usage && typeof usage === 'object') {
    const summary = toKimiUsageRow(usage as Record<string, unknown>, {
      labelKey: 'kimi_quota.weekly_limit',
    });
    if (summary) {
      rows.push({ id: 'summary', ...summary });
    }
  }

  return rows;
}

function normalizeXaiCentValue(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeNumberValue((value as { val?: unknown }).val);
  }
  return normalizeNumberValue(value);
}

function resolveXaiPeriodType(period?: XaiBillingPeriod | null): XaiBillingPeriodType {
  const rawType = normalizeStringValue(period?.type)?.toLowerCase() ?? '';
  if (rawType.includes('weekly')) return 'weekly';
  if (rawType.includes('monthly')) return 'monthly';
  return 'unknown';
}

function normalizeXaiProductUsage(
  productUsage: XaiBillingConfig['productUsage'],
  fallbackPrefix: string
): XaiProductUsageSummary[] {
  if (!Array.isArray(productUsage)) return [];

  return productUsage
    .map((item, index): XaiProductUsageSummary | null => {
      if (!item || typeof item !== 'object') return null;
      const product = normalizeStringValue(item.product) ?? `${fallbackPrefix} ${index + 1}`;
      const usagePercent = normalizeNumberValue(item.usagePercent ?? item.usage_percent);
      return { product, usagePercent };
    })
    .filter((item): item is XaiProductUsageSummary => item !== null);
}

const emptyXaiBillingSummary = (): XaiBillingSummary => ({
  periodType: 'unknown',
  usagePercent: null,
  productUsage: [],
  monthlyLimitCents: null,
  usedCents: null,
  includedUsedCents: null,
  onDemandCapCents: null,
  onDemandUsedCents: null,
  onDemandUsedPercent: null,
  usedPercent: null,
  prepaidBalanceCents: null,
  isUnifiedBillingUser: null,
  onDemandEnabled: null,
  subscriptionTier: null,
  historyCount: 0,
  autoTopupEnabled: null,
  autoTopupMinBeforeCents: null,
  autoTopupAmountCents: null,
  autoTopupMaxPerMonthCents: null,
});

export function buildXaiBillingSummary(
  config: XaiBillingConfig | null | undefined,
  payload?: Pick<XaiBillingPayload, 'onDemandEnabled' | 'on_demand_enabled' | 'subscriptionTier' | 'subscription_tier'>
): XaiBillingSummary | null {
  if (!config || typeof config !== 'object') return null;

  const summary = emptyXaiBillingSummary();
  const currentPeriod = config.currentPeriod ?? config.current_period ?? null;
  const periodType = resolveXaiPeriodType(currentPeriod);
  const creditUsagePercent = normalizeNumberValue(
    config.creditUsagePercent ?? config.credit_usage_percent
  );
  const periodStart =
    normalizeStringValue(currentPeriod?.start) ??
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start) ??
    undefined;
  const periodEnd =
    normalizeStringValue(currentPeriod?.end) ??
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end) ??
    undefined;
  const productUsage = normalizeXaiProductUsage(
    config.productUsage ?? config.product_usage,
    'Product'
  );

  const monthlyLimitCents = normalizeXaiCentValue(config.monthlyLimit ?? config.monthly_limit);
  const usedCents = normalizeXaiCentValue(config.used);
  const onDemandCapCents = normalizeXaiCentValue(config.onDemandCap ?? config.on_demand_cap);
  const explicitOnDemandUsedCents = normalizeXaiCentValue(
    config.onDemandUsed ?? config.on_demand_used
  );
  const billingPeriodStart =
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start) ?? undefined;
  const billingPeriodEnd =
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end) ?? undefined;
  const prepaidBalanceCents = normalizeXaiCentValue(
    config.prepaidBalance ?? config.prepaid_balance
  );
  const isUnifiedBillingUser =
    typeof (config.isUnifiedBillingUser ?? config.is_unified_billing_user) === 'boolean'
      ? (config.isUnifiedBillingUser ?? config.is_unified_billing_user)!
      : null;
  const onDemandEnabled =
    typeof (payload?.onDemandEnabled ?? payload?.on_demand_enabled) === 'boolean'
      ? (payload?.onDemandEnabled ?? payload?.on_demand_enabled)!
      : null;
  const subscriptionTier =
    normalizeStringValue(payload?.subscriptionTier ?? payload?.subscription_tier) ?? null;
  const historyCount = Array.isArray(config.history) ? config.history.length : 0;

  const includedUsedCents =
    usedCents === null
      ? null
      : monthlyLimitCents !== null && monthlyLimitCents > 0
        ? Math.min(usedCents, monthlyLimitCents)
        : usedCents;
  const derivedOnDemandUsedCents =
    usedCents !== null && monthlyLimitCents !== null
      ? Math.max(0, usedCents - monthlyLimitCents)
      : null;
  const onDemandUsedCents = explicitOnDemandUsedCents ?? derivedOnDemandUsedCents;
  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && includedUsedCents !== null
      ? (includedUsedCents / monthlyLimitCents) * 100
      : null;
  const onDemandUsedPercent =
    onDemandCapCents !== null && onDemandCapCents > 0 && onDemandUsedCents !== null
      ? (onDemandUsedCents / onDemandCapCents) * 100
      : null;

  const hasWeeklyData =
    creditUsagePercent !== null || periodType === 'weekly' || productUsage.length > 0;
  const hasMonthlyData =
    monthlyLimitCents !== null ||
    usedCents !== null ||
    (!hasWeeklyData && (onDemandCapCents !== null || !!billingPeriodEnd));
  const hasSupplementaryData =
    prepaidBalanceCents !== null || isUnifiedBillingUser !== null || historyCount > 0;

  if (!hasWeeklyData && !hasMonthlyData && !hasSupplementaryData) return null;

  summary.periodType = hasWeeklyData
    ? periodType === 'unknown'
      ? 'weekly'
      : periodType
    : 'monthly';
  summary.usagePercent = hasWeeklyData ? creditUsagePercent : usedPercent;
  summary.periodStart = hasWeeklyData ? periodStart : billingPeriodStart;
  summary.periodEnd = hasWeeklyData ? periodEnd : billingPeriodEnd;
  summary.productUsage = productUsage;
  summary.monthlyLimitCents = monthlyLimitCents;
  summary.usedCents = usedCents;
  summary.includedUsedCents = includedUsedCents;
  summary.onDemandCapCents = onDemandCapCents;
  summary.onDemandUsedCents = onDemandUsedCents;
  summary.onDemandUsedPercent = onDemandUsedPercent;
  summary.billingPeriodStart = hasMonthlyData ? billingPeriodStart : undefined;
  summary.billingPeriodEnd = hasMonthlyData ? billingPeriodEnd : undefined;
  summary.usedPercent = usedPercent;
  summary.prepaidBalanceCents = prepaidBalanceCents;
  summary.isUnifiedBillingUser = isUnifiedBillingUser;
  summary.onDemandEnabled = onDemandEnabled;
  summary.subscriptionTier = subscriptionTier;
  summary.historyCount = historyCount;

  return summary;
}

export function applyXaiAutoTopupRule(
  summary: XaiBillingSummary,
  rule: XaiAutoTopupRule | null | undefined
): XaiBillingSummary {
  const resolvedRule = rule && typeof rule === 'object' ? rule : null;
  return {
    ...summary,
    autoTopupEnabled: typeof resolvedRule?.enabled === 'boolean' ? resolvedRule.enabled : false,
    autoTopupMinBeforeCents: normalizeXaiCentValue(
      resolvedRule?.minBeforeHittingSl ?? resolvedRule?.min_before_hitting_sl
    ),
    autoTopupAmountCents: normalizeXaiCentValue(
      resolvedRule?.topupAmount ?? resolvedRule?.topup_amount
    ),
    autoTopupMaxPerMonthCents: normalizeXaiCentValue(
      resolvedRule?.maxAmountPerMonth ?? resolvedRule?.max_amount_per_month
    ),
  };
}

export function mergeXaiBillingSummaries(
  primary: XaiBillingSummary | null,
  fallback: XaiBillingSummary | null
): XaiBillingSummary | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  // Weekly and monthly endpoints describe different clocks. Keep the selected
  // period type and its dates from the same response instead of mixing fields.
  const periodSummary =
    primary.periodType !== 'unknown'
      ? primary
      : fallback.periodType !== 'unknown'
        ? fallback
        : primary;

  return {
    periodType: periodSummary.periodType,
    usagePercent: primary.usagePercent ?? fallback.usagePercent,
    periodStart: periodSummary.periodStart,
    periodEnd: periodSummary.periodEnd,
    productUsage: primary.productUsage.length > 0 ? primary.productUsage : fallback.productUsage,
    monthlyLimitCents: primary.monthlyLimitCents ?? fallback.monthlyLimitCents,
    usedCents: primary.usedCents ?? fallback.usedCents,
    includedUsedCents: primary.includedUsedCents ?? fallback.includedUsedCents,
    onDemandCapCents: primary.onDemandCapCents ?? fallback.onDemandCapCents,
    onDemandUsedCents: primary.onDemandUsedCents ?? fallback.onDemandUsedCents,
    onDemandUsedPercent: primary.onDemandUsedPercent ?? fallback.onDemandUsedPercent,
    billingPeriodStart: primary.billingPeriodStart ?? fallback.billingPeriodStart,
    billingPeriodEnd: primary.billingPeriodEnd ?? fallback.billingPeriodEnd,
    usedPercent: primary.usedPercent ?? fallback.usedPercent,
    prepaidBalanceCents: primary.prepaidBalanceCents ?? fallback.prepaidBalanceCents,
    isUnifiedBillingUser: primary.isUnifiedBillingUser ?? fallback.isUnifiedBillingUser,
    onDemandEnabled: primary.onDemandEnabled ?? fallback.onDemandEnabled,
    subscriptionTier: primary.subscriptionTier ?? fallback.subscriptionTier,
    historyCount: Math.max(primary.historyCount, fallback.historyCount),
    autoTopupEnabled: primary.autoTopupEnabled ?? fallback.autoTopupEnabled,
    autoTopupMinBeforeCents:
      primary.autoTopupMinBeforeCents ?? fallback.autoTopupMinBeforeCents,
    autoTopupAmountCents: primary.autoTopupAmountCents ?? fallback.autoTopupAmountCents,
    autoTopupMaxPerMonthCents:
      primary.autoTopupMaxPerMonthCents ?? fallback.autoTopupMaxPerMonthCents,
  };
}
