/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { IconChevronDown, IconInfo } from '@/components/ui/icons';
import type {
  AntigravityQuotaGroup,
  AntigravityModelsPayload,
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
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
  GeminiCliCodeAssistPayload,
  GeminiCliCredits,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState,
  GeminiCliUserTier,
  KimiQuotaRow,
  KimiQuotaState,
} from '@/types';
import { apiCallApi, authFilesApi, getApiCallErrorMessage } from '@/services/api';
import { useQuotaStore } from '@/stores';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  CODEX_ANALYTICS_ROLLING_DAYS,
  CODEX_DAILY_USAGE_URL,
  CODEX_TEAM_USAGE_LEADERBOARD_URL,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  CODEX_USD_PER_CREDIT,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  normalizeGeminiCliModelId,
  normalizeNumberValue,
  normalizePlanType,
  normalizeQuotaFraction,
  normalizeStringValue,
  parseAntigravityPayload,
  parseClaudeUsagePayload,
  parseCodexDailyUsagePayload,
  parseCodexUsageLeaderboardPayload,
  parseCodexUsagePayload,
  parseGeminiCliQuotaPayload,
  parseGeminiCliCodeAssistPayload,
  parseKimiUsagePayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveGeminiCliProjectId,
  formatCodexResetLabel,
  formatQuotaResetTime,
  formatKimiResetHint,
  buildAntigravityQuotaGroups,
  buildGeminiCliQuotaBuckets,
  buildKimiQuotaRows,
  createStatusError,
  getStatusFromError,
  isAntigravityFile,
  isClaudeFile,
  isCodexFile,
  isDisabledAuthFile,
  isGeminiCliFile,
  isKimiFile,
  isRuntimeOnlyAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'claude' | 'codex' | 'gemini-cli' | 'kimi';

const DEFAULT_ANTIGRAVITY_PROJECT_ID = 'bamboo-precept-lgxtn';
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
const geminiCliSupplementaryRequestIds = new Map<string, number>();
const geminiCliSupplementaryCache = new Map<
  string,
  {
    requestId: number;
    tierLabel: string | null;
    tierId: string | null;
    creditBalance: number | null;
  }
>();
const codexTeamLeaderboardCache = new Map<
  string,
  {
    fetchedAt: number;
    sourceAuthIndex: string;
    payload: CodexUsageLeaderboardPayload;
  }
>();

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  batchConcurrency?: number;
  batchDelayMs?: number;
  cardClassName: string;
  controlsClassName: string;
  controlClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return DEFAULT_ANTIGRAVITY_PROJECT_ID;

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return DEFAULT_ANTIGRAVITY_PROJECT_ID;
  }

  return DEFAULT_ANTIGRAVITY_PROJECT_ID;
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaGroup[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  const requestBody = JSON.stringify({ project: projectId });

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(result.body ?? result.bodyText);
      const models = payload?.models;
      if (!models || typeof models !== 'object' || Array.isArray(models)) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(models as AntigravityModelsPayload);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return groups;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      if (status) {
        lastStatus = status;
        if (status === 403 || status === 404) {
          priorityStatus ??= status;
        }
      }
    }
  }

  if (hadSuccess) {
    return [];
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const getCodexWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
  if (!window) return null;
  return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
};

