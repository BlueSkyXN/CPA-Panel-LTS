import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { IconChevronDown, IconInfo } from '@/components/ui/icons';
import type {
  AuthFileItem,
  CodexAnalyticsClientSummary,
  CodexAnalyticsRange,
  CodexAnalyticsState,
  CodexDailyUsageDay,
  CodexDailyUsageMetrics,
  CodexDailyUsagePayload,
  CodexUsageLeaderboardPayload,
  CodexUsageLeaderboardRow,
  CodexRateLimitInfo,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  CodexWeeklyEstimate,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  CODEX_ANALYTICS_ROLLING_DAYS,
  CODEX_DAILY_USAGE_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_TEAM_USAGE_LEADERBOARD_URL,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  CODEX_USD_PER_CREDIT,
  normalizeNumberValue,
  normalizePlanType,
  normalizeStringValue,
  parseCodexDailyUsagePayload,
  parseCodexUsageLeaderboardPayload,
  parseCodexUsagePayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveCodexSubscriptionActiveUntil,
  formatCodexResetLabel,
  createStatusError,
  getStatusFromError,
  isCodexFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';
import { formatUnixTimestamp } from '@/utils/format';
import type { QuotaRenderHelpers } from '@/components/quota/QuotaCard';
import type { QuotaConfig } from '@/components/quota/quotaConfigs';
import styles from '@/pages/QuotaPage.module.scss';

const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;
const CODEX_FIVE_HOUR_SECONDS = 18000;
const CODEX_WEEK_SECONDS = 604800;
const CODEX_MIN_MONTH_SECONDS = 28 * 24 * 60 * 60;
const CODEX_MAX_MONTH_SECONDS = 31 * 24 * 60 * 60;
const CODEX_DAY_MS = 24 * 60 * 60 * 1000;
const CODEX_TOP_CLIENT_LIMIT = 3;
const CODEX_TEAM_PERMISSION_STATUSES = new Set([401, 403]);
const CODEX_TEAM_LEADERBOARD_CACHE_TTL_MS = 2 * 60 * 1000;
const CODEX_TEAM_LEADERBOARD_CACHE_WAIT_MS = 2200;
const CODEX_TEAM_LEADERBOARD_CACHE_POLL_MS = 100;
const CODEX_BATCH_CONCURRENCY = 1;
const CODEX_BATCH_DELAY_MS = 600;
const codexTeamLeaderboardCache = new Map<
  string,
  {
    fetchedAt: number;
    sourceAuthIndex: string;
    payload: CodexUsageLeaderboardPayload;
  }
>();

const getCodexWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
  if (!window) return null;
  return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
};

const isCodexMonthlyWindow = (window?: CodexUsageWindow | null): boolean => {
  const seconds = getCodexWindowSeconds(window);
  return (
    seconds !== null && seconds >= CODEX_MIN_MONTH_SECONDS && seconds <= CODEX_MAX_MONTH_SECONDS
  );
};

const selectCodexSecondaryWindowMeta = <
  TWeekly extends { id: string; labelKey: string },
  TMonthly extends { id: string; labelKey: string },
>(
  window: CodexUsageWindow | null | undefined,
  weeklyMeta: TWeekly,
  monthlyMeta: TMonthly
): TWeekly | TMonthly => (isCodexMonthlyWindow(window) ? monthlyMeta : weeklyMeta);

const pickCodexClassifiedWindows = (
  limitInfo?: CodexRateLimitInfo | null,
  options?: { allowOrderFallback?: boolean }
): { fiveHourWindow: CodexUsageWindow | null; weeklyWindow: CodexUsageWindow | null } => {
  const allowOrderFallback = options?.allowOrderFallback ?? true;
  const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
  const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
  const rawWindows = [primaryWindow, secondaryWindow];

  let fiveHourWindow: CodexUsageWindow | null = null;
  let weeklyWindow: CodexUsageWindow | null = null;

  for (const window of rawWindows) {
    if (!window) continue;
    const seconds = getCodexWindowSeconds(window);
    if (seconds === CODEX_FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window;
    } else if ((seconds === CODEX_WEEK_SECONDS || isCodexMonthlyWindow(window)) && !weeklyWindow) {
      weeklyWindow = window;
    }
  }

  if (allowOrderFallback) {
    if (!fiveHourWindow) {
      fiveHourWindow = primaryWindow && primaryWindow !== weeklyWindow ? primaryWindow : null;
    }
    if (!weeklyWindow) {
      weeklyWindow = secondaryWindow && secondaryWindow !== fiveHourWindow ? secondaryWindow : null;
    }
  }

  return { fiveHourWindow, weeklyWindow };
};