const isCodexMonthlyWindow = (window?: CodexUsageWindow | null): boolean => {
  const seconds = getCodexWindowSeconds(window);
  return seconds !== null && seconds >= CODEX_MIN_MONTH_SECONDS && seconds <= CODEX_MAX_MONTH_SECONDS;
};

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
    codeReviewFiveHour: {
      id: 'code-review-five-hour',
      labelKey: 'codex_quota.code_review_primary_window',
    },
    codeReviewWeekly: {
      id: 'code-review-weekly',
      labelKey: 'codex_quota.code_review_secondary_window',
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
  addWindow(
    WINDOW_META.codeWeekly.id,
    t(WINDOW_META.codeWeekly.labelKey),
    WINDOW_META.codeWeekly.labelKey,
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
  addWindow(
    WINDOW_META.codeReviewWeekly.id,
    t(WINDOW_META.codeReviewWeekly.labelKey),
    WINDOW_META.codeReviewWeekly.labelKey,
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
      addWindow(
        `${idPrefix}-weekly-${index}`,
        t('codex_quota.additional_secondary_window', { name: limitName }),
        'codex_quota.additional_secondary_window',
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
    await new Promise((resolve) => window.setTimeout(resolve, CODEX_TEAM_LEADERBOARD_CACHE_POLL_MS));
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
  return rows.find((row) => normalizeStringValue(row.email)?.toLowerCase() === normalizedEmail) ?? null;
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
    windows,
    analytics,
    analyticsError,
  };
};

const GEMINI_CLI_G1_CREDIT_TYPE = 'GOOGLE_ONE_AI';

const GEMINI_CLI_TIER_LABELS: Record<string, string> = {
  'free-tier': 'tier_free',
  'legacy-tier': 'tier_legacy',
  'standard-tier': 'tier_standard',
  'g1-pro-tier': 'tier_pro',
  'g1-ultra-tier': 'tier_ultra',
};

const resolveGeminiCliTierLabel = (
  payload: GeminiCliCodeAssistPayload | null,
  t: TFunction
): string | null => {
  if (!payload) return null;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  if (!rawId) return null;
  const tierId = rawId.toLowerCase();
  const labelKey = GEMINI_CLI_TIER_LABELS[tierId];
  return labelKey ? t(`gemini_cli_quota.${labelKey}`) : rawId;
};

const resolveGeminiCliTierId = (payload: GeminiCliCodeAssistPayload | null): string | null => {
  if (!payload) return null;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  return rawId ? rawId.toLowerCase() : null;
};

const resolveGeminiCliCreditBalance = (
  payload: GeminiCliCodeAssistPayload | null
): number | null => {
  if (!payload) return null;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const tier = paidTier ?? currentTier;
  if (!tier) return null;
  const credits: GeminiCliCredits[] = tier.availableCredits ?? tier.available_credits ?? [];
  let total = 0;
  let found = false;
  for (const credit of credits) {
    const creditType = normalizeStringValue(credit.creditType ?? credit.credit_type);
    if (creditType !== GEMINI_CLI_G1_CREDIT_TYPE) continue;
    const amount = normalizeNumberValue(credit.creditAmount ?? credit.credit_amount);
    if (amount !== null) {
      total += amount;
      found = true;
    }
  }
  return found ? total : null;
};

const fetchGeminiCliCodeAssist = async (
  authIndex: string,
  projectId: string,
  t: TFunction
): Promise<{ tierLabel: string | null; tierId: string | null; creditBalance: number | null }> => {
  try {
    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: GEMINI_CLI_CODE_ASSIST_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
          duetProject: projectId,
        },
      }),
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { tierLabel: null, tierId: null, creditBalance: null };
    }

    const payload = parseGeminiCliCodeAssistPayload(result.body ?? result.bodyText);
    return {
      tierLabel: resolveGeminiCliTierLabel(payload, t),
      tierId: resolveGeminiCliTierId(payload),
      creditBalance: resolveGeminiCliCreditBalance(payload),
    };
  } catch {
    return { tierLabel: null, tierId: null, creditBalance: null };
  }
};

const readGeminiCliSupplementarySnapshot = (
  fileName: string,
  requestId: number
): { tierLabel: string | null; tierId: string | null; creditBalance: number | null } => {
  const cached = geminiCliSupplementaryCache.get(fileName);
  if (!cached || cached.requestId !== requestId) {
    return { tierLabel: null, tierId: null, creditBalance: null };
  }

  return {
    tierLabel: cached.tierLabel,
    tierId: cached.tierId,
    creditBalance: cached.creditBalance,
  };
};

const scheduleGeminiCliSupplementaryRefresh = (
  fileName: string,
  authIndex: string,
  projectId: string,
  t: TFunction
): number => {
  const requestId = (geminiCliSupplementaryRequestIds.get(fileName) ?? 0) + 1;
  geminiCliSupplementaryRequestIds.set(fileName, requestId);
  geminiCliSupplementaryCache.delete(fileName);

  void (async () => {
    const supplementary = await fetchGeminiCliCodeAssist(authIndex, projectId, t);
    if (geminiCliSupplementaryRequestIds.get(fileName) !== requestId) {
      return;
    }

    geminiCliSupplementaryCache.set(fileName, { requestId, ...supplementary });

    useQuotaStore.getState().setGeminiCliQuota((prev) => {
      const current = prev[fileName];
      if (!current || current.status !== 'success') {
        return prev;
      }

      if (
        current.tierLabel === supplementary.tierLabel &&
        current.tierId === supplementary.tierId &&
        current.creditBalance === supplementary.creditBalance
      ) {
        return prev;
      }

      return {
        ...prev,
        [fileName]: {
          ...current,
          tierLabel: supplementary.tierLabel,
          tierId: supplementary.tierId,
          creditBalance: supplementary.creditBalance,
        },
      };
    });
  })();

  return requestId;
};

const fetchGeminiCliQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  fileName: string;
  supplementaryRequestId: number;
  buckets: GeminiCliQuotaBucketState[];
  tierLabel: string | null;
  tierId: string | null;
  creditBalance: number | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('gemini_cli_quota.missing_auth_index'));
  }

  const projectId = resolveGeminiCliProjectId(file);
  if (!projectId) {
    throw new Error(t('gemini_cli_quota.missing_project_id'));
  }

  const quotaResponse = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: GEMINI_CLI_QUOTA_URL,
    header: { ...GEMINI_CLI_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId }),
  });
  if (quotaResponse.statusCode < 200 || quotaResponse.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(quotaResponse), quotaResponse.statusCode);
  }

  const payload = parseGeminiCliQuotaPayload(quotaResponse.body ?? quotaResponse.bodyText);
  const buckets = Array.isArray(payload?.buckets) ? payload?.buckets : [];

  const parsedBuckets = buckets
    .map((bucket) => {
      const modelId = normalizeGeminiCliModelId(bucket.modelId ?? bucket.model_id);
      if (!modelId) return null;
      const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingAmount = normalizeNumberValue(
        bucket.remainingAmount ?? bucket.remaining_amount
      );
      const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
      let fallbackFraction: number | null = null;
      if (remainingAmount !== null) {
        fallbackFraction = remainingAmount <= 0 ? 0 : null;
      } else if (resetTime) {
        fallbackFraction = 0;
      }
      const remainingFraction = remainingFractionRaw ?? fallbackFraction;
      return {
        modelId,
        tokenType,
        remainingFraction,
        remainingAmount,
        resetTime,
      };
    })
    .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

  const builtBuckets = buildGeminiCliQuotaBuckets(parsedBuckets);
  const supplementaryRequestId = scheduleGeminiCliSupplementaryRefresh(
    file.name,
    authIndex,
    projectId,
    t
  );
  const supplementarySnapshot = readGeminiCliSupplementarySnapshot(
    file.name,
    supplementaryRequestId
  );

  return {
    fileName: file.name,
    supplementaryRequestId,
    buckets: builtBuckets,
    tierLabel: supplementarySnapshot.tierLabel,
    tierId: supplementarySnapshot.tierId,
    creditBalance: supplementarySnapshot.creditBalance,
  };
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const groups = quota.groups ?? [];

  if (groups.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('antigravity_quota.empty_models'));
  }

  return groups.map((group) => {
    const clamped = Math.max(0, Math.min(1, group.remainingFraction));
    const percent = Math.round(clamped * 100);
    const resetLabel = formatQuotaResetTime(group.resetTime);

    return h(
      'div',
      { key: group.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel, title: group.models.join(', ') }, group.label),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, `${percent}%`),
          h('span', { className: styleMap.quotaReset }, resetLabel)
        )
      ),
      h(QuotaProgressBar, {
        percent,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    );
  });
};

const PREMIUM_GEMINI_CLI_TIER_IDS = new Set(['g1-ultra-tier']);
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

  if (planLabel) {
    const valueClass = isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('codex_quota.plan_label')),
        h('span', { className: valueClass }, planLabel),
        weeklyUsdInlineEstimate
          ? h(
              'span',
              {
                className: styleMap.codexPlanEstimate,
                title: weeklyInlineEstimateTitle ?? undefined,
              },
              weeklyUsdInlineEstimate
            )
          : null
      )
    );
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

const renderGeminiCliItems = (
  quota: GeminiCliQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const buckets = quota.buckets ?? [];
  const tierLabel = quota.tierLabel ?? null;
  const tierId = quota.tierId ?? null;
  const creditBalance = quota.creditBalance ?? null;
  const isPremiumTier = tierId !== null && PREMIUM_GEMINI_CLI_TIER_IDS.has(tierId);
  const nodes: ReactNode[] = [];

  if (tierLabel) {
    const valueClass = isPremiumTier ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    nodes.push(
      h(
        'div',
        { key: 'tier', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('gemini_cli_quota.tier_label')),
        h('span', { className: valueClass }, tierLabel)
      )
    );
  }

  if (creditBalance !== null) {
    nodes.push(
      h(
        'div',
        { key: 'credits', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('gemini_cli_quota.credit_label')),
        h(
          'span',
          { className: styleMap.codexPlanValue },
          t('gemini_cli_quota.credit_amount', { count: creditBalance })
        )
      )
    );
  }

  if (buckets.length === 0) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: styleMap.quotaMessage },
        t('gemini_cli_quota.empty_buckets')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...buckets.map((bucket) => {
      const fraction = bucket.remainingFraction;
      const clamped = fraction === null ? null : Math.max(0, Math.min(1, fraction));
      const percent = clamped === null ? null : Math.round(clamped * 100);
      const percentLabel = percent === null ? '--' : `${percent}%`;
      const remainingAmountLabel =
        bucket.remainingAmount === null || bucket.remainingAmount === undefined
          ? null
          : t('gemini_cli_quota.remaining_amount', {
              count: bucket.remainingAmount,
            });
      const titleBase =
        bucket.modelIds && bucket.modelIds.length > 0 ? bucket.modelIds.join(', ') : bucket.label;
      const title = bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase;

      const resetLabel = formatQuotaResetTime(bucket.resetTime);

      return h(
        'div',
        { key: bucket.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel, title }, bucket.label),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            remainingAmountLabel
              ? h('span', { className: styleMap.quotaAmount }, remainingAmountLabel)
              : null,
            h('span', { className: styleMap.quotaReset }, resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
    });
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const fetchClaudeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return { windows, extraUsage: payload.extra_usage, planType };
};