const buildCodexQuotaWindows = (payload: CodexUsagePayload, t: TFunction): CodexQuotaWindow[] => {
  const WINDOW_META = {
    codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
    codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
    codeMonthly: { id: 'monthly', labelKey: 'codex_quota.monthly_window' },
    codeReviewFiveHour: {
      id: 'code-review-five-hour',
      labelKey: 'codex_quota.code_review_primary_window',
    },
    codeReviewWeekly: {
      id: 'code-review-weekly',
      labelKey: 'codex_quota.code_review_secondary_window',
    },
    codeReviewMonthly: {
      id: 'code-review-monthly',
      labelKey: 'codex_quota.code_review_monthly_window',
    },
  } as const;

  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
  const windows: CodexQuotaWindow[] = [];

  const addWindow = (
    id: string,
    label: string,
    labelKey: string | undefined,
    labelParams: Record<string, string | number> | undefined,
    window?: CodexUsageWindow | null,
    limitReached?: boolean,
    allowed?: boolean
  ) => {
    if (!window) return;
    const resetLabel = formatCodexResetLabel(window);
    const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
    const isLimitReached = Boolean(limitReached) || allowed === false;
    const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
    windows.push({
      id,
      label,
      labelKey,
      labelParams,
      usedPercent,
      resetLabel,
    });
  };

  const rawLimitReached = rateLimit?.limit_reached ?? rateLimit?.limitReached;
  const rawAllowed = rateLimit?.allowed;
  const rateWindows = pickCodexClassifiedWindows(rateLimit);
  addWindow(
    WINDOW_META.codeFiveHour.id,
    t(WINDOW_META.codeFiveHour.labelKey),
    WINDOW_META.codeFiveHour.labelKey,
    undefined,
    rateWindows.fiveHourWindow,
    rawLimitReached,
    rawAllowed
  );
  const codeSecondaryWindowMeta = selectCodexSecondaryWindowMeta(
    rateWindows.weeklyWindow,
    WINDOW_META.codeWeekly,
    WINDOW_META.codeMonthly
  );
  addWindow(
    codeSecondaryWindowMeta.id,
    t(codeSecondaryWindowMeta.labelKey),
    codeSecondaryWindowMeta.labelKey,
    undefined,
    rateWindows.weeklyWindow,
    rawLimitReached,
    rawAllowed
  );

  const codeReviewWindows = pickCodexClassifiedWindows(codeReviewLimit);
  const codeReviewLimitReached = codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached;
  const codeReviewAllowed = codeReviewLimit?.allowed;
  addWindow(
    WINDOW_META.codeReviewFiveHour.id,
    t(WINDOW_META.codeReviewFiveHour.labelKey),
    WINDOW_META.codeReviewFiveHour.labelKey,
    undefined,
    codeReviewWindows.fiveHourWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );
  const codeReviewSecondaryWindowMeta = selectCodexSecondaryWindowMeta(
    codeReviewWindows.weeklyWindow,
    WINDOW_META.codeReviewWeekly,
    WINDOW_META.codeReviewMonthly
  );
  addWindow(
    codeReviewSecondaryWindowMeta.id,
    t(codeReviewSecondaryWindowMeta.labelKey),
    codeReviewSecondaryWindowMeta.labelKey,
    undefined,
    codeReviewWindows.weeklyWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );

  const normalizeWindowId = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  if (Array.isArray(additionalRateLimits)) {
    additionalRateLimits.forEach((limitItem, index) => {
      const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
      if (!rateInfo) return;

      const limitName =
        normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
        normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
        `additional-${index + 1}`;

      const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
      const additionalWindows = pickCodexClassifiedWindows(rateInfo);
      const additionalLimitReached = rateInfo.limit_reached ?? rateInfo.limitReached;
      const additionalAllowed = rateInfo.allowed;

      addWindow(
        `${idPrefix}-five-hour-${index}`,
        t('codex_quota.additional_primary_window', { name: limitName }),
        'codex_quota.additional_primary_window',
        { name: limitName },
        additionalWindows.fiveHourWindow,
        additionalLimitReached,
        additionalAllowed
      );
      const additionalSecondaryMeta = selectCodexSecondaryWindowMeta(
        additionalWindows.weeklyWindow,
        { id: 'weekly', labelKey: 'codex_quota.additional_secondary_window' },
        { id: 'monthly', labelKey: 'codex_quota.additional_monthly_window' }
      );
      addWindow(
        `${idPrefix}-${additionalSecondaryMeta.id}-${index}`,
        t(additionalSecondaryMeta.labelKey, { name: limitName }),
        additionalSecondaryMeta.labelKey,
        { name: limitName },
        additionalWindows.weeklyWindow,
        additionalLimitReached,
        additionalAllowed
      );
    });
  }

  return windows;
};

const roundCodexNumber = (value: number, digits = 2): number => {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
};

const metricNumber = (value: unknown): number => normalizeNumberValue(value) ?? 0;

const codexTokenTotal = (metrics?: CodexDailyUsageMetrics | null): number => {
  if (!metrics) return 0;
  const explicit = metricNumber(metrics.text_total_tokens ?? metrics.textTotalTokens);
  if (explicit > 0) return explicit;
  return (
    metricNumber(metrics.cached_text_input_tokens ?? metrics.cachedTextInputTokens) +
    metricNumber(metrics.uncached_text_input_tokens ?? metrics.uncachedTextInputTokens) +
    metricNumber(metrics.text_output_tokens ?? metrics.textOutputTokens)
  );
};

const codexYmdUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const codexFirstDayOfMonthUtc = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

const formatCodexUtcDateTime = (ms: number): string =>
  new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

const normalizeCodexEpochMs = (value: number): number => (value > 1e12 ? value : value * 1000);

const getCodexWindowTiming = (
  window?: CodexUsageWindow | null
): { resetAtMs: number; windowStartMs: number; serverNowMs: number } | null => {
  if (!window) return null;
  const resetAt = normalizeNumberValue(window.reset_at ?? window.resetAt);
  const windowSeconds = getCodexWindowSeconds(window);
  if (resetAt === null || windowSeconds === null) return null;

  const resetAfterSeconds = normalizeNumberValue(
    window.reset_after_seconds ?? window.resetAfterSeconds
  );
  const resetAtMs = normalizeCodexEpochMs(resetAt);
  const windowStartMs = resetAtMs - windowSeconds * 1000;
  const serverNowMs =
    resetAfterSeconds === null ? Date.now() : resetAtMs - resetAfterSeconds * 1000;

  return { resetAtMs, windowStartMs, serverNowMs };
};

const buildCodexClientSummary = (days: CodexDailyUsageDay[]): CodexAnalyticsRange['topClients'] => {
  const clients = new Map<string, CodexAnalyticsClientSummary>();

  for (const day of days) {
    for (const client of day.clients ?? []) {
      const clientId = normalizeStringValue(client.client_id ?? client.clientId) ?? 'UNKNOWN';
      const current =
        clients.get(clientId) ??
        ({
          clientId,
          credits: 0,
          usd: 0,
          tokens: 0,
          threads: 0,
          turns: 0,
        } satisfies CodexAnalyticsClientSummary);

      const credits = metricNumber(client.credits);
      current.credits += credits;
      current.usd += credits * CODEX_USD_PER_CREDIT;
      current.tokens += codexTokenTotal(client);
      current.threads += metricNumber(client.threads);
      current.turns += metricNumber(client.turns);
      clients.set(clientId, current);
    }
  }

  return Array.from(clients.values())
    .map((client) => ({
      ...client,
      credits: roundCodexNumber(client.credits, 6),
      usd: roundCodexNumber(client.usd, 2),
      tokens: Math.round(client.tokens),
      threads: Math.round(client.threads),
      turns: Math.round(client.turns),
    }))
    .sort((left, right) => right.credits - left.credits)
    .slice(0, CODEX_TOP_CLIENT_LIMIT);
};

const buildCodexAnalyticsRange = (
  payload: CodexDailyUsagePayload,
  id: CodexAnalyticsRange['id'],
  labelKey: string,
  startDate: string,
  endDateExclusive: string
): CodexAnalyticsRange => {
  const days = (payload.data ?? [])
    .slice()
    .sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')));

  let credits = 0;
  let cachedInputTokens = 0;
  let uncachedInputTokens = 0;
  let outputTokens = 0;
  let tokens = 0;
  let threads = 0;
  let turns = 0;
  let users = 0;

  for (const day of days) {
    const totals = day.totals ?? {};
    const dayCredits = metricNumber(totals.credits);
    credits += dayCredits;
    cachedInputTokens += metricNumber(
      totals.cached_text_input_tokens ?? totals.cachedTextInputTokens
    );
    uncachedInputTokens += metricNumber(
      totals.uncached_text_input_tokens ?? totals.uncachedTextInputTokens
    );
    outputTokens += metricNumber(totals.text_output_tokens ?? totals.textOutputTokens);
    tokens += codexTokenTotal(totals);
    threads += metricNumber(totals.threads);
    turns += metricNumber(totals.turns);
    users += metricNumber(totals.users);
  }

  return {
    id,
    labelKey,
    startDate,
    endDateExclusive,
    returnedDays: days.length,
    firstDate: days[0]?.date ?? '',
    lastDate: days[days.length - 1]?.date ?? '',
    credits: roundCodexNumber(credits, 6),
    usd: roundCodexNumber(credits * CODEX_USD_PER_CREDIT, 2),
    tokens: Math.round(tokens),
    cachedInputTokens: Math.round(cachedInputTokens),
    uncachedInputTokens: Math.round(uncachedInputTokens),
    outputTokens: Math.round(outputTokens),
    threads: Math.round(threads),
    turns: Math.round(turns),
    users: Math.round(users),
    topClients: buildCodexClientSummary(days),
  };
};

const codexDateToUtcMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

const codexEndDateExclusiveFromInclusive = (endDateInclusive: string): string => {
  const endMs = codexDateToUtcMs(endDateInclusive);
  if (!Number.isFinite(endMs)) return endDateInclusive;
  return codexYmdUtc(endMs + CODEX_DAY_MS);
};

const codexInclusiveWindowDays = (startDate: string, endDateInclusive: string): number => {
  const startMs = codexDateToUtcMs(startDate);
  const endMs = codexDateToUtcMs(endDateInclusive);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 1;
  }
  return Math.max(1, Math.round((endMs - startMs) / CODEX_DAY_MS) + 1);
};

const codexTeamLeaderboardCacheKey = (
  teamAccountId: string,
  startDate: string,
  endDateInclusive: string
): string =>
  [
    teamAccountId,
    startDate,
    endDateInclusive,
    codexInclusiveWindowDays(startDate, endDateInclusive),
  ].join('::');

const readCodexTeamLeaderboardCache = (cacheKey: string): CodexUsageLeaderboardPayload | null => {
  const cached = codexTeamLeaderboardCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > CODEX_TEAM_LEADERBOARD_CACHE_TTL_MS) {
    codexTeamLeaderboardCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
};

const waitForCodexTeamLeaderboardCache = async (
  cacheKey: string
): Promise<CodexUsageLeaderboardPayload | null> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CODEX_TEAM_LEADERBOARD_CACHE_WAIT_MS) {
    const cached = readCodexTeamLeaderboardCache(cacheKey);
    if (cached) return cached;
    await new Promise((resolve) =>
      window.setTimeout(resolve, CODEX_TEAM_LEADERBOARD_CACHE_POLL_MS)
    );
  }
  return readCodexTeamLeaderboardCache(cacheKey);
};

const codexLeaderboardUserLabel = (row: CodexUsageLeaderboardRow): string => {
  const email = normalizeStringValue(row.email);
  const name = normalizeStringValue(row.name);
  const userId = normalizeStringValue(row.user_id ?? row.userId);
  if (name && email) return `${name} <${email}>`;
  return email ?? name ?? userId ?? 'UNKNOWN';
};

const pickCodexLeaderboardUserRow = (
  rows: CodexUsageLeaderboardRow[],
  accountEmail: string | null
): CodexUsageLeaderboardRow | null => {
  const normalizedEmail = normalizeStringValue(accountEmail)?.toLowerCase();
  if (!normalizedEmail) return null;
  return (
    rows.find((row) => normalizeStringValue(row.email)?.toLowerCase() === normalizedEmail) ?? null
  );
};

const buildCodexLeaderboardRange = (
  payload: CodexUsageLeaderboardPayload,
  id: CodexAnalyticsRange['id'],
  labelKey: string,
  startDate: string,
  endDateInclusive: string,
  accountEmail: string | null
): CodexAnalyticsRange => {
  const rows = (payload.data ?? []).slice().sort((left, right) => {
    const leftRank = normalizeNumberValue(left.rank) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = normalizeNumberValue(right.rank) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return metricNumber(right.credits) - metricNumber(left.credits);
  });

  let credits = 0;
  let tokens = 0;
  let threads = 0;
  let turns = 0;

  for (const row of rows) {
    credits += metricNumber(row.credits);
    tokens += metricNumber(row.text_tokens ?? row.textTokens);
    threads += metricNumber(row.n_threads ?? row.nThreads);
    turns += metricNumber(row.n_turns ?? row.nTurns);
  }

  const totalUsers = metricNumber(payload.total_users ?? payload.totalUsers) || rows.length;
  const currentUser = pickCodexLeaderboardUserRow(rows, accountEmail);
  const selectedCredits = currentUser ? metricNumber(currentUser.credits) : credits;
  const selectedTokens = currentUser
    ? metricNumber(currentUser.text_tokens ?? currentUser.textTokens)
    : tokens;
  const selectedThreads = currentUser
    ? metricNumber(currentUser.n_threads ?? currentUser.nThreads)
    : threads;
  const selectedTurns = currentUser
    ? metricNumber(currentUser.n_turns ?? currentUser.nTurns)
    : turns;

  return {
    id,
    labelKey,
    startDate,
    endDateExclusive: codexEndDateExclusiveFromInclusive(endDateInclusive),
    returnedDays: codexInclusiveWindowDays(startDate, endDateInclusive),
    firstDate: startDate,
    lastDate: endDateInclusive,
    credits: roundCodexNumber(selectedCredits, 6),
    usd: roundCodexNumber(selectedCredits * CODEX_USD_PER_CREDIT, 2),
    tokens: Math.round(selectedTokens),
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    threads: Math.round(selectedThreads),
    turns: Math.round(selectedTurns),
    users: Math.round(totalUsers),
    leaderboardTotalCredits: roundCodexNumber(credits, 6),
    leaderboardTotalUsd: roundCodexNumber(credits * CODEX_USD_PER_CREDIT, 2),
    matchedEmail: normalizeStringValue(accountEmail),
    matchedUserFound: Boolean(currentUser),
    topClients: rows.slice(0, CODEX_TOP_CLIENT_LIMIT).map((row) => {
      const rowCredits = metricNumber(row.credits);
      return {
        clientId: codexLeaderboardUserLabel(row),
        credits: roundCodexNumber(rowCredits, 6),
        usd: roundCodexNumber(rowCredits * CODEX_USD_PER_CREDIT, 2),
        tokens: Math.round(metricNumber(row.text_tokens ?? row.textTokens)),
        threads: Math.round(metricNumber(row.n_threads ?? row.nThreads)),
        turns: Math.round(metricNumber(row.n_turns ?? row.nTurns)),
      };
    }),
  };
};