const renderClaudeItems = (
  quota: ClaudeQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const nodes: ReactNode[] = [];

  if (planType) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, t(`claude_quota.${planType}`))
      )
    );
  }

  if (extraUsage && extraUsage.is_enabled) {
    const usedLabel = `$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`;
    nodes.push(
      h(
        'div',
        { key: 'extra', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.extra_usage_label')),
        h('span', { className: styleMap.codexPlanValue }, usedLabel)
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('claude_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
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

  return h(Fragment, null, ...nodes);
};

export const CLAUDE_CONFIG: QuotaConfig<
  ClaudeQuotaState,
  { windows: ClaudeQuotaWindow[]; extraUsage?: ClaudeExtraUsage | null; planType?: string | null }
> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchClaudeQuota,
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.claudeCard,
  controlsClassName: styles.claudeControls,
  controlClassName: styles.claudeControl,
  gridClassName: styles.claudeGrid,
  renderQuotaItems: renderClaudeItems,
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaGroup[]> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isAntigravityFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchAntigravityQuota,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({ status: 'loading', groups: [] }),
  buildSuccessState: (groups) => ({ status: 'success', groups }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems,
};

export const CODEX_CONFIG: QuotaConfig<
  CodexQuotaState,
  {
    planType: string | null;
    accountEmail: string | null;
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

export const GEMINI_CLI_CONFIG: QuotaConfig<
  GeminiCliQuotaState,
  {
    fileName: string;
    supplementaryRequestId: number;
    buckets: GeminiCliQuotaBucketState[];
    tierLabel: string | null;
    tierId: string | null;
    creditBalance: number | null;
  }
> = {
  type: 'gemini-cli',
  i18nPrefix: 'gemini_cli_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) =>
    isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchGeminiCliQuota,
  storeSelector: (state) => state.geminiCliQuota,
  storeSetter: 'setGeminiCliQuota',
  buildLoadingState: () => ({
    status: 'loading',
    buckets: [],
    tierLabel: null,
    tierId: null,
    creditBalance: null,
  }),
  buildSuccessState: (data) => {
    const supplementarySnapshot = readGeminiCliSupplementarySnapshot(
      data.fileName,
      data.supplementaryRequestId
    );

    return {
      status: 'success',
      buckets: data.buckets,
      tierLabel: supplementarySnapshot.tierLabel ?? data.tierLabel,
      tierId: supplementarySnapshot.tierId ?? data.tierId,
      creditBalance: supplementarySnapshot.creditBalance ?? data.creditBalance,
    };
  },
  buildErrorState: (message, status) => ({
    status: 'error',
    buckets: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.geminiCliCard,
  controlsClassName: styles.geminiCliControls,
  controlClassName: styles.geminiCliControl,
  gridClassName: styles.geminiCliGrid,
  renderQuotaItems: renderGeminiCliItems,
};

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

const renderKimiItems = (
  quota: KimiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('kimi_quota.empty_data'));
  }

  return rows.map((row) => {
    const limit = row.limit;
    const used = row.used;
    const remaining =
      limit > 0
        ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
        : used > 0
          ? 0
          : null;
    const percentLabel = remaining === null ? '--' : `${remaining}%`;
    const rowLabel = row.labelKey
      ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
      : (row.label ?? '');
    const resetLabel = formatKimiResetHint(t, row.resetHint);

    return h(
      'div',
      { key: row.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, rowLabel),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          limit > 0 ? h('span', { className: styleMap.quotaAmount }, `${used} / ${limit}`) : null,
          resetLabel ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
        )
      ),
      h(QuotaProgressBar, {
        percent: remaining,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    );
  });
};

export const KIMI_CONFIG: QuotaConfig<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isKimiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKimiQuota,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.kimiCard,
  controlsClassName: styles.kimiControls,
  controlClassName: styles.kimiControl,
  gridClassName: styles.kimiGrid,
  renderQuotaItems: renderKimiItems,
};