const buildCodexWeeklyEstimate = (
  weeklyWindow: CodexUsageWindow,
  sinceResetRange: CodexAnalyticsRange,
  sinceResetPayload: CodexDailyUsagePayload,
  sinceResetStartDate: string
): CodexWeeklyEstimate | null => {
  const usedPercent = normalizeNumberValue(weeklyWindow.used_percent ?? weeklyWindow.usedPercent);
  if (usedPercent === null || usedPercent <= 0) return null;

  const usedRatio = usedPercent / 100;
  const includedCredits = sinceResetRange.credits;
  const resetDay = (sinceResetPayload.data ?? []).find((day) => day.date === sinceResetStartDate);
  const resetDayCredits = metricNumber(resetDay?.totals?.credits);
  const excludedCredits = Math.max(0, includedCredits - resetDayCredits);
  const totalCreditsWithResetDay = includedCredits / usedRatio;
  const totalCreditsWithoutResetDay = excludedCredits / usedRatio;
  const remainingCreditsWithResetDay = Math.max(0, totalCreditsWithResetDay - includedCredits);
  const remainingCreditsWithoutResetDay = Math.max(
    0,
    totalCreditsWithoutResetDay - excludedCredits
  );

  return {
    usedPercent: roundCodexNumber(usedPercent, 2),
    usedRatio: roundCodexNumber(usedRatio, 4),
    remainingRatio: roundCodexNumber(1 - usedRatio, 4),
    includedCredits: roundCodexNumber(includedCredits, 6),
    resetDayCredits: roundCodexNumber(resetDayCredits, 6),
    excludedCredits: roundCodexNumber(excludedCredits, 6),
    totalCreditsWithResetDay: roundCodexNumber(totalCreditsWithResetDay, 2),
    totalUsdWithResetDay: roundCodexNumber(totalCreditsWithResetDay * CODEX_USD_PER_CREDIT, 2),
    totalCreditsWithoutResetDay: roundCodexNumber(totalCreditsWithoutResetDay, 2),
    totalUsdWithoutResetDay: roundCodexNumber(
      totalCreditsWithoutResetDay * CODEX_USD_PER_CREDIT,
      2
    ),
    remainingCreditsWithResetDay: roundCodexNumber(remainingCreditsWithResetDay, 2),
    remainingUsdWithResetDay: roundCodexNumber(
      remainingCreditsWithResetDay * CODEX_USD_PER_CREDIT,
      2
    ),
    remainingCreditsWithoutResetDay: roundCodexNumber(remainingCreditsWithoutResetDay, 2),
    remainingUsdWithoutResetDay: roundCodexNumber(
      remainingCreditsWithoutResetDay * CODEX_USD_PER_CREDIT,
      2
    ),
    source: 'daily-buckets',
  };
};

const buildCodexWeeklyEstimateFromRange = (
  weeklyWindow: CodexUsageWindow,
  sinceResetRange: CodexAnalyticsRange
): CodexWeeklyEstimate | null => {
  const usedPercent = normalizeNumberValue(weeklyWindow.used_percent ?? weeklyWindow.usedPercent);
  if (usedPercent === null || usedPercent <= 0) return null;

  const usedRatio = usedPercent / 100;
  const includedCredits = sinceResetRange.credits;
  const totalCredits = includedCredits / usedRatio;
  const remainingCredits = Math.max(0, totalCredits - includedCredits);

  return {
    usedPercent: roundCodexNumber(usedPercent, 2),
    usedRatio: roundCodexNumber(usedRatio, 4),
    remainingRatio: roundCodexNumber(1 - usedRatio, 4),
    includedCredits: roundCodexNumber(includedCredits, 6),
    resetDayCredits: 0,
    excludedCredits: roundCodexNumber(includedCredits, 6),
    totalCreditsWithResetDay: roundCodexNumber(totalCredits, 2),
    totalUsdWithResetDay: roundCodexNumber(totalCredits * CODEX_USD_PER_CREDIT, 2),
    totalCreditsWithoutResetDay: roundCodexNumber(totalCredits, 2),
    totalUsdWithoutResetDay: roundCodexNumber(totalCredits * CODEX_USD_PER_CREDIT, 2),
    remainingCreditsWithResetDay: roundCodexNumber(remainingCredits, 2),
    remainingUsdWithResetDay: roundCodexNumber(remainingCredits * CODEX_USD_PER_CREDIT, 2),
    remainingCreditsWithoutResetDay: roundCodexNumber(remainingCredits, 2),
    remainingUsdWithoutResetDay: roundCodexNumber(remainingCredits * CODEX_USD_PER_CREDIT, 2),
    source: 'leaderboard-range',
  };
};

const fetchCodexDailyUsage = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  startDate: string,
  endDateExclusive: string,
  t: TFunction
): Promise<CodexDailyUsagePayload> => {
  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDateExclusive,
    group_by: 'day',
  });

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: `${CODEX_DAILY_USAGE_URL}?${query.toString()}`,
    header: requestHeader,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexDailyUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.analytics_empty'));
  }

  return payload;
};

const fetchCodexUsageLeaderboard = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  teamAccountId: string,
  startDate: string,
  endDateInclusive: string,
  t: TFunction
): Promise<CodexUsageLeaderboardPayload> => {
  const cacheKey = codexTeamLeaderboardCacheKey(teamAccountId, startDate, endDateInclusive);
  const cached = readCodexTeamLeaderboardCache(cacheKey);
  if (cached) return cached;

  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDateInclusive,
    window_days: String(codexInclusiveWindowDays(startDate, endDateInclusive)),
    page: '1',
    page_size: '50',
    client_filter: 'all',
    sort_by: 'credits',
    sort_direction: 'desc',
  });

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: `${CODEX_TEAM_USAGE_LEADERBOARD_URL}?${query.toString()}`,
    header: requestHeader,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    if (CODEX_TEAM_PERMISSION_STATUSES.has(result.statusCode)) {
      const delayedCached = await waitForCodexTeamLeaderboardCache(cacheKey);
      if (delayedCached) return delayedCached;
      throw createStatusError(t('codex_quota.team_analytics_permission_denied'), result.statusCode);
    }
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsageLeaderboardPayload(result.body ?? result.bodyText);
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error(t('codex_quota.team_analytics_empty'));
  }

  codexTeamLeaderboardCache.set(cacheKey, {
    fetchedAt: Date.now(),
    sourceAuthIndex: authIndex,
    payload,
  });

  return payload;
};

const getErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const resolveCodexRequestErrorMessage = (
  err: unknown,
  planType: string | null,
  scope: 'quota' | 'analytics',
  t: TFunction
): string => {
  const status = getStatusFromError(err);
  const normalizedPlanType = normalizePlanType(planType);

  if (status === 401) return t('codex_quota.auth_required');
  if (status === 403) {
    if (normalizedPlanType === 'team') {
      return t(`codex_quota.${scope}_team_permission_hint`);
    }
    return t(`codex_quota.${scope}_permission_hint`);
  }
  if (status === 404) return t(`codex_quota.${scope}_unsupported_hint`);
  if (status === 429) return t('codex_quota.rate_limited');
  if (status !== undefined && status >= 500) return t('codex_quota.upstream_unavailable');

  return getErrorMessage(err, t('common.unknown_error'));
};

const fetchCodexAnalytics = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  usagePayload: CodexUsagePayload,
  planType: string | null,
  t: TFunction
): Promise<CodexAnalyticsState> => {
  const rateLimit = usagePayload.rate_limit ?? usagePayload.rateLimit ?? null;
  const weeklyWindow = pickCodexClassifiedWindows(rateLimit).weeklyWindow;
  const timing = getCodexWindowTiming(weeklyWindow);
  if (!weeklyWindow || !timing) {
    throw new Error(t('codex_quota.analytics_missing_weekly_window'));
  }

  const apiNowMs = timing.serverNowMs;
  const endDateExclusive = codexYmdUtc(apiNowMs + CODEX_DAY_MS);
  const sinceResetStartDate = codexYmdUtc(timing.windowStartMs);
  const monthStartDate = codexFirstDayOfMonthUtc(apiNowMs);
  const rollingStartDate = codexYmdUtc(
    apiNowMs - (CODEX_ANALYTICS_ROLLING_DAYS - 1) * CODEX_DAY_MS
  );

  try {
    const sinceResetPayload = await fetchCodexDailyUsage(
      authIndex,
      requestHeader,
      sinceResetStartDate,
      endDateExclusive,
      t
    );
    const monthPayload = await fetchCodexDailyUsage(
      authIndex,
      requestHeader,
      monthStartDate,
      endDateExclusive,
      t
    );
    const rollingPayload = await fetchCodexDailyUsage(
      authIndex,
      requestHeader,
      rollingStartDate,
      endDateExclusive,
      t
    );

    const sinceResetRange = buildCodexAnalyticsRange(
      sinceResetPayload,
      'since-reset',
      'codex_quota.analytics_since_reset',
      sinceResetStartDate,
      endDateExclusive
    );
    const monthRange = buildCodexAnalyticsRange(
      monthPayload,
      'month-to-date',
      'codex_quota.analytics_month_to_date',
      monthStartDate,
      endDateExclusive
    );
    const rollingRange = buildCodexAnalyticsRange(
      rollingPayload,
      'rolling',
      'codex_quota.analytics_rolling_days',
      rollingStartDate,
      endDateExclusive
    );

    return {
      dateBucket: 'UTC',
      source: 'daily-workspace',
      backendNowLabel: formatCodexUtcDateTime(apiNowMs),
      windowStartLabel: formatCodexUtcDateTime(timing.windowStartMs),
      resetAtLabel: formatCodexUtcDateTime(timing.resetAtMs),
      weeklyEstimate: buildCodexWeeklyEstimate(
        weeklyWindow,
        sinceResetRange,
        sinceResetPayload,
        sinceResetStartDate
      ),
      ranges: [sinceResetRange, monthRange, rollingRange],
    };
  } catch (err: unknown) {
    throw new Error(resolveCodexRequestErrorMessage(err, planType, 'analytics', t));
  }
};

const fetchCodexTeamAnalytics = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  usagePayload: CodexUsagePayload,
  teamAccountId: string,
  accountEmail: string | null,
  t: TFunction
): Promise<CodexAnalyticsState> => {
  const rateLimit = usagePayload.rate_limit ?? usagePayload.rateLimit ?? null;
  const weeklyWindow = pickCodexClassifiedWindows(rateLimit).weeklyWindow;
  const timing = getCodexWindowTiming(weeklyWindow);
  if (!weeklyWindow || !timing) {
    throw new Error(t('codex_quota.analytics_missing_weekly_window'));
  }

  const apiNowMs = timing.serverNowMs;
  const endDateInclusive = codexYmdUtc(apiNowMs);
  const sinceResetStartDate = codexYmdUtc(timing.windowStartMs);
  const monthStartDate = codexFirstDayOfMonthUtc(apiNowMs);
  const rollingStartDate = codexYmdUtc(
    apiNowMs - (CODEX_ANALYTICS_ROLLING_DAYS - 1) * CODEX_DAY_MS
  );

  const [sinceResetPayload, monthPayload, rollingPayload] = await Promise.all([
    fetchCodexUsageLeaderboard(
      authIndex,
      requestHeader,
      teamAccountId,
      sinceResetStartDate,
      endDateInclusive,
      t
    ),
    fetchCodexUsageLeaderboard(
      authIndex,
      requestHeader,
      teamAccountId,
      monthStartDate,
      endDateInclusive,
      t
    ),
    fetchCodexUsageLeaderboard(
      authIndex,
      requestHeader,
      teamAccountId,
      rollingStartDate,
      endDateInclusive,
      t
    ),
  ]);

  const sinceResetRange = buildCodexLeaderboardRange(
    sinceResetPayload,
    'since-reset',
    'codex_quota.analytics_since_reset',
    sinceResetStartDate,
    endDateInclusive,
    accountEmail
  );
  const monthRange = buildCodexLeaderboardRange(
    monthPayload,
    'month-to-date',
    'codex_quota.analytics_month_to_date',
    monthStartDate,
    endDateInclusive,
    accountEmail
  );
  const rollingRange = buildCodexLeaderboardRange(
    rollingPayload,
    'rolling',
    'codex_quota.analytics_rolling_days',
    rollingStartDate,
    endDateInclusive,
    accountEmail
  );
  const ranges = [sinceResetRange, monthRange, rollingRange];

  if (accountEmail && !ranges.some((range) => range.matchedUserFound)) {
    throw new Error(t('codex_quota.team_analytics_user_missing', { email: accountEmail }));
  }

  return {
    dateBucket: 'UTC',
    source: 'team-leaderboard',
    backendNowLabel: formatCodexUtcDateTime(apiNowMs),
    windowStartLabel: formatCodexUtcDateTime(timing.windowStartMs),
    resetAtLabel: formatCodexUtcDateTime(timing.resetAtMs),
    weeklyEstimate: buildCodexWeeklyEstimateFromRange(weeklyWindow, sinceResetRange),
    ranges,
  };
};

const fetchCodexTeamAnalyticsWithFallback = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  usagePayload: CodexUsagePayload,
  teamAccountId: string,
  accountEmail: string | null,
  t: TFunction
): Promise<{ analytics: CodexAnalyticsState | null; analyticsError: string | null }> => {
  let leaderboardError = '';

  try {
    return {
      analytics: await fetchCodexTeamAnalytics(
        authIndex,
        requestHeader,
        usagePayload,
        teamAccountId,
        accountEmail,
        t
      ),
      analyticsError: null,
    };
  } catch (err: unknown) {
    leaderboardError = err instanceof Error ? err.message : t('common.unknown_error');
  }

  try {
    const fallback = await fetchCodexAnalytics(authIndex, requestHeader, usagePayload, 'team', t);
    const hasData = fallback.ranges.some((range) => range.returnedDays > 0);
    if (!hasData) {
      throw new Error(t('codex_quota.analytics_empty'));
    }

    return {
      analytics: {
        ...fallback,
        source: 'daily-workspace-fallback',
        fallbackReason: leaderboardError,
      },
      analyticsError: t('codex_quota.team_analytics_fallback', { message: leaderboardError }),
    };
  } catch (fallbackErr: unknown) {
    const fallbackMessage =
      fallbackErr instanceof Error ? fallbackErr.message : t('common.unknown_error');
    return {
      analytics: null,
      analyticsError: t('codex_quota.team_analytics_fallback_failed', {
        message: leaderboardError,
        fallback: fallbackMessage,
      }),
    };
  }
};

const fetchCodexQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  planType: string | null;
  accountEmail: string | null;
  subscriptionActiveUntil: string | number | null;
  rateLimitResetCreditsAvailableCount: number | null;
  windows: CodexQuotaWindow[];
  analytics: CodexAnalyticsState | null;
  analyticsError: string | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const planTypeFromFile = resolveCodexPlanType(file);
  const subscriptionActiveUntil = resolveCodexSubscriptionActiveUntil(file);
  const accountId = resolveCodexChatgptAccountId(file);

  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  };
  if (accountId) {
    requestHeader['Chatgpt-Account-Id'] = accountId;
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: requestHeader,
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const error = createStatusError(getApiCallErrorMessage(result), result.statusCode);
    throw new Error(resolveCodexRequestErrorMessage(error, planTypeFromFile, 'quota', t));
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('codex_quota.empty_windows'));
  }

  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const resetCredits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits ?? null;
  const rateLimitResetCreditsAvailableCount = normalizeNumberValue(
    resetCredits?.available_count ?? resetCredits?.availableCount
  );
  const accountEmail = normalizeStringValue(payload.email);
  const teamAccountId = normalizeStringValue(payload.account_id ?? payload.accountId) ?? accountId;
  const resolvedPlanType = planTypeFromUsage ?? planTypeFromFile;
  const windows = buildCodexQuotaWindows(payload, t);
  let analytics: CodexAnalyticsState | null = null;
  let analyticsError: string | null = null;

  try {
    if (normalizePlanType(resolvedPlanType) === 'team' && teamAccountId) {
      const teamAnalytics = await fetchCodexTeamAnalyticsWithFallback(
        authIndex,
        requestHeader,
        payload,
        teamAccountId,
        accountEmail,
        t
      );
      analytics = teamAnalytics.analytics;
      analyticsError = teamAnalytics.analyticsError;
    } else {
      analytics = await fetchCodexAnalytics(authIndex, requestHeader, payload, resolvedPlanType, t);
    }
  } catch (err: unknown) {
    analyticsError = getErrorMessage(err, t('common.unknown_error'));
  }

  return {
    planType: resolvedPlanType,
    accountEmail,
    subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount,
    windows,
    analytics,
    analyticsError,
  };
};

const createCodexRedeemRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const segment = char === 'x' ? value : (value & 0x3) | 0x8;
    return segment.toString(16);
  });
};

const consumeCodexRateLimitResetCredit = async (
  file: AuthFileItem,
  t: TFunction
): Promise<void> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const accountId = resolveCodexChatgptAccountId(file);
  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  };
  if (accountId) {
    requestHeader['Chatgpt-Account-Id'] = accountId;
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header: requestHeader,
    data: JSON.stringify({
      redeem_request_id: createCodexRedeemRequestId(),
    }),
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }
};

const resetCodexQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  planType: string | null;
  accountEmail: string | null;
  subscriptionActiveUntil: string | number | null;
  rateLimitResetCreditsAvailableCount: number | null;
  windows: CodexQuotaWindow[];
  analytics: CodexAnalyticsState | null;
  analyticsError: string | null;
}> => {
  await consumeCodexRateLimitResetCredit(file, t);
  return fetchCodexQuota(file, t);
};

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);
const CODEX_STANDARD_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const formatCodexPlainIntegerNumber = (value: number): string => String(Math.round(value));

const formatCodexStandardNumber = (value: number): string =>
  CODEX_STANDARD_NUMBER_FORMATTER.format(value);

const formatCodexUsd = (value: number): string => `$${value.toFixed(2)}`;

const formatCodexAnalyticsDateRange = (range: CodexAnalyticsRange): string => {
  const endMs = Date.parse(`${range.endDateExclusive}T00:00:00Z`);
  if (!Number.isFinite(endMs)) {
    return `${range.startDate} - ${range.endDateExclusive}`;
  }
  return `${range.startDate} - ${codexYmdUtc(endMs - CODEX_DAY_MS)}`;
};

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;
  const accountEmail = normalizeStringValue(quota.accountEmail);
  const subscriptionActiveUntil = quota.subscriptionActiveUntil ?? null;
  const rateLimitResetCreditsAvailableCount = quota.rateLimitResetCreditsAvailableCount ?? null;

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'pro') return t('codex_quota.plan_pro');
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
      return t('codex_quota.plan_prolite');
    }
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isPremiumPlan = PREMIUM_CODEX_PLAN_TYPES.has(normalizePlanType(planType) ?? '');
  const expiryLabel = subscriptionActiveUntil ? formatUnixTimestamp(subscriptionActiveUntil) : '';
  const nodes: ReactNode[] = [];
  const analytics = quota.analytics ?? null;
  const analyticsError = quota.analyticsError ?? null;
  const analyticsDetailNodes: ReactNode[] = [];
  const creditsUnit = t('codex_quota.credits_unit');
  const weeklyEstimate = analytics?.weeklyEstimate ?? null;
  const isLeaderboardEstimate = weeklyEstimate?.source === 'leaderboard-range';
  const weeklyInlineEstimate = weeklyEstimate
    ? t('codex_quota.weekly_estimate_inline', {
        total: formatCodexPlainIntegerNumber(weeklyEstimate.totalCreditsWithResetDay),
      })
    : null;
  const weeklyUsdInlineEstimate = weeklyEstimate
    ? t('codex_quota.weekly_estimate_usd_inline', {
        usd: formatCodexPlainIntegerNumber(weeklyEstimate.totalUsdWithResetDay),
      })
    : null;
  const weeklyInlineEstimateTitle = weeklyEstimate
    ? isLeaderboardEstimate
      ? t('codex_quota.weekly_estimate_leaderboard_title', {
          email: accountEmail ?? '-',
          used: formatCodexStandardNumber(weeklyEstimate.includedCredits),
          total: formatCodexStandardNumber(weeklyEstimate.totalCreditsWithResetDay),
        })
      : t('codex_quota.weekly_estimate_inline_title', {
          withoutResetDay: formatCodexPlainIntegerNumber(
            weeklyEstimate.totalCreditsWithoutResetDay
          ),
          withResetDay: formatCodexPlainIntegerNumber(weeklyEstimate.totalCreditsWithResetDay),
        })
    : null;

  const renderCodexMetric = (
    key: string,
    label: string,
    value: string,
    tone?: 'strong'
  ): ReactNode =>
    h(
      'div',
      { key, className: styleMap.codexMetric },
      h('span', { className: styleMap.codexMetricLabel }, label),
      h(
        'span',
        {
          className:
            tone === 'strong'
              ? `${styleMap.codexMetricValue} ${styleMap.codexMetricValueStrong}`
              : styleMap.codexMetricValue,
        },
        value
      )
    );

  if (planLabel || expiryLabel || rateLimitResetCreditsAvailableCount !== null) {
    const valueClass = isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    const planNodes: ReactNode[] = [];
    const appendSeparator = (key: string) => {
      if (planNodes.length === 0) return;
      planNodes.push(
        h('span', {
          key,
          className: styleMap.codexPlanSeparator,
        })
      );
    };

    if (planLabel) {
      planNodes.push(
        h(
          'span',
          { key: 'plan-label', className: styleMap.codexPlanLabel },
          t('codex_quota.plan_label')
        ),
        h('span', { key: 'plan-value', className: valueClass }, planLabel)
      );
    }

    if (expiryLabel) {
      appendSeparator('subscription-expiry-separator');
      planNodes.push(
        h(
          'span',
          { key: 'subscription-expiry-label', className: styleMap.codexPlanLabel },
          t('codex_quota.expires_label')
        ),
        h(
          'span',
          { key: 'subscription-expiry-value', className: styleMap.codexPlanValue },
          expiryLabel
        )
      );
    }

    if (rateLimitResetCreditsAvailableCount !== null) {
      appendSeparator('reset-credits-separator');
      planNodes.push(
        h(
          'span',
          { key: 'reset-credits-label', className: styleMap.codexPlanLabel },
          t('codex_quota.reset_credits_label')
        ),
        h(
          'span',
          { key: 'reset-credits-value', className: styleMap.codexPlanValue },
          rateLimitResetCreditsAvailableCount.toString()
        )
      );
    }

    if (weeklyUsdInlineEstimate) {
      planNodes.push(
        h(
          'span',
          {
            key: 'weekly-estimate',
            className: styleMap.codexPlanEstimate,
            title: weeklyInlineEstimateTitle ?? undefined,
          },
          weeklyUsdInlineEstimate
        )
      );
    }

    nodes.push(h('div', { key: 'plan', className: styleMap.codexPlan }, ...planNodes));
  }

  if (accountEmail) {
    nodes.push(
      h(
        'div',
        { key: 'account-email', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('codex_quota.account_label')),
        h('span', { className: styleMap.codexPlanValue }, accountEmail)
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('codex_quota.empty_windows'))
    );
  } else {
    nodes.push(
      ...windows.map((window) => {
        const used = window.usedPercent;
        const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
        const remaining =
          clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
        const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
        const windowLabel = window.labelKey
          ? t(window.labelKey, window.labelParams as Record<string, string | number>)
          : window.label;
        const windowLabelNode =
          window.id === 'weekly' && weeklyInlineEstimate
            ? h(
                'span',
                { className: styleMap.codexQuotaLabel },
                h('span', { className: styleMap.codexQuotaLabelText }, windowLabel),
                h(
                  'span',
                  {
                    className: styleMap.codexWeeklyInlineEstimate,
                    title: weeklyInlineEstimateTitle ?? undefined,
                  },
                  weeklyInlineEstimate
                )
              )
            : windowLabel;

        return h(
          'div',
          { key: window.id, className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, windowLabelNode),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, percentLabel),
              h('span', { className: styleMap.quotaReset }, window.resetLabel)
            )
          ),
          h(QuotaProgressBar, {
            percent: remaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        );
      })
    );
  }

  if (analyticsError) {
    analyticsDetailNodes.push(
      h(
        'div',
        { key: 'analytics-error', className: styleMap.quotaWarning },
        t('codex_quota.analytics_load_failed', { message: analyticsError })
      )
    );
  }

  if (analytics) {
    analyticsDetailNodes.push(
      h(
        'div',
        { key: 'analytics', className: styleMap.codexAnalytics },
        h(
          'div',
          { className: styleMap.codexAnalyticsHeader },
          h('span', { className: styleMap.codexAnalyticsTitle }, t('codex_quota.analytics_title')),
          h(
            'span',
            { className: styleMap.codexAnalyticsMeta },
            t(
              analytics.source === 'team-leaderboard'
                ? 'codex_quota.team_analytics_bucket'
                : analytics.source === 'daily-workspace-fallback'
                  ? 'codex_quota.team_analytics_fallback_bucket'
                  : 'codex_quota.analytics_bucket',
              { bucket: analytics.dateBucket }
            )
          )
        ),
        h(
          'div',
          { className: styleMap.codexWindowFacts },
          h(
            'span',
            null,
            t('codex_quota.analytics_backend_now', { time: analytics.backendNowLabel })
          ),
          h(
            'span',
            null,
            t('codex_quota.analytics_window_start', { time: analytics.windowStartLabel })
          ),
          h('span', null, t('codex_quota.analytics_reset_at', { time: analytics.resetAtLabel }))
        ),
        h(
          'div',
          { className: styleMap.codexUsageRanges },
          ...analytics.ranges.map((range) => {
            const rangeLabel =
              range.id === 'rolling'
                ? t(range.labelKey, { days: CODEX_ANALYTICS_ROLLING_DAYS })
                : t(range.labelKey);
            const dateLabel = formatCodexAnalyticsDateRange(range);
            const isLeaderboardRange = range.leaderboardTotalCredits !== undefined;

            return h(
              'div',
              { key: range.id, className: styleMap.codexUsageRange },
              h(
                'div',
                { className: styleMap.codexUsageRangeHeader },
                h('span', { className: styleMap.codexUsageRangeTitle }, rangeLabel),
                h('span', { className: styleMap.codexUsageRangeDates }, dateLabel)
              ),
              h(
                'div',
                { className: styleMap.codexMetricGrid },
                renderCodexMetric(
                  `${range.id}-credits`,
                  isLeaderboardRange
                    ? t('codex_quota.analytics_user_credits')
                    : t('codex_quota.analytics_credits'),
                  `${formatCodexStandardNumber(range.credits)} ${creditsUnit}`,
                  'strong'
                ),
                renderCodexMetric(
                  `${range.id}-usd`,
                  t('codex_quota.analytics_usd'),
                  formatCodexUsd(range.usd)
                ),
                isLeaderboardRange
                  ? renderCodexMetric(
                      `${range.id}-workspace-credits`,
                      t('codex_quota.analytics_workspace_credits'),
                      `${formatCodexStandardNumber(range.leaderboardTotalCredits ?? 0)} ${creditsUnit}`
                    )
                  : null
              )
            );
          })
        )
      )
    );
  }

  if (analyticsDetailNodes.length > 0) {
    nodes.push(
      h(
        'details',
        { key: 'analytics-details', className: styleMap.codexDetails },
        h(
          'summary',
          { className: styleMap.codexDetailsSummary },
          h(
            'span',
            { className: styleMap.codexDetailsSummaryMain },
            h(
              'span',
              { className: styleMap.codexDetailsIcon, 'aria-hidden': true },
              h(IconInfo, { size: 13 })
            ),
            h(
              'span',
              { className: styleMap.codexDetailsTitle },
              t('codex_quota.analytics_details_summary')
            )
          ),
          h(
            'span',
            { className: styleMap.codexDetailsHint },
            t('codex_quota.analytics_details_hint')
          ),
          h(IconChevronDown, { size: 14, className: styleMap.codexDetailsChevron })
        ),
        h('div', { className: styleMap.codexDetailsBody }, ...analyticsDetailNodes)
      )
    );
  }

  return h(Fragment, null, ...nodes);
};

export const CODEX_CONFIG: QuotaConfig<
  CodexQuotaState,
  {
    planType: string | null;
    accountEmail: string | null;
    subscriptionActiveUntil: string | number | null;
    rateLimitResetCreditsAvailableCount: number | null;
    windows: CodexQuotaWindow[];
    analytics: CodexAnalyticsState | null;
    analyticsError: string | null;
  }
> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isCodexFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCodexQuota,
  resetQuota: resetCodexQuota,
  canResetQuota: (quota) => (quota.rateLimitResetCreditsAvailableCount ?? 0) > 0,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  batchConcurrency: CODEX_BATCH_CONCURRENCY,
  batchDelayMs: CODEX_BATCH_DELAY_MS,
  buildLoadingState: () => ({
    status: 'loading',
    windows: [],
    analytics: null,
    analyticsError: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    planType: data.planType,
    accountEmail: data.accountEmail,
    subscriptionActiveUntil: data.subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount: data.rateLimitResetCreditsAvailableCount,
    analytics: data.analytics,
    analyticsError: data.analyticsError,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    analytics: null,
    analyticsError: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems,
};
