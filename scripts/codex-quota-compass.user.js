// ==UserScript==
// @name         Codex Quota Compass
// @namespace    https://github.com/BlueSkyXN/CPA-Panel-LTS
// @version      0.1.20
// @description  在 ChatGPT Codex Cloud 页面直接查看 Codex 额度窗口、周额度估算和 daily analytics 汇总。
// @author       BlueSkyXN
// @match        https://chatgpt.com/codex/cloud*
// @homepageURL  https://github.com/BlueSkyXN/CPA-Panel-LTS/blob/main/scripts/codex-quota-compass.user.js
// @supportURL   https://github.com/BlueSkyXN/CPA-Panel-LTS/issues
// @downloadURL  https://raw.githubusercontent.com/BlueSkyXN/CPA-Panel-LTS/main/scripts/codex-quota-compass.user.js
// @updateURL    https://raw.githubusercontent.com/BlueSkyXN/CPA-Panel-LTS/main/scripts/codex-quota-compass.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    AUTO_LOAD: true,
    ANALYTICS_FETCH_DAYS: 360,
    ROLLING_DAYS: 30,
    USD_PER_CREDIT: 40 / 1000,
    // 默认不在面板中显示完整邮箱；邮箱仍用于 Team leaderboard 匹配。
    SHOW_ACCOUNT_EMAIL: false,

    // 仅在自动 session 取不到 access token 时，才建议在自己电脑临时填写。
    // 不要把填过 token 的脚本、截图或导出结果发给别人。
    MANUAL_ACCESS_TOKEN: '',

    USAGE_PATH: '/backend-api/wham/usage',
    RESET_CREDITS_PATH: '/backend-api/wham/rate-limit-reset-credits',
    DAILY_USAGE_PATH: '/backend-api/wham/analytics/daily-workspace-usage-counts',
    TEAM_USAGE_LEADERBOARD_PATH: '/backend-api/wham/analytics/usage-leaderboard',
    ME_PATH: '/backend-api/me',
    SESSION_PATH: '/api/auth/session',
  };

  // 与 metadata 的 @version 保持同步；userscript 在 @grant none 下没有 GM_info。
  const APP_VERSION = '0.1.20';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const FIVE_HOUR_SECONDS = 5 * 60 * 60;
  const WEEK_SECONDS = 7 * 24 * 60 * 60;
  const TOP_CLIENT_LIMIT = 5;
  const HOST_ID = 'codex-quota-compass-host';
  const CODEX_CLOUD_PATH_PREFIX = '/codex/cloud';

  const state = {
    loading: false,
    panelOpen: false,
    result: null,
    error: '',
  };

  const isCodexCloudPath = () =>
    location.hostname === 'chatgpt.com' &&
    (location.pathname === CODEX_CLOUD_PATH_PREFIX ||
      location.pathname.startsWith(`${CODEX_CLOUD_PATH_PREFIX}/`));

  const num = (value) => {
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const normalizeString = (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  };

  const displayEmail = (email) =>
    CONFIG.SHOW_ACCOUNT_EMAIL ? normalizeString(email) : null;

  const normalizePlanType = (value) => {
    const normalized = normalizeString(value);
    return normalized ? normalized.toLowerCase() : null;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 2) => {
    const multiplier = 10 ** digits;
    return Math.round((num(value) + Number.EPSILON) * multiplier) / multiplier;
  };

  const formatNumber = (value, digits = 2) =>
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits,
    }).format(num(value));

  const formatInteger = (value) => new Intl.NumberFormat(undefined).format(Math.round(num(value)));
  const formatUsd = (value) => `$${num(value).toFixed(2)}`;

  const formatCompact = (value) =>
    new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(num(value));

  const formatPercent = (ratio, digits = 1) =>
    ratio === null || ratio === undefined ? '--' : `${(num(ratio) * 100).toFixed(digits)}%`;

  const cacheHitRatio = (cached, uncached) => {
    const input = num(cached) + num(uncached);
    return input > 0 ? num(cached) / input : null;
  };

  const usdPerMillionTokens = (usd, tokens) =>
    num(tokens) > 0 ? (num(usd) / num(tokens)) * 1e6 : null;

  const ymdUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

  const firstDayOfMonthUtc = (ms) => {
    const date = new Date(ms);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
  };

  const formatUtcDateTime = (ms) =>
    new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

  const getUserTimeZone = () =>
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';

  const formatUserDateTime = (ms) => {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '-';

    const timeZone = getUserTimeZone();
    const baseOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...(timeZone === 'Local' ? {} : { timeZone }),
    };

    let parts;
    try {
      parts = new Intl.DateTimeFormat(undefined, {
        ...baseOptions,
        timeZoneName: 'shortOffset',
      }).formatToParts(date);
    } catch {
      parts = new Intl.DateTimeFormat(undefined, {
        ...baseOptions,
        timeZoneName: 'short',
      }).formatToParts(date);
    }

    const values = Object.fromEntries(
      parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
    );
    const hour = values.hour === '24' ? '00' : values.hour;
    const zone = values.timeZoneName ? ` ${values.timeZoneName}` : '';
    return `${values.year}-${values.month}-${values.day} ${hour}:${values.minute}:${values.second}${zone}`;
  };

  const formatLocalDateTime = (ms) =>
    new Date(ms).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const formatRelativeHours = (seconds) => {
    const totalMinutes = Math.max(0, Math.round(num(seconds) / 60));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return '<1m';
  };

  const tokenTotal = (metrics = {}) => {
    const explicit = num(metrics.text_total_tokens ?? metrics.textTotalTokens);
    if (explicit > 0) return explicit;
    return (
      num(metrics.cached_text_input_tokens ?? metrics.cachedTextInputTokens) +
      num(metrics.uncached_text_input_tokens ?? metrics.uncachedTextInputTokens) +
      num(metrics.text_output_tokens ?? metrics.textOutputTokens)
    );
  };

  const stripBearer = (value) =>
    String(value || '')
      .replace(/^Bearer\s+/i, '')
      .trim();

  const looksLikeJwt = (value) =>
    typeof value === 'string' && value.length > 100 && value.split('.').length >= 3;

  const decodeJwtPayload = (token) => {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    try {
      const padded = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
      const decoded = window.atob(padded);
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  };

  const findAccessToken = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return '';
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && /access/i.test(key) && looksLikeJwt(child)) {
        return child;
      }
      if (child && typeof child === 'object') {
        const found = findAccessToken(child, depth + 1);
        if (found) return found;
      }
    }
    return '';
  };

  const findChatgptAccountId = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return '';
    for (const [key, child] of Object.entries(value)) {
      if (
        typeof child === 'string' &&
        /chatgpt[_-]?account[_-]?id/i.test(key) &&
        child.trim()
      ) {
        return child.trim();
      }
      if (child && typeof child === 'object') {
        const found = findChatgptAccountId(child, depth + 1);
        if (found) return found;
      }
    }
    return '';
  };

  const getSessionInfo = async () => {
    const manualToken = stripBearer(CONFIG.MANUAL_ACCESS_TOKEN);
    if (manualToken) {
      const payload = decodeJwtPayload(manualToken) || {};
      return {
        accessToken: manualToken,
        accountId: normalizeString(payload.chatgpt_account_id ?? payload.chatgptAccountId) || '',
        tokenSource: 'manual',
      };
    }

    try {
      const response = await fetch(CONFIG.SESSION_PATH, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return { accessToken: '', accountId: '', tokenSource: 'none' };

      const session = await response.json();
      const accessToken = findAccessToken(session);
      const tokenPayload = accessToken ? decodeJwtPayload(accessToken) || {} : {};
      const accountId =
        findChatgptAccountId(session) ||
        normalizeString(tokenPayload.chatgpt_account_id ?? tokenPayload.chatgptAccountId) ||
        '';

      return {
        accessToken,
        accountId,
        tokenSource: accessToken ? 'session' : 'cookie',
      };
    } catch {
      return { accessToken: '', accountId: '', tokenSource: 'none' };
    }
  };

  const buildRequestHeaders = (sessionInfo) => {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (sessionInfo.accessToken) {
      headers.authorization = `Bearer ${sessionInfo.accessToken}`;
    }
    if (sessionInfo.accountId) {
      headers['Chatgpt-Account-Id'] = sessionInfo.accountId;
    }
    return headers;
  };

  const apiGet = async (path, headers) => {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const buildHttpError = (message) => {
        const error = new Error(message);
        error.status = response.status;
        return error;
      };
      if (response.status === 401) {
        throw buildHttpError(
          [
            `HTTP 401 Unauthorized: ${path}`,
            '没有拿到有效 Authorization，或当前 ChatGPT session 已过期。',
            '请先刷新 chatgpt.com 并确认已登录；仍失败时，可临时填写 CONFIG.MANUAL_ACCESS_TOKEN。',
          ].join('\n')
        );
      }
      throw buildHttpError(`HTTP ${response.status} ${response.statusText}: ${path}\n${body.slice(0, 600)}`);
    }

    return response.json();
  };

  const isHttpStatus = (error, statuses) =>
    error && typeof error === 'object' && statuses.includes(Number(error.status));

  const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

  const createTypedError = (message, type, cause = '') => {
    const error = new Error(message);
    error.type = type;
    error.causeMessage = cause;
    return error;
  };

  const resolveMeInfo = (payload) => {
    if (!payload || typeof payload !== 'object') return null;

    const orgs = Array.isArray(payload.orgs?.data) ? payload.orgs.data : [];
    const teamOrgs = orgs.filter((org) => org && org.personal !== true);
    const roleCandidates = teamOrgs
      .map((org) => normalizeString(org.role))
      .filter(Boolean);
    const normalizedRoles = roleCandidates.map((role) => role.toLowerCase());
    const adminRoles = new Set(['owner', 'admin', 'administrator']);
    const isTeamAdmin =
      normalizedRoles.length > 0 ? normalizedRoles.some((role) => adminRoles.has(role)) : null;

    return {
      id: normalizeString(payload.id),
      email: normalizeString(payload.email),
      name: normalizeString(payload.name ?? payload.first_name ?? payload.firstName),
      teamRole: roleCandidates[0] || null,
      isTeamAdmin,
      teamOrgCount: teamOrgs.length,
    };
  };

  const fetchMeInfo = async (headers) => {
    try {
      return {
        info: resolveMeInfo(await apiGet(CONFIG.ME_PATH, headers)),
        error: '',
      };
    } catch (error) {
      return {
        info: null,
        error: errorMessage(error),
      };
    }
  };

  const getWindowSeconds = (windowInfo) => {
    if (!windowInfo) return null;
    return normalizeNumber(windowInfo.limit_window_seconds ?? windowInfo.limitWindowSeconds);
  };

  const normalizeEpochMs = (value) => (value > 1e12 ? value : value * 1000);

  const getWindowTiming = (windowInfo) => {
    if (!windowInfo) return null;
    const resetAt = normalizeNumber(windowInfo.reset_at ?? windowInfo.resetAt);
    const windowSeconds = getWindowSeconds(windowInfo);
    if (resetAt === null || windowSeconds === null) return null;

    const resetAfterSeconds = normalizeNumber(
      windowInfo.reset_after_seconds ?? windowInfo.resetAfterSeconds
    );
    const resetAtMs = normalizeEpochMs(resetAt);
    const windowStartMs = resetAtMs - windowSeconds * 1000;
    const serverNowMs =
      resetAfterSeconds === null ? Date.now() : resetAtMs - resetAfterSeconds * 1000;

    return {
      resetAtMs,
      windowStartMs,
      serverNowMs,
      resetAfterSeconds,
      windowSeconds,
    };
  };

  const pickClassifiedWindows = (rateLimit, allowOrderFallback = true) => {
    const primaryWindow = rateLimit?.primary_window ?? rateLimit?.primaryWindow ?? null;
    const secondaryWindow = rateLimit?.secondary_window ?? rateLimit?.secondaryWindow ?? null;
    const rawWindows = [primaryWindow, secondaryWindow];

    let fiveHourWindow = null;
    let weeklyWindow = null;

    for (const windowInfo of rawWindows) {
      if (!windowInfo) continue;
      const seconds = getWindowSeconds(windowInfo);
      if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
        fiveHourWindow = windowInfo;
      } else if (seconds === WEEK_SECONDS && !weeklyWindow) {
        weeklyWindow = windowInfo;
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

  const normalizeWindowId = (raw) =>
    String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const toQuotaWindow = (id, label, windowInfo, limitInfo) => {
    if (!windowInfo) return null;
    const usedPercentRaw = normalizeNumber(windowInfo.used_percent ?? windowInfo.usedPercent);
    const limitReached = Boolean(limitInfo?.limit_reached ?? limitInfo?.limitReached);
    const allowed = limitInfo?.allowed;
    const timing = getWindowTiming(windowInfo);
    const usedPercent =
      usedPercentRaw ?? ((limitReached || allowed === false) && timing ? 100 : null);
    const remainingPercent =
      usedPercent === null ? null : round(clamp(100 - usedPercent, 0, 100), 2);

    return {
      id,
      label,
      usedPercent,
      remainingPercent,
      resetLabel: timing ? formatLocalDateTime(timing.resetAtMs) : '-',
      resetUtcLabel: timing ? formatUtcDateTime(timing.resetAtMs) : '-',
      resetInLabel: timing ? formatRelativeHours(timing.resetAfterSeconds) : '-',
      windowDays: timing ? round(timing.windowSeconds / 86400, 4) : null,
      timing,
    };
  };

  const buildQuotaWindows = (payload) => {
    const windows = [];

    const addClassified = (prefix, labelPrefix, rateLimit) => {
      if (!rateLimit) return;
      const { fiveHourWindow, weeklyWindow } = pickClassifiedWindows(rateLimit);
      const fiveHour = toQuotaWindow(`${prefix}-five-hour`, `${labelPrefix} 5 小时`, fiveHourWindow, rateLimit);
      const weekly = toQuotaWindow(`${prefix}-weekly`, `${labelPrefix} 7 天`, weeklyWindow, rateLimit);
      if (fiveHour) windows.push(fiveHour);
      if (weekly) windows.push(weekly);
    };

    const rateLimit = payload.rate_limit ?? payload.rateLimit ?? null;
    const codeReviewLimit = payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? null;
    addClassified('codex', 'Codex', rateLimit);
    addClassified('code-review', 'Code Review', codeReviewLimit);

    const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
    if (Array.isArray(additionalRateLimits)) {
      additionalRateLimits.forEach((item, index) => {
        const rateInfo = item?.rate_limit ?? item?.rateLimit ?? null;
        if (!rateInfo) return;
        const limitName =
          normalizeString(item.limit_name ?? item.limitName) ||
          normalizeString(item.metered_feature ?? item.meteredFeature) ||
          `Additional ${index + 1}`;
        const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
        const { fiveHourWindow, weeklyWindow } = pickClassifiedWindows(rateInfo);
        const fiveHour = toQuotaWindow(
          `${idPrefix}-five-hour-${index}`,
          `${limitName} 5 小时`,
          fiveHourWindow,
          rateInfo
        );
        const weekly = toQuotaWindow(
          `${idPrefix}-weekly-${index}`,
          `${limitName} 7 天`,
          weeklyWindow,
          rateInfo
        );
        if (fiveHour) windows.push(fiveHour);
        if (weekly) windows.push(weekly);
      });
    }

    return windows;
  };

  const normalizeResetCreditExpiryMs = (value) => {
    const numeric = normalizeNumber(value);
    if (numeric !== null) return numeric > 1e12 ? numeric : numeric * 1000;
    const stringValue = normalizeString(value);
    if (!stringValue) return null;
    const ms = Date.parse(stringValue);
    return Number.isFinite(ms) ? ms : null;
  };

  const readResetCreditsInfo = (payload) => {
    const candidates = [
      payload?.rate_limit_reset_credits,
      payload?.rateLimitResetCredits,
      payload?.data,
      payload,
    ];
    let availableCount = null;

    for (const candidate of candidates) {
      const count = normalizeNumber(candidate?.available_count ?? candidate?.availableCount);
      if (count !== null) {
        availableCount = count;
        break;
      }
    }

    const credits = candidates.flatMap((candidate) =>
      Array.isArray(candidate?.credits) ? candidate.credits : []
    );
    const expiresAt =
      credits
        .filter((credit) => {
          const status = normalizeString(credit?.status)?.toLowerCase();
          return !status || status === 'available';
        })
        .map((credit) => credit?.expires_at ?? credit?.expiresAt ?? null)
        .filter((value) => value !== null && value !== undefined)
        .map((value) => ({ value, ms: normalizeResetCreditExpiryMs(value) }))
        .filter((item) => item.ms !== null)
        .sort((left, right) => left.ms - right.ms)[0]?.value ?? null;

    return {
      availableCount,
      expiresAt,
    };
  };

  const fetchResetCredits = async (headers, usagePayload) => {
    const embeddedInfo = readResetCreditsInfo(usagePayload);
    if (
      embeddedInfo.availableCount !== null &&
      (embeddedInfo.availableCount <= 0 || embeddedInfo.expiresAt !== null)
    ) {
      return {
        ...embeddedInfo,
        source: 'usage',
        error: '',
      };
    }

    try {
      const payload = await apiGet(CONFIG.RESET_CREDITS_PATH, headers);
      const info = readResetCreditsInfo(payload);
      return {
        ...info,
        source: 'standalone',
        error: '',
      };
    } catch (error) {
      return {
        ...embeddedInfo,
        source: 'unavailable',
        error: errorMessage(error),
      };
    }
  };

  const fetchDailyUsage = async (headers, startDate, endDateExclusive) => {
    const query = new URLSearchParams({
      start_date: startDate,
      end_date: endDateExclusive,
      group_by: 'day',
    });
    const url = `${CONFIG.DAILY_USAGE_PATH}?${query.toString()}`;
    return apiGet(url, headers);
  };

  const utcDateMs = (date) => Date.parse(`${date}T00:00:00Z`);

  const inclusiveWindowDays = (startDate, endDateInclusive) => {
    const startMs = utcDateMs(startDate);
    const endMs = utcDateMs(endDateInclusive);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 1;
    return Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
  };

  const endDateExclusiveFromInclusive = (endDateInclusive) => {
    const endMs = utcDateMs(endDateInclusive);
    return Number.isFinite(endMs) ? ymdUtc(endMs + DAY_MS) : endDateInclusive;
  };

  const fetchUsageLeaderboard = async (headers, startDate, endDateInclusive) => {
    const query = new URLSearchParams({
      start_date: startDate,
      end_date: endDateInclusive,
      window_days: String(inclusiveWindowDays(startDate, endDateInclusive)),
      page: '1',
      page_size: '50',
      client_filter: 'all',
      sort_by: 'credits',
      sort_direction: 'desc',
    });
    const url = `${CONFIG.TEAM_USAGE_LEADERBOARD_PATH}?${query.toString()}`;

    try {
      return await apiGet(url, headers);
    } catch (error) {
      if (isHttpStatus(error, [401, 403])) {
        throw createTypedError(
          'Team 用量排行榜需要 owner/admin 或用量查看权限。',
          'team-permission-denied',
          errorMessage(error)
        );
      }
      throw error;
    }
  };

  const validatedDailyUsageDays = (payload) => {
    const seenDates = new Set();
    return (payload?.data ?? []).map((day) => {
      const date = typeof day?.date === 'string' ? day.date : '';
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? utcDateMs(date) : Number.NaN;
      if (!Number.isFinite(parsed) || ymdUtc(parsed) !== date) {
        throw createTypedError(
          'Daily analytics 返回了无效日期，已停止汇总以避免错误计费。',
          'daily-analytics-integrity'
        );
      }
      if (seenDates.has(date)) {
        throw createTypedError(
          `Daily analytics 返回了重复日期 ${date}，已停止汇总以避免重复计费。`,
          'daily-analytics-integrity'
        );
      }
      seenDates.add(date);
      return day;
    });
  };

  const sortedDays = (payload) =>
    validatedDailyUsageDays(payload)
      .slice()
      .sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')));

  const sliceDailyUsagePayload = (payload, startDate, endDateExclusive) => ({
    ...payload,
    data: validatedDailyUsageDays(payload).filter((day) => {
      const date = day.date;
      return date >= startDate && date < endDateExclusive;
    }),
  });

  const buildClientSummary = (days) => {
    const clients = new Map();
    for (const day of days) {
      for (const client of day.clients ?? []) {
        const clientId = normalizeString(client.client_id ?? client.clientId) || 'UNKNOWN';
        const current =
          clients.get(clientId) ||
          {
            clientId,
            credits: 0,
            usd: 0,
            tokens: 0,
            threads: 0,
            turns: 0,
          };

        const credits = num(client.credits);
        current.credits += credits;
        current.usd += credits * CONFIG.USD_PER_CREDIT;
        current.tokens += tokenTotal(client);
        current.threads += num(client.threads);
        current.turns += num(client.turns);
        clients.set(clientId, current);
      }
    }

    return Array.from(clients.values())
      .map((client) => ({
        ...client,
        credits: round(client.credits, 6),
        usd: round(client.usd, 2),
        tokens: Math.round(client.tokens),
        threads: Math.round(client.threads),
        turns: Math.round(client.turns),
      }))
      .sort((left, right) => right.credits - left.credits)
      .slice(0, TOP_CLIENT_LIMIT);
  };

  const buildAnalyticsRange = (payload, id, label, startDate, endDateExclusive) => {
    const days = sortedDays(payload);
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
      credits += num(totals.credits);
      cachedInputTokens += num(totals.cached_text_input_tokens ?? totals.cachedTextInputTokens);
      uncachedInputTokens += num(
        totals.uncached_text_input_tokens ?? totals.uncachedTextInputTokens
      );
      outputTokens += num(totals.text_output_tokens ?? totals.textOutputTokens);
      tokens += tokenTotal(totals);
      threads += num(totals.threads);
      turns += num(totals.turns);
      users += num(totals.users);
    }

    return {
      id,
      label,
      startDate,
      endDateExclusive,
      returnedDays: days.length,
      firstDate: days[0]?.date ?? '',
      lastDate: days[days.length - 1]?.date ?? '',
      credits: round(credits, 6),
      usd: round(credits * CONFIG.USD_PER_CREDIT, 2),
      tokens: Math.round(tokens),
      cachedInputTokens: Math.round(cachedInputTokens),
      uncachedInputTokens: Math.round(uncachedInputTokens),
      outputTokens: Math.round(outputTokens),
      threads: Math.round(threads),
      turns: Math.round(turns),
      users: Math.round(users),
      topClients: buildClientSummary(days),
      days: days.map((day) => {
        const totals = day.totals ?? {};
        const dayCredits = num(totals.credits);
        return {
          date: day.date ?? '',
          credits: round(dayCredits, 6),
          usd: round(dayCredits * CONFIG.USD_PER_CREDIT, 2),
          tokens: Math.round(tokenTotal(totals)),
          cachedInputTokens: Math.round(
            num(totals.cached_text_input_tokens ?? totals.cachedTextInputTokens)
          ),
          uncachedInputTokens: Math.round(
            num(totals.uncached_text_input_tokens ?? totals.uncachedTextInputTokens)
          ),
          threads: Math.round(num(totals.threads)),
          turns: Math.round(num(totals.turns)),
        };
      }),
    };
  };

  const leaderboardUserLabel = (row) => {
    const email = normalizeString(row.email);
    const name = normalizeString(row.name);
    const userId = normalizeString(row.user_id ?? row.userId);
    const visibleEmail = displayEmail(email);
    if (name && visibleEmail) return `${name} <${visibleEmail}>`;
    if (CONFIG.SHOW_ACCOUNT_EMAIL) return visibleEmail || name || userId || 'UNKNOWN';
    return name || '用户';
  };

  const pickLeaderboardUserRow = (rows, currentEmail) => {
    const normalizedEmail = normalizeString(currentEmail)?.toLowerCase();
    if (!normalizedEmail) return null;
    return rows.find((row) => normalizeString(row.email)?.toLowerCase() === normalizedEmail) || null;
  };

  const assertCompleteLeaderboardForCurrentUser = (payload, currentEmail) => {
    const normalizedEmail = normalizeString(currentEmail)?.toLowerCase();
    if (!normalizedEmail) {
      throw createTypedError(
        'Team 用量排行榜缺少当前账号邮箱，无法可靠选择个人用量。',
        'team-leaderboard-integrity'
      );
    }

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const totalUsers = normalizeNumber(payload?.total_users ?? payload?.totalUsers);
    const nextPage = normalizeNumber(payload?.next_page ?? payload?.nextPage);
    const hasContinuation =
      payload?.has_more === true ||
      payload?.hasMore === true ||
      (nextPage !== null && nextPage > 0) ||
      Boolean(normalizeString(payload?.next_cursor ?? payload?.nextCursor));
    if (
      hasContinuation ||
      totalUsers === null ||
      !Number.isInteger(totalUsers) ||
      totalUsers < 0 ||
      totalUsers !== rows.length
    ) {
      throw createTypedError(
        `Team 用量排行榜只返回了 ${rows.length}/${totalUsers ?? '?'} 人，已停止展示不完整的 workspace 汇总。`,
        'team-leaderboard-integrity'
      );
    }

    const matchedRows = rows.filter(
      (row) => normalizeString(row.email)?.toLowerCase() === normalizedEmail
    );
    if (matchedRows.length === 0) {
      throw createTypedError(
        'Team 用量排行榜没有找到当前账号的记录。',
        'team-leaderboard-integrity'
      );
    }
    if (matchedRows.length > 1) {
      throw createTypedError(
        'Team 用量排行榜包含多条当前账号记录，无法可靠选择个人用量。',
        'team-leaderboard-integrity'
      );
    }
  };

  const buildLeaderboardRange = (payload, id, label, startDate, endDateInclusive, currentEmail) => {
    const rows = (payload?.data ?? []).slice().sort((left, right) => {
      const leftRank = normalizeNumber(left.rank) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = normalizeNumber(right.rank) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return num(right.credits) - num(left.credits);
    });

    let credits = 0;
    for (const row of rows) {
      credits += num(row.credits);
    }

    const totalUsers = num(payload?.total_users ?? payload?.totalUsers) || rows.length;
    const currentUser = pickLeaderboardUserRow(rows, currentEmail);
    const selectedCredits = num(currentUser?.credits);
    const selectedTokens = num(currentUser?.text_tokens ?? currentUser?.textTokens);
    const selectedThreads = num(currentUser?.n_threads ?? currentUser?.nThreads);
    const selectedTurns = num(currentUser?.n_turns ?? currentUser?.nTurns);

    return {
      id,
      label,
      startDate,
      endDateExclusive: endDateExclusiveFromInclusive(endDateInclusive),
      returnedDays: inclusiveWindowDays(startDate, endDateInclusive),
      firstDate: startDate,
      lastDate: endDateInclusive,
      credits: round(selectedCredits, 6),
      usd: round(selectedCredits * CONFIG.USD_PER_CREDIT, 2),
      tokens: Math.round(selectedTokens),
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      threads: Math.round(selectedThreads),
      turns: Math.round(selectedTurns),
      users: Math.round(totalUsers),
      leaderboardTotalCredits: round(credits, 6),
      leaderboardTotalUsd: round(credits * CONFIG.USD_PER_CREDIT, 2),
      matchedEmail: normalizeString(currentEmail),
      matchedUserFound: Boolean(currentUser),
      topClients: rows.slice(0, TOP_CLIENT_LIMIT).map((row, index) => {
        const rowCredits = num(row.credits);
        return {
          clientId: CONFIG.SHOW_ACCOUNT_EMAIL
            ? leaderboardUserLabel(row)
            : normalizeString(row.name) || `用户 ${index + 1}`,
          credits: round(rowCredits, 6),
          usd: round(rowCredits * CONFIG.USD_PER_CREDIT, 2),
          tokens: Math.round(num(row.text_tokens ?? row.textTokens)),
          threads: Math.round(num(row.n_threads ?? row.nThreads)),
          turns: Math.round(num(row.n_turns ?? row.nTurns)),
        };
      }),
      days: [],
    };
  };

  const buildWeeklyEstimate = (weeklyWindow, sinceResetRange, sinceResetPayload, sinceResetStartDate) => {
    const usedPercent = normalizeNumber(weeklyWindow.used_percent ?? weeklyWindow.usedPercent);
    if (usedPercent === null || usedPercent <= 0) return null;

    const usedRatio = usedPercent / 100;
    const includedCredits = sinceResetRange.credits;
    const resetDay = (sinceResetPayload?.data ?? []).find((day) => day.date === sinceResetStartDate);
    const resetDayCredits = num(resetDay?.totals?.credits);
    const excludedCredits = Math.max(0, includedCredits - resetDayCredits);
    const totalCreditsWithResetDay = includedCredits / usedRatio;
    const totalCreditsWithoutResetDay = excludedCredits / usedRatio;
    const remainingCreditsWithResetDay = Math.max(0, totalCreditsWithResetDay - includedCredits);
    const remainingCreditsWithoutResetDay = Math.max(0, totalCreditsWithoutResetDay - excludedCredits);

    return {
      usedPercent: round(usedPercent, 2),
      usedRatio: round(usedRatio, 4),
      remainingRatio: round(1 - usedRatio, 4),
      includedCredits: round(includedCredits, 6),
      resetDayCredits: round(resetDayCredits, 6),
      excludedCredits: round(excludedCredits, 6),
      totalCreditsWithResetDay: round(totalCreditsWithResetDay, 2),
      totalUsdWithResetDay: round(totalCreditsWithResetDay * CONFIG.USD_PER_CREDIT, 2),
      totalCreditsWithoutResetDay: round(totalCreditsWithoutResetDay, 2),
      totalUsdWithoutResetDay: round(totalCreditsWithoutResetDay * CONFIG.USD_PER_CREDIT, 2),
      remainingCreditsWithResetDay: round(remainingCreditsWithResetDay, 2),
      remainingUsdWithResetDay: round(remainingCreditsWithResetDay * CONFIG.USD_PER_CREDIT, 2),
      remainingCreditsWithoutResetDay: round(remainingCreditsWithoutResetDay, 2),
      remainingUsdWithoutResetDay: round(remainingCreditsWithoutResetDay * CONFIG.USD_PER_CREDIT, 2),
    };
  };

  const buildWeeklyEstimateFromRange = (weeklyWindow, sinceResetRange) => {
    const usedPercent = normalizeNumber(weeklyWindow.used_percent ?? weeklyWindow.usedPercent);
    if (usedPercent === null || usedPercent <= 0) return null;

    const usedRatio = usedPercent / 100;
    const includedCredits = sinceResetRange.credits;
    const totalCredits = includedCredits / usedRatio;
    const remainingCredits = Math.max(0, totalCredits - includedCredits);

    return {
      usedPercent: round(usedPercent, 2),
      usedRatio: round(usedRatio, 4),
      remainingRatio: round(1 - usedRatio, 4),
      includedCredits: round(includedCredits, 6),
      resetDayCredits: 0,
      excludedCredits: round(includedCredits, 6),
      totalCreditsWithResetDay: round(totalCredits, 2),
      totalUsdWithResetDay: round(totalCredits * CONFIG.USD_PER_CREDIT, 2),
      totalCreditsWithoutResetDay: round(totalCredits, 2),
      totalUsdWithoutResetDay: round(totalCredits * CONFIG.USD_PER_CREDIT, 2),
      remainingCreditsWithResetDay: round(remainingCredits, 2),
      remainingUsdWithResetDay: round(remainingCredits * CONFIG.USD_PER_CREDIT, 2),
      remainingCreditsWithoutResetDay: round(remainingCredits, 2),
      remainingUsdWithoutResetDay: round(remainingCredits * CONFIG.USD_PER_CREDIT, 2),
      source: 'aggregate-range',
    };
  };

  const buildAnalyticsDates = (timing) => {
    const apiNowMs = timing.serverNowMs;
    return {
      apiNowMs,
      endDateInclusive: ymdUtc(apiNowMs),
      endDateExclusive: ymdUtc(apiNowMs + DAY_MS),
      sinceResetStartDate: ymdUtc(timing.windowStartMs),
      monthStartDate: firstDayOfMonthUtc(apiNowMs),
      rollingStartDate: ymdUtc(apiNowMs - (CONFIG.ROLLING_DAYS - 1) * DAY_MS),
      historyStartDate: ymdUtc(apiNowMs - (CONFIG.ANALYTICS_FETCH_DAYS - 1) * DAY_MS),
    };
  };

  const buildAnalyticsTimeLabels = (timing) => ({
    userTimeZone: getUserTimeZone(),
    backendNowLabel: formatUserDateTime(timing.serverNowMs),
    backendNowUtcLabel: formatUtcDateTime(timing.serverNowMs),
    windowStartLabel: formatUserDateTime(timing.windowStartMs),
    windowStartUtcLabel: formatUtcDateTime(timing.windowStartMs),
    resetAtLabel: formatUserDateTime(timing.resetAtMs),
    resetAtUtcLabel: formatUtcDateTime(timing.resetAtMs),
  });

  const fetchDailyAnalyticsRanges = async (headers, weeklyWindow, timing) => {
    const dates = buildAnalyticsDates(timing);
    const historyPayload = await fetchDailyUsage(
      headers,
      dates.historyStartDate,
      dates.endDateExclusive
    );
    const sinceResetPayload = sliceDailyUsagePayload(
      historyPayload,
      dates.sinceResetStartDate,
      dates.endDateExclusive
    );
    const monthPayload = sliceDailyUsagePayload(
      historyPayload,
      dates.monthStartDate,
      dates.endDateExclusive
    );
    const rollingPayload = sliceDailyUsagePayload(
      historyPayload,
      dates.rollingStartDate,
      dates.endDateExclusive
    );

    const sinceResetRange = buildAnalyticsRange(
      sinceResetPayload,
      'since-reset',
      '上次重置至今',
      dates.sinceResetStartDate,
      dates.endDateExclusive
    );
    const monthRange = buildAnalyticsRange(
      monthPayload,
      'month-to-date',
      '本月初至今',
      dates.monthStartDate,
      dates.endDateExclusive
    );
    const rollingRange = buildAnalyticsRange(
      rollingPayload,
      'rolling',
      `近 ${CONFIG.ROLLING_DAYS} 天`,
      dates.rollingStartDate,
      dates.endDateExclusive
    );
    const historyRange = buildAnalyticsRange(
      historyPayload,
      'history',
      `近 ${CONFIG.ANALYTICS_FETCH_DAYS} 天`,
      dates.historyStartDate,
      dates.endDateExclusive
    );

    return {
      dateBucket: 'UTC',
      source: 'daily-workspace',
      requestCount: 1,
      fetchWindowDays: CONFIG.ANALYTICS_FETCH_DAYS,
      ...buildAnalyticsTimeLabels(timing),
      weeklyEstimate: buildWeeklyEstimate(
        weeklyWindow,
        sinceResetRange,
        sinceResetPayload,
        dates.sinceResetStartDate
      ),
      ranges: [sinceResetRange, monthRange, rollingRange, historyRange],
    };
  };

  const fetchLeaderboardAnalyticsRanges = async (headers, weeklyWindow, timing, currentEmail) => {
    if (!normalizeString(currentEmail)) {
      throw createTypedError(
        'Team 用量排行榜需要当前账号邮箱，但 /backend-api/me 和 /usage 都没有返回邮箱。',
        'team-leaderboard-integrity'
      );
    }

    const dates = buildAnalyticsDates(timing);
    const [sinceResetPayload, monthPayload, rollingPayload] = await Promise.all([
      fetchUsageLeaderboard(headers, dates.sinceResetStartDate, dates.endDateInclusive),
      fetchUsageLeaderboard(headers, dates.monthStartDate, dates.endDateInclusive),
      fetchUsageLeaderboard(headers, dates.rollingStartDate, dates.endDateInclusive),
    ]);

    assertCompleteLeaderboardForCurrentUser(sinceResetPayload, currentEmail);
    assertCompleteLeaderboardForCurrentUser(monthPayload, currentEmail);
    assertCompleteLeaderboardForCurrentUser(rollingPayload, currentEmail);

    const sinceResetRange = buildLeaderboardRange(
      sinceResetPayload,
      'since-reset',
      '上次重置至今',
      dates.sinceResetStartDate,
      dates.endDateInclusive,
      currentEmail
    );
    const monthRange = buildLeaderboardRange(
      monthPayload,
      'month-to-date',
      '本月初至今',
      dates.monthStartDate,
      dates.endDateInclusive,
      currentEmail
    );
    const rollingRange = buildLeaderboardRange(
      rollingPayload,
      'rolling',
      `近 ${CONFIG.ROLLING_DAYS} 天`,
      dates.rollingStartDate,
      dates.endDateInclusive,
      currentEmail
    );
    const ranges = [sinceResetRange, monthRange, rollingRange];

    return {
      dateBucket: 'UTC',
      source: 'team-leaderboard',
      requestCount: 3,
      fetchWindowDays: null,
      ...buildAnalyticsTimeLabels(timing),
      weeklyEstimate: buildWeeklyEstimateFromRange(weeklyWindow, sinceResetRange),
      ranges,
    };
  };

  const fetchTeamAnalyticsWithFallback = async (headers, weeklyWindow, timing, currentEmail) => {
    let leaderboardError = '';

    try {
      return {
        analytics: await fetchLeaderboardAnalyticsRanges(headers, weeklyWindow, timing, currentEmail),
        warning: '',
      };
    } catch (error) {
      leaderboardError = errorMessage(error);
      if (error && typeof error === 'object' && error.type === 'team-leaderboard-integrity') {
        throw error;
      }
    }

    try {
      const analytics = await fetchDailyAnalyticsRanges(headers, weeklyWindow, timing);
      if (!analytics.ranges.some((range) => range.returnedDays > 0)) {
        throw new Error('daily analytics 没有返回可用日期桶。');
      }
      return {
        analytics: {
          ...analytics,
          source: 'daily-workspace-fallback',
          fallbackReason: leaderboardError,
        },
        warning: `${leaderboardError} 改为展示 daily Workspace 汇总回退；该数据不是个人用量。`,
      };
    } catch (fallbackError) {
      throw new Error(
        `${leaderboardError} 回退到 daily analytics 也失败：${errorMessage(fallbackError)}`
      );
    }
  };

  const collectQuota = async () => {
    const sessionInfo = await getSessionInfo();
    const headers = buildRequestHeaders(sessionInfo);
    const usage = await apiGet(CONFIG.USAGE_PATH, headers);

    const rateLimit = usage.rate_limit ?? usage.rateLimit ?? null;
    const weeklyWindow = pickClassifiedWindows(rateLimit).weeklyWindow;
    const timing = getWindowTiming(weeklyWindow);
    const windows = buildQuotaWindows(usage);
    const planType = normalizePlanType(usage.plan_type ?? usage.planType);
    const isTeamPlan = planType === 'team';
    const meResult = isTeamPlan ? await fetchMeInfo(headers) : { info: null, error: '' };
    const userEmail = meResult.info?.email || normalizeString(usage.email);
    const resetCredits = await fetchResetCredits(headers, usage);
    let analytics = null;
    let analyticsError = '';

    if (weeklyWindow && timing) {
      try {
        if (isTeamPlan) {
          const teamResult = await fetchTeamAnalyticsWithFallback(
            headers,
            weeklyWindow,
            timing,
            userEmail
          );
          analytics = teamResult.analytics;
          analyticsError = teamResult.warning;
        } else {
          analytics = await fetchDailyAnalyticsRanges(headers, weeklyWindow, timing);
        }
      } catch (error) {
        analyticsError = error instanceof Error ? error.message : String(error);
      }
    } else {
      analyticsError = '没有找到 Codex 7 天窗口，无法拉取 daily analytics。';
    }

    return {
      fetchedAt: new Date().toISOString(),
      tokenSource: sessionInfo.tokenSource,
      hasAccountHeader: Boolean(sessionInfo.accountId),
      planType,
      userEmail,
      meInfo: meResult.info,
      meError: meResult.error,
      rateLimitResetCreditsAvailableCount: resetCredits.availableCount,
      rateLimitResetCreditExpiresAt: resetCredits.expiresAt,
      resetCreditsSource: resetCredits.source,
      resetCreditsError: resetCredits.error,
      windows,
      analytics,
      analyticsError,
    };
  };

  const getPlanLabel = (planType) => {
    const normalized = normalizePlanType(planType);
    if (!normalized) return '未知';
    if (normalized === 'pro') return 'Pro 20x';
    if (['prolite', 'pro-lite', 'pro_lite'].includes(normalized)) return 'Pro 5x';
    if (normalized === 'plus') return 'Plus';
    if (normalized === 'team') return 'Team';
    if (normalized === 'free') return 'Free';
    return planType || normalized;
  };

  const rangeDateLabel = (range) => {
    const endMs = Date.parse(`${range.endDateExclusive}T00:00:00Z`);
    if (!Number.isFinite(endMs)) return `${range.startDate} - ${range.endDateExclusive}`;
    return `${range.startDate} - ${ymdUtc(endMs - DAY_MS)}`;
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const progressClass = (percent) => {
    if (percent === null || percent === undefined) return 'medium';
    if (percent >= 70) return 'high';
    if (percent >= 30) return 'medium';
    return 'low';
  };

  const renderProgress = (percent) => {
    const normalized = percent === null || percent === undefined ? 0 : clamp(percent, 0, 100);
    return `
      <div class="cqc-progress" role="progressbar" aria-label="剩余额度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(normalized)}">
        <div class="cqc-progress-fill ${progressClass(percent)}" style="width:${Math.round(normalized)}%"></div>
      </div>
    `;
  };

  const renderKpi = (label, value, hint = '', tone = 'neutral') => `
    <div class="cqc-kpi ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </div>
  `;

  const renderFact = (label, value, title = '') => `
    <span${title ? ` title="${escapeHtml(title)}"` : ''}>
      <b>${escapeHtml(label)}</b>
      <em>${escapeHtml(value)}</em>
    </span>
  `;

  const renderWindowRow = (windowInfo) => {
    const remainingLabel =
      windowInfo.remainingPercent === null || windowInfo.remainingPercent === undefined
        ? '--'
        : `${Math.round(windowInfo.remainingPercent)}%`;
    const usedLabel =
      windowInfo.usedPercent === null || windowInfo.usedPercent === undefined
        ? '已用未知'
        : `已用 ${formatNumber(windowInfo.usedPercent, 2)}%`;
    const resetInText =
      windowInfo.resetInLabel && windowInfo.resetInLabel !== '-'
        ? `${windowInfo.resetInLabel}后重置`
        : '重置时间未知';

    return `
      <div class="cqc-window">
        <div class="cqc-window-main">
          <div>
            <div class="cqc-window-title">${escapeHtml(windowInfo.label)}</div>
            <div class="cqc-window-sub">${escapeHtml(usedLabel)} · ${escapeHtml(resetInText)}</div>
          </div>
          <div class="cqc-window-meta">
            <strong>${escapeHtml(remainingLabel)}</strong>
            <span>${escapeHtml(windowInfo.resetLabel)}</span>
          </div>
        </div>
        ${renderProgress(windowInfo.remainingPercent)}
      </div>
    `;
  };

  const renderClientRows = (clients) => {
    if (!clients || clients.length === 0) {
      return '<div class="cqc-muted">无客户端明细。</div>';
    }
    return `
      <div class="cqc-table">
        <div class="cqc-table-head">
          <span>Client</span><span>Credits</span><span>USD</span><span>Turns</span>
        </div>
        ${clients
          .map(
            (client) => `
              <div class="cqc-table-row">
                <span title="${escapeHtml(client.clientId)}">${escapeHtml(client.clientId)}</span>
                <span>${formatNumber(client.credits, 2)}</span>
                <span>${formatUsd(client.usd)}</span>
                <span>${formatInteger(client.turns)}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  };

  const renderDailyRows = (days) => {
    if (!days || days.length === 0) {
      return '<div class="cqc-muted">无每日明细。</div>';
    }
    const recent = days.slice(-14).reverse();
    return `
      <div class="cqc-table-note">最近 ${recent.length} 个有数据日期</div>
      <div class="cqc-table cqc-table-daily">
        <div class="cqc-table-head">
          <span>Date</span><span>Credits</span><span>USD</span><span>Tokens</span><span>缓存</span>
        </div>
        ${recent
          .map(
            (day) => `
              <div class="cqc-table-row">
                <span>${escapeHtml(day.date)}</span>
                <span>${formatNumber(day.credits, 2)}</span>
                <span>${formatUsd(day.usd)}</span>
                <span>${formatCompact(day.tokens)}</span>
                <span>${formatPercent(cacheHitRatio(day.cachedInputTokens, day.uncachedInputTokens))}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  };

  const buildDailyUsageSeries = (range) => {
    if (!range?.startDate || !range?.endDateExclusive) return [];
    const startMs = Date.parse(`${range.startDate}T00:00:00Z`);
    const endMs = Date.parse(`${range.endDateExclusive}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

    const creditsByDate = new Map();
    for (const day of range.days ?? []) {
      if (day.date) creditsByDate.set(day.date, num(day.credits));
    }

    const values = [];
    for (let ms = startMs; ms < endMs; ms += DAY_MS) {
      const date = ymdUtc(ms);
      values.push({ date, credits: creditsByDate.get(date) ?? 0 });
    }
    return values;
  };

  const buildUsageHeatScale = (dayValues) => {
    const nonzero = dayValues
      .map((item) => num(item.credits))
      .filter((value) => value > 0)
      .sort((left, right) => left - right);
    const maxValue = nonzero[nonzero.length - 1] ?? 0;
    if (maxValue <= 0) {
      return { thresholds: null, maxValue: 0, mode: 'empty', nonzeroDays: 0 };
    }

    if (nonzero.length < 4) {
      return {
        thresholds: [maxValue * 0.25, maxValue * 0.5, maxValue * 0.75],
        maxValue,
        mode: 'linear',
        nonzeroDays: nonzero.length,
      };
    }

    const quantile = (p) =>
      nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))];
    return {
      thresholds: [quantile(0.5), quantile(0.75), quantile(0.9)],
      maxValue,
      mode: 'percentile',
      nonzeroDays: nonzero.length,
    };
  };

  const usageHeatLevel = (credits, scale) => {
    const value = num(credits);
    if (value <= 0) return 0;
    if (!scale?.thresholds) {
      return scale?.maxValue > 0
        ? clamp(Math.ceil((value / scale.maxValue) * 4), 1, 4)
        : 0;
    }
    if (value <= scale.thresholds[0]) return 1;
    if (value <= scale.thresholds[1]) return 2;
    if (value <= scale.thresholds[2]) return 3;
    return 4;
  };

  const heatScaleDescription = (scale) => {
    if (!scale?.thresholds) return '当前窗口没有非零 credits；全部显示为 0 档。';
    const [low, medium, high] = scale.thresholds;
    if (scale.mode === 'linear') {
      return `非零样本不足 4 天，按最大值等比分级：25% ${formatNumber(low, 2)} · 50% ${formatNumber(medium, 2)} · 75% ${formatNumber(high, 2)} credits`;
    }
    return `非零日动态门槛：P50 ${formatNumber(low, 2)} · P75 ${formatNumber(medium, 2)} · P90 ${formatNumber(high, 2)} credits`;
  };

  const HEAT_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const bindHeatmapTooltip = (shadow) => {
    const tip = shadow.querySelector('.cqc-tip');
    if (!tip) return;
    const tipTitle = tip.querySelector('strong');
    const tipText = tip.querySelector('.cqc-tip-text');
    const tipDot = tip.querySelector('.cqc-tip-dot');

    const hideTip = () => {
      tip.hidden = true;
    };

    const showTip = (cell) => {
      const date = cell.dataset.date;
      if (!date) return;
      const level = Number(cell.dataset.level ?? 0);
      const credits = num(cell.dataset.credits);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      tipTitle.textContent = `${date} · ${HEAT_WEEKDAYS[dow]}`;
      tipText.textContent = `${formatNumber(credits, 2)} credits · ${level === 0 ? '0 档' : `强度 L${level}`}`;
      tipDot.className = `cqc-tip-dot level-${level}`;

      tip.hidden = false;
      const rect = cell.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const left = clamp(
        rect.left + rect.width / 2 - tipRect.width / 2,
        6,
        Math.max(6, window.innerWidth - tipRect.width - 6)
      );
      let top = rect.top - tipRect.height - 7;
      if (top < 4) top = rect.bottom + 7;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    };

    shadow.addEventListener('mouseover', (event) => {
      const cell =
        event.target instanceof Element
          ? event.target.closest('.cqc-heatmap-cell[data-date]')
          : null;
      if (cell && shadow.contains(cell)) {
        showTip(cell);
      } else {
        hideTip();
      }
    });
    shadow.addEventListener('scroll', hideTip, { capture: true, passive: true });
    window.addEventListener('scroll', hideTip, { capture: true, passive: true });
    window.addEventListener('resize', hideTip, { passive: true });
  };

  const renderUsageHeatmap = (range) => {
    const dayValues = buildDailyUsageSeries(range);
    if (dayValues.length === 0) return '';

    const scale = buildUsageHeatScale(dayValues);
    const startDow = new Date(`${dayValues[0].date}T00:00:00Z`).getUTCDay();
    const columns = Math.ceil((startDow + dayValues.length) / 7);
    const leadingCells = Array.from(
      { length: startDow },
      () => '<span class="cqc-heatmap-cell placeholder" aria-hidden="true"></span>'
    ).join('');
    const monthMarkers = [];
    let lastMonth = '';
    dayValues.forEach((item, index) => {
      const month = item.date.slice(0, 7);
      if (month === lastMonth) return;
      lastMonth = month;
      monthMarkers.push({
        column: Math.floor((startDow + index) / 7) + 1,
        label: `${Number(item.date.slice(5, 7))}月`,
      });
    });

    const cells = dayValues
      .map((item) => {
        const level = usageHeatLevel(item.credits, scale);
        return `<span class="cqc-heatmap-cell level-${level}" data-date="${item.date}" data-credits="${item.credits}" data-level="${level}" aria-hidden="true"></span>`;
      })
      .join('');
    const thresholdDescription = heatScaleDescription(scale);

    return `
      <section class="cqc-heatmap-card">
        <div class="cqc-heatmap-head">
          <div>
            <strong>近 ${formatInteger(dayValues.length)} 天日用量</strong>
            <span>Credits · UTC 日期桶</span>
          </div>
          <em>5 档（含 0 档）</em>
        </div>
        <div
          class="cqc-heatmap-scroll"
          role="img"
          tabindex="0"
          aria-label="${escapeHtml(`近 ${dayValues.length} 天日用量点阵图。${thresholdDescription}`)}"
        >
          <div class="cqc-heatmap-inner" style="--cqc-heatmap-columns:${columns}">
            <div class="cqc-heatmap-months" aria-hidden="true">
              ${monthMarkers
                .map(
                  (marker) =>
                    `<span style="grid-column:${marker.column} / span ${Math.min(4, columns - marker.column + 1)}">${escapeHtml(marker.label)}</span>`
                )
                .join('')}
            </div>
            <div class="cqc-heatmap-grid" aria-hidden="true">${leadingCells}${cells}</div>
          </div>
        </div>
        <div class="cqc-heatmap-meta">
          <span>${escapeHtml(thresholdDescription)}</span>
          <div class="cqc-heatmap-legend" aria-label="颜色从少到多，共 5 档">
            <span>少</span>
            ${Array.from(
              { length: 5 },
              (_, level) =>
                `<i class="cqc-heatmap-cell level-${level}" title="${level === 0 ? '0 credits' : `强度 L${level}`}" aria-hidden="true"></i>`
            ).join('')}
            <span>多</span>
          </div>
        </div>
      </section>
    `;
  };

  const renderRange = (range) => {
    const isLeaderboard = range.leaderboardTotalCredits !== undefined;
    const creditsLabel = isLeaderboard ? '当前用户 Credits' : 'Credits';
    const creditsHint = isLeaderboard
      ? `${formatUsd(range.usd)} · workspace ${formatNumber(range.leaderboardTotalCredits, 2)}`
      : `${formatUsd(range.usd)}`;
    const detailSummary = isLeaderboard ? 'Team 用户排行' : '客户端与最近每日明细';
    const cacheRatio = cacheHitRatio(range.cachedInputTokens, range.uncachedInputTokens);
    const cacheHint =
      cacheRatio === null
        ? '数据源无缓存明细'
        : `cached ${formatCompact(range.cachedInputTokens)}`;
    const inputTokens = range.cachedInputTokens + range.uncachedInputTokens;
    const tokenSplitHint =
      inputTokens > 0 || range.outputTokens > 0
        ? `input ${formatCompact(inputTokens)} · output ${formatCompact(range.outputTokens)}`
        : '数据源无输入/输出明细';
    const usdPerMillion = usdPerMillionTokens(range.usd, range.tokens);

    return `
      <article class="cqc-range${range.id === 'history' ? ' history' : ''}">
        <div class="cqc-range-header">
          <div>
            <strong>${escapeHtml(range.label)}</strong>
            <span>${escapeHtml(rangeDateLabel(range))}</span>
          </div>
          <em>${escapeHtml(range.returnedDays)} 个日期桶</em>
        </div>
        <div class="cqc-range-metrics">
          <div>
            <span>${escapeHtml(creditsLabel)}</span>
            <strong>${formatNumber(range.credits, 2)}</strong>
            <small>${escapeHtml(creditsHint)}</small>
          </div>
          <div>
            <span>Tokens</span>
            <strong>${formatInteger(range.tokens)}</strong>
            <small>${formatInteger(range.turns)} turns</small>
          </div>
          <div>
            <span>缓存命中率</span>
            <strong>${formatPercent(cacheRatio)}</strong>
            <small>${escapeHtml(cacheHint)}</small>
          </div>
          <div>
            <span>混合成本</span>
            <strong>${usdPerMillion === null ? '--' : `$${num(usdPerMillion).toFixed(4)}`}</strong>
            <small>${escapeHtml(tokenSplitHint)}</small>
          </div>
        </div>
        <details>
          <summary>${escapeHtml(detailSummary)}</summary>
          ${renderClientRows(range.topClients)}
          ${renderDailyRows(range.days)}
        </details>
      </article>
    `;
  };

  const analyticsSourceLabel = (source) => {
    if (source === 'team-leaderboard') return 'Team 用量排行榜';
    if (source === 'daily-workspace-fallback') return 'Workspace 汇总（日桶回退）';
    return 'Daily analytics';
  };

  const teamRoleLabel = (result) => {
    if (normalizePlanType(result.planType) !== 'team') return '非 Team';
    if (result.meInfo?.isTeamAdmin === true) {
      return result.meInfo.teamRole ? `me: ${result.meInfo.teamRole}` : 'me: owner/admin';
    }
    if (result.meInfo?.isTeamAdmin === false) {
      return result.meInfo.teamRole ? `me: ${result.meInfo.teamRole}` : 'me: non-owner';
    }
    if (result.meError) return 'me 查询失败';
    return 'me 未返回 Team role';
  };

  const renderResult = (result) => {
    const weeklyWindow = result.windows.find((item) => item.id === 'codex-weekly');
    const fiveHourWindow = result.windows.find((item) => item.id === 'codex-five-hour');
    const weeklyEstimate = result.analytics?.weeklyEstimate ?? null;
    const historyRange = result.analytics?.ranges?.find((range) => range.id === 'history') ?? null;
    const heatmapBlock = historyRange ? renderUsageHeatmap(historyRange) : '';
    const visibleEmail = displayEmail(result.userEmail);
    const currentAccountLabel = visibleEmail
      ? result.meInfo?.name
        ? `${result.meInfo.name} <${visibleEmail}>`
        : visibleEmail
      : result.meInfo?.name || (result.userEmail ? '邮箱已隐藏' : '-');
    const remainingLabel = (windowInfo) =>
      windowInfo?.remainingPercent === null || windowInfo?.remainingPercent === undefined
        ? '--'
        : `${Math.round(windowInfo.remainingPercent)}%`;
    const resetCreditsLabel =
      result.rateLimitResetCreditsAvailableCount === null ||
      result.rateLimitResetCreditsAvailableCount === undefined
        ? '--'
        : formatInteger(result.rateLimitResetCreditsAvailableCount);
    const resetCreditExpiryMs = normalizeResetCreditExpiryMs(result.rateLimitResetCreditExpiresAt);
    const resetCreditsHint =
      resetCreditExpiryMs !== null
        ? `${formatLocalDateTime(resetCreditExpiryMs)} 过期`
        : result.resetCreditsSource === 'usage'
          ? '来自 /usage'
          : result.resetCreditsSource === 'standalone'
            ? '来自 resets API'
            : result.resetCreditsError
              ? '查询失败'
              : '';
    const coverageBlock = historyRange
      ? `
        <div class="cqc-coverage">
          <div>
            <span>实际数据覆盖</span>
            <strong>${escapeHtml(historyRange.firstDate || '暂无')} → ${escapeHtml(historyRange.lastDate || '暂无')}</strong>
          </div>
          <div>
            <span>有效日期</span>
            <strong>${formatInteger(historyRange.returnedDays)}</strong>
            <em>/ ${formatInteger(result.analytics.fetchWindowDays)} 天查询窗口</em>
          </div>
        </div>
      `
      : '';

    const weeklyEstimateBlock = weeklyEstimate
      ? result.analytics?.source === 'team-leaderboard'
        ? `
        <div class="cqc-estimate single">
          <div class="cqc-estimate-item">
            <span>Team 当前用户</span>
            <strong>${formatNumber(weeklyEstimate.totalCreditsWithResetDay, 2)} credits</strong>
            <em>${formatUsd(weeklyEstimate.totalUsdWithResetDay)} 总额 · 剩余 ${formatNumber(weeklyEstimate.remainingCreditsWithResetDay, 2)}</em>
          </div>
          <p>基于 Team usage leaderboard 中当前邮箱的 credits 和 7 天 used_percent 反推；leaderboard 按日期范围聚合，不能拆分重置日。</p>
        </div>
      `
        : `
        <div class="cqc-estimate">
          <div class="cqc-estimate-item">
            <span>包含重置日</span>
            <strong>${formatNumber(weeklyEstimate.totalCreditsWithResetDay, 2)} credits</strong>
            <em>${formatUsd(weeklyEstimate.totalUsdWithResetDay)} 总额 · 剩余 ${formatNumber(weeklyEstimate.remainingCreditsWithResetDay, 2)}</em>
          </div>
          <div class="cqc-estimate-item">
            <span>排除重置日</span>
            <strong>${formatNumber(weeklyEstimate.totalCreditsWithoutResetDay, 2)} credits</strong>
            <em>${formatUsd(weeklyEstimate.totalUsdWithoutResetDay)} 总额 · 剩余 ${formatNumber(weeklyEstimate.remainingCreditsWithoutResetDay, 2)}</em>
          </div>
          <p>daily analytics 只能按天聚合，真实值通常介于两种口径之间；used_percent 表示已用比例。</p>
        </div>
      `
      : '<div class="cqc-muted">暂无周额度反推数据。</div>';

    return `
      <div class="cqc-overview">
        <div class="cqc-identity">
          <div class="cqc-plan-row">
            <strong>${escapeHtml(getPlanLabel(result.planType))}</strong>
            ${visibleEmail ? `<span class="cqc-account" title="${escapeHtml(visibleEmail)}">${escapeHtml(visibleEmail)}</span>` : ''}
          </div>
          <div class="cqc-utility-row">
            <span><b>手动重置</b>${escapeHtml(resetCreditsLabel)}</span>
            ${resetCreditsHint ? `<span title="${escapeHtml(resetCreditsHint)}">${escapeHtml(resetCreditsHint)}</span>` : ''}
          </div>
        </div>
        <div class="cqc-overview-kpis">
          ${renderKpi('7 天剩余', remainingLabel(weeklyWindow), weeklyWindow ? `重置 ${weeklyWindow.resetLabel}` : '', progressClass(weeklyWindow?.remainingPercent))}
          ${renderKpi('5 小时剩余', remainingLabel(fiveHourWindow), fiveHourWindow ? `重置 ${fiveHourWindow.resetLabel}` : '', progressClass(fiveHourWindow?.remainingPercent))}
          ${renderKpi('周额度估算', weeklyEstimate ? `${formatInteger(weeklyEstimate.totalCreditsWithResetDay)}` : '--', weeklyEstimate ? `${formatUsd(weeklyEstimate.totalUsdWithResetDay)} · credits` : '', 'accent')}
        </div>
        <div class="cqc-signal-rail">
          <span>7 天可用容量</span>
          ${renderProgress(weeklyWindow?.remainingPercent)}
          <strong>${escapeHtml(remainingLabel(weeklyWindow))}</strong>
        </div>
      </div>

      ${result.resetCreditsError ? `<div class="cqc-warning">Manual resets 查询失败：${escapeHtml(result.resetCreditsError)}</div>` : ''}

      <div class="cqc-primary-grid">
        <section class="cqc-section-card">
          <div class="cqc-section-head">
            <h3>限制窗口</h3>
            <em>剩余额度与重置时间</em>
          </div>
          <div class="cqc-window-list">
            ${result.windows.length > 0 ? result.windows.map(renderWindowRow).join('') : '<div class="cqc-muted">未返回限制窗口。</div>'}
          </div>
        </section>

        <section class="cqc-section-card">
          <div class="cqc-section-head">
            <h3>周额度估算</h3>
            <em>按当前使用比例反推</em>
          </div>
          ${weeklyEstimateBlock}
        </section>
      </div>

      <section class="cqc-analytics-section">
        <div class="cqc-section-head">
          <h3>用量分析</h3>
          <em>${escapeHtml(analyticsSourceLabel(result.analytics?.source))}</em>
        </div>
        ${coverageBlock}
        ${result.analyticsError ? `<div class="cqc-warning">${escapeHtml(result.analyticsError)}</div>` : ''}
        ${heatmapBlock}
        <div class="cqc-ranges">
          ${(result.analytics?.ranges ?? []).map(renderRange).join('')}
        </div>
        <details class="cqc-runtime">
          <summary>运行与时间信息</summary>
          <div class="cqc-facts">
            ${renderFact('日期桶', result.analytics?.dateBucket ?? 'UTC', 'daily analytics 按 UTC 日期桶聚合')}
            ${renderFact('数据来源', `${analyticsSourceLabel(result.analytics?.source)}${result.analytics?.requestCount ? ` · ${result.analytics.requestCount} 次请求` : ''}`)}
            ${renderFact('当前账号', currentAccountLabel)}
            ${renderFact('Team role', teamRoleLabel(result), result.meError ? `me error: ${result.meError}` : '')}
            ${renderFact('用户时区', result.analytics?.userTimeZone ?? getUserTimeZone())}
            ${renderFact('后端当前', result.analytics?.backendNowLabel ?? '-', result.analytics?.backendNowUtcLabel ? `UTC: ${result.analytics.backendNowUtcLabel}` : '')}
            ${renderFact('窗口开始', result.analytics?.windowStartLabel ?? '-', result.analytics?.windowStartUtcLabel ? `UTC: ${result.analytics.windowStartUtcLabel}` : '')}
            ${renderFact('下次重置', result.analytics?.resetAtLabel ?? '-', result.analytics?.resetAtUtcLabel ? `UTC: ${result.analytics.resetAtUtcLabel}` : '')}
          </div>
        </details>
      </section>

      <footer class="cqc-footer">
        <span>更新于 ${escapeHtml(formatLocalDateTime(Date.parse(result.fetchedAt)))}</span>
        <span>会话 ${escapeHtml(result.tokenSource)}${result.hasAccountHeader ? ' · account header' : ''}</span>
      </footer>
    `;
  };

  const renderError = (message) => `
    <div class="cqc-error">
      <strong>加载失败</strong>
      <pre>${escapeHtml(message)}</pre>
      <p>先确认当前页面已登录 ChatGPT，并刷新页面后重试。脚本不会打印 access token 或原始 /usage 响应。</p>
    </div>
  `;

  const setBodyHtml = (body, renderKey, html) => {
    if (body.dataset.renderKey === renderKey) return;
    body.innerHTML = html;
    body.dataset.renderKey = renderKey;
  };

  const resolveStatusText = () => {
    if (state.loading) return '加载中';
    if (state.error) return '失败';
    if (state.result) return '已更新';
    return '未加载';
  };

  const updateButtonText = (shadow) => {
    const button = shadow.querySelector('.cqc-toggle');
    if (!button) return;
    button.setAttribute('aria-expanded', state.panelOpen ? 'true' : 'false');
    if (state.loading) {
      button.textContent = 'Codex 额度 · 加载中';
      return;
    }
    if (state.result) {
      const weeklyWindow = state.result.windows.find((item) => item.id === 'codex-weekly');
      if (weeklyWindow?.remainingPercent !== null && weeklyWindow?.remainingPercent !== undefined) {
        button.textContent = `Codex 7d ${Math.round(weeklyWindow.remainingPercent)}%`;
        return;
      }
      button.textContent = 'Codex 额度 · 就绪';
      return;
    }
    if (state.error) {
      button.textContent = 'Codex 额度 · 失败';
      return;
    }
    button.textContent = 'Codex 额度';
  };

  const render = (shadow) => {
    updateButtonText(shadow);
    const panel = shadow.querySelector('.cqc-panel');
    const body = shadow.querySelector('.cqc-body');
    const status = shadow.querySelector('.cqc-status');
    const exportButton = shadow.querySelector('.cqc-export');
    const shareButton = shadow.querySelector('.cqc-share');
    if (!panel || !body || !status || !exportButton || !shareButton) return;

    panel.hidden = !state.panelOpen;
    exportButton.disabled = !state.result;
    shareButton.disabled = !state.result;
    status.textContent = resolveStatusText();

    if (!state.panelOpen) {
      return;
    }

    if (state.loading) {
      setBodyHtml(
        body,
        'loading',
        '<div class="cqc-loading">正在读取 Codex quota 与 analytics...</div>'
      );
      return;
    }

    if (state.error) {
      setBodyHtml(body, `error:${state.error}`, renderError(state.error));
      return;
    }

    if (state.result) {
      setBodyHtml(body, `result:${state.result.fetchedAt}`, renderResult(state.result));
      return;
    }

    setBodyHtml(
      body,
      'idle',
      '<div class="cqc-loading">点击刷新，或等待自动加载。</div>'
    );
  };

  const refresh = async (shadow) => {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    render(shadow);

    try {
      state.result = await collectQuota();
    } catch (error) {
      state.result = null;
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      render(shadow);
    }
  };

  const exportJson = () => {
    if (!state.result) return;
    const payload = {
      generated_at: new Date().toISOString(),
      source: 'codex-quota-compass.user.js',
      ...state.result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codex-quota-${ymdUtc(Date.now())}.json`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1000);
  };

  // ===== SHARE CARD MODULE START =====
  // 分享卡片：从 state.result 提取数据，用 Canvas 2D 手工绘制竖版战报卡并导出 PNG。
  // 该模块复用上方的格式化和日用量分级助手，绘制逻辑保持自包含，便于提取到独立 harness 做视觉验证。

  const SHARE_CARD_FONT =
    'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const SHARE_CARD_WIDTH = 750;
  const SHARE_CARD_PAD = 40;
  const SHARE_CARD_SCALE = 2;
  const SHARE_CARD_GAP = 14;

  const SHARE_CARD_THEMES = {
    dark: {
      bg: '#101013',
      glow1: 'rgba(191, 90, 242, 0.18)',
      glow2: 'rgba(0, 122, 255, 0.15)',
      glow3: 'rgba(255, 55, 95, 0.10)',
      surface: 'rgba(255, 255, 255, 0.045)',
      surfaceBorder: 'rgba(255, 255, 255, 0.09)',
      text: '#f5f5f7',
      muted: '#a1a1a6',
      faint: '#6e6e73',
      accent: '#0a84ff',
      accentSoft: 'rgba(10, 132, 255, 0.16)',
      track: 'rgba(255, 255, 255, 0.10)',
      ringTrack: 'rgba(255, 255, 255, 0.10)',
      heat: ['rgba(255, 255, 255, 0.055)', '#0c3a63', '#0a6ee0', '#5e5ce6', '#bf5af2'],
      barFrom: '#0a84ff',
      barTo: '#bf5af2',
    },
    light: {
      bg: '#f5f5f7',
      glow1: 'rgba(191, 90, 242, 0.12)',
      glow2: 'rgba(0, 122, 255, 0.12)',
      glow3: 'rgba(255, 55, 95, 0.08)',
      surface: 'rgba(255, 255, 255, 0.88)',
      surfaceBorder: 'rgba(0, 0, 0, 0.08)',
      text: '#1d1d1f',
      muted: '#6e6e73',
      faint: '#a1a1a6',
      accent: '#007aff',
      accentSoft: 'rgba(0, 122, 255, 0.10)',
      track: 'rgba(0, 0, 0, 0.08)',
      ringTrack: 'rgba(0, 0, 0, 0.08)',
      heat: ['rgba(0, 0, 0, 0.055)', '#a8d4ff', '#4aa3ff', '#5e5ce6', '#bf5af2'],
      barFrom: '#007aff',
      barTo: '#bf5af2',
    },
  };

  const shareLocalYmd = (ms) => {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  };

  const buildShareCardModel = (result) => {
    const weeklyWindow = result.windows.find((item) => item.id === 'codex-weekly') ?? null;
    const fiveHourWindow = result.windows.find((item) => item.id === 'codex-five-hour') ?? null;
    const analytics = result.analytics ?? null;
    const weeklyEstimate = analytics?.weeklyEstimate ?? null;
    const rollingRange = analytics?.ranges?.find((range) => range.id === 'rolling') ?? null;
    const historyRange = analytics?.ranges?.find((range) => range.id === 'history') ?? null;
    const rollingDayValues = rollingRange && historyRange ? buildDailyUsageSeries(rollingRange) : [];
    const historyDayValues = historyRange ? buildDailyUsageSeries(historyRange) : [];
    const historyHeatScale = buildUsageHeatScale(historyDayValues);

    const remainingPercentLabel = (windowInfo) =>
      windowInfo?.remainingPercent === null || windowInfo?.remainingPercent === undefined
        ? '--'
        : `${Math.round(windowInfo.remainingPercent)}%`;

    const rangeKpis = (range) => {
      const cacheRatio = cacheHitRatio(range.cachedInputTokens, range.uncachedInputTokens);
      const usdPerMillion = usdPerMillionTokens(range.usd, range.tokens);
      return {
        credits: formatNumber(range.credits, 2),
        creditsHint: formatUsd(range.usd),
        tokens: formatInteger(range.tokens),
        tokensHint: `${formatInteger(range.turns)} turns`,
        cacheRatio: formatPercent(cacheRatio),
        cacheHint:
          cacheRatio === null
            ? '数据源无缓存明细'
            : `cached ${formatCompact(range.cachedInputTokens)} / input ${formatCompact(
                range.cachedInputTokens + range.uncachedInputTokens
              )}`,
        usdPerMillion: usdPerMillion === null ? '--' : formatUsd(usdPerMillion),
      };
    };

    return {
      version: APP_VERSION,
      generatedAtMs: Date.parse(result.fetchedAt),
      dateLabel: shareLocalYmd(Date.parse(result.fetchedAt)),
      planLabel: getPlanLabel(result.planType),
      sourceLabel: analyticsSourceLabel(analytics?.source),
      isTeamSource: analytics?.source === 'team-leaderboard',
      weekly: weeklyWindow
        ? {
            remainingPercent: weeklyWindow.remainingPercent,
            remainingLabel: remainingPercentLabel(weeklyWindow),
            resetLabel: weeklyWindow.resetLabel || '-',
          }
        : null,
      fiveHour: fiveHourWindow
        ? {
            remainingPercent: fiveHourWindow.remainingPercent,
            remainingLabel: remainingPercentLabel(fiveHourWindow),
            resetInLabel:
              fiveHourWindow.resetInLabel && fiveHourWindow.resetInLabel !== '-'
                ? `${fiveHourWindow.resetInLabel}后重置`
                : '重置时间未知',
          }
        : null,
      resetCredits:
        result.rateLimitResetCreditsAvailableCount === null ||
        result.rateLimitResetCreditsAvailableCount === undefined
          ? '--'
          : `${formatInteger(result.rateLimitResetCreditsAvailableCount)} 次可用`,
      estimate: weeklyEstimate
        ? {
            total: formatInteger(weeklyEstimate.totalCreditsWithResetDay),
            usd: formatUsd(weeklyEstimate.totalUsdWithResetDay),
            subLabel: weeklyEstimate.source
              ? `Team leaderboard 口径 · 剩余约 ${formatInteger(
                  weeklyEstimate.remainingCreditsWithResetDay
                )} credits`
              : `区间 ${formatInteger(weeklyEstimate.totalCreditsWithoutResetDay)} ~ ${formatInteger(
                  weeklyEstimate.totalCreditsWithResetDay
                )}（不含 ~ 含重置日）· 剩余约 ${formatInteger(
                  weeklyEstimate.remainingCreditsWithResetDay
                )} credits`,
          }
        : null,
      rolling: rollingRange
        ? {
            label: rollingRange.label,
            dateLabel: rangeDateLabel(rollingRange),
            kpis: rangeKpis(rollingRange),
            dayValues: rollingDayValues,
          }
        : null,
      history: historyRange
        ? {
            label: historyRange.label,
            dateLabel: rangeDateLabel(historyRange),
            kpis: rangeKpis(historyRange),
            activeDays: formatInteger(historyRange.returnedDays),
            fetchWindowDays: analytics?.fetchWindowDays ?? null,
            firstDate: historyRange.firstDate || '',
            lastDate: historyRange.lastDate || '',
            dayValues: historyDayValues,
            heatScale: historyHeatScale,
          }
        : null,
    };
  };

  const shareRoundRectPath = (ctx, x, y, width, height, radius) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  };

  const shareFillRoundRect = (ctx, x, y, width, height, radius, fill) => {
    shareRoundRectPath(ctx, x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  const shareText = (ctx, text, x, y, options = {}) => {
    const { size = 13, weight = 400, color, align = 'left', baseline = 'alphabetic' } = options;
    ctx.save();
    ctx.font = `${weight} ${size}px ${SHARE_CARD_FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(String(text), x, y);
    ctx.restore();
  };

  const shareGlow = (ctx, cx, cy, radius, color) => {
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  };

  const shareSurface = (ctx, x, y, width, height, theme) => {
    shareFillRoundRect(ctx, x, y, width, height, 18, theme.surface);
    shareRoundRectPath(ctx, x + 0.5, y + 0.5, width - 1, height - 1, 17.5);
    ctx.strokeStyle = theme.surfaceBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const shareSlimBar = (ctx, x, y, width, height, percent, theme) => {
    shareFillRoundRect(ctx, x, y, width, height, height / 2, theme.track);
    if (percent === null || percent === undefined) return;
    const ratio = clamp(percent, 0, 100) / 100;
    if (ratio <= 0) return;
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, theme.barFrom);
    gradient.addColorStop(1, theme.barTo);
    shareFillRoundRect(ctx, x, y, Math.max(height, width * ratio), height, height / 2, gradient);
  };

  const shareKpiCell = (ctx, x, y, label, value, hint, theme) => {
    shareText(ctx, label, x, y, { size: 10, color: theme.muted });
    shareText(ctx, value, x, y + 25, { size: 17, weight: 700, color: theme.text });
    if (hint) {
      shareText(ctx, hint, x, y + 41, { size: 9, color: theme.faint });
    }
  };

  const shareKpiRow = (ctx, x, y, width, cells, theme) => {
    const cellWidth = width / cells.length;
    cells.forEach((cell, index) => {
      shareKpiCell(ctx, x + index * cellWidth, y, cell.label, cell.value, cell.hint, theme);
    });
  };

  const shareSectionHead = (ctx, x, y, width, title, sideLabel, theme) => {
    shareText(ctx, title, x, y, { size: 14, weight: 700, color: theme.text });
    if (sideLabel) {
      shareText(ctx, sideLabel, x + width, y, { size: 10, color: theme.faint, align: 'right' });
    }
  };

  const drawShareCardHeader = (ctx, x, y, width, height, model, theme) => {
    shareText(ctx, 'Codex Quota Compass', x, y + 26, { size: 20, weight: 700, color: theme.text });
    shareText(ctx, `Codex 额度战报 · ${model.dateLabel}`, x, y + 48, {
      size: 12,
      color: theme.muted,
    });

    ctx.save();
    ctx.font = `600 12px ${SHARE_CARD_FONT}`;
    const badgeWidth = ctx.measureText(model.planLabel).width + 24;
    ctx.restore();
    const badgeX = x + width - badgeWidth;
    const badgeY = y + 12;
    shareFillRoundRect(ctx, badgeX, badgeY, badgeWidth, 26, 13, theme.accentSoft);
    shareText(ctx, model.planLabel, badgeX + badgeWidth / 2, badgeY + 13, {
      size: 12,
      weight: 600,
      color: theme.accent,
      align: 'center',
      baseline: 'middle',
    });
  };

  const drawShareCardHero = (ctx, x, y, width, height, model, theme) => {
    shareSurface(ctx, x, y, width, height, theme);

    const ringCx = x + 32 + 50;
    const ringCy = y + height / 2;
    const ringRadius = 50;
    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = theme.ringTrack;
    ctx.beginPath();
    ctx.arc(ringCx, ringCy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    const percent = model.weekly?.remainingPercent;
    if (percent !== null && percent !== undefined) {
      const gradient = ctx.createLinearGradient(
        ringCx - ringRadius,
        ringCy - ringRadius,
        ringCx + ringRadius,
        ringCy + ringRadius
      );
      gradient.addColorStop(0, '#0a84ff');
      gradient.addColorStop(0.55, '#5e5ce6');
      gradient.addColorStop(1, '#bf5af2');
      ctx.strokeStyle = gradient;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(
        ringCx,
        ringCy,
        ringRadius,
        -Math.PI / 2,
        -Math.PI / 2 + (clamp(percent, 0, 100) / 100) * Math.PI * 2
      );
      ctx.stroke();
    }
    ctx.restore();
    shareText(ctx, model.weekly?.remainingLabel ?? '--', ringCx, ringCy - 2, {
      size: 24,
      weight: 700,
      color: theme.text,
      align: 'center',
      baseline: 'middle',
    });
    shareText(ctx, '7 天剩余', ringCx, ringCy + 18, {
      size: 10,
      color: theme.muted,
      align: 'center',
      baseline: 'middle',
    });

    const rightX = x + 32 + 50 * 2 + 36;
    const rightWidth = x + width - 28 - rightX;
    const rowY = y + 34;

    shareText(ctx, '5 小时剩余', rightX, rowY, { size: 12, color: theme.muted });
    shareText(ctx, model.fiveHour?.remainingLabel ?? '--', rightX + rightWidth, rowY, {
      size: 15,
      weight: 700,
      color: theme.text,
      align: 'right',
    });
    shareSlimBar(ctx, rightX, rowY + 10, rightWidth, 7, model.fiveHour?.remainingPercent, theme);
    shareText(ctx, model.fiveHour?.resetInLabel ?? '-', rightX, rowY + 34, {
      size: 10,
      color: theme.faint,
    });

    shareText(ctx, '7 天重置', rightX, rowY + 62, { size: 12, color: theme.muted });
    shareText(ctx, model.weekly?.resetLabel ?? '-', rightX + rightWidth, rowY + 62, {
      size: 12,
      weight: 600,
      color: theme.text,
      align: 'right',
    });

    shareText(ctx, '手动重置', rightX, rowY + 90, { size: 12, color: theme.muted });
    shareText(ctx, model.resetCredits, rightX + rightWidth, rowY + 90, {
      size: 12,
      weight: 600,
      color: theme.text,
      align: 'right',
    });
  };

  const drawShareCardEstimate = (ctx, x, y, width, height, model, theme) => {
    shareSurface(ctx, x, y, width, height, theme);
    const innerX = x + 24;
    const innerWidth = width - 48;

    shareText(ctx, '周额度预计', innerX, y + 32, { size: 13, weight: 700, color: theme.text });
    shareText(ctx, '按使用比例反推 · 估算值', innerX + innerWidth, y + 32, {
      size: 10,
      color: theme.faint,
      align: 'right',
    });

    shareText(ctx, `~${model.estimate.total}`, innerX, y + 72, {
      size: 30,
      weight: 700,
      color: theme.text,
    });
    ctx.save();
    ctx.font = `700 30px ${SHARE_CARD_FONT}`;
    const totalWidth = ctx.measureText(`~${model.estimate.total}`).width;
    ctx.restore();
    shareText(ctx, ' credits', innerX + totalWidth + 4, y + 72, { size: 14, color: theme.muted });
    shareText(ctx, `≈ ${model.estimate.usd}`, innerX + innerWidth, y + 72, {
      size: 16,
      weight: 700,
      color: theme.accent,
      align: 'right',
    });

    shareText(ctx, model.estimate.subLabel, innerX, y + 96, { size: 11, color: theme.muted });
  };

  const drawShareCardBarChart = (ctx, x, y, width, height, dayValues, theme) => {
    const maxValue = Math.max(...dayValues.map((item) => item.credits), 0.0001);
    const gap = 3;
    const barWidth = (width - gap * (dayValues.length - 1)) / dayValues.length;
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, theme.barTo);
    gradient.addColorStop(1, theme.barFrom);

    dayValues.forEach((item, index) => {
      const barX = x + index * (barWidth + gap);
      if (item.credits <= 0) {
        shareFillRoundRect(ctx, barX, y + height - 2, barWidth, 2, 1, theme.track);
        return;
      }
      const barHeight = Math.max(3, (item.credits / maxValue) * height);
      shareFillRoundRect(
        ctx,
        barX,
        y + height - barHeight,
        barWidth,
        barHeight,
        Math.min(3, barWidth / 2),
        gradient
      );
    });
  };

  const drawShareCardRolling = (ctx, x, y, width, height, model, theme) => {
    shareSurface(ctx, x, y, width, height, theme);
    const innerX = x + 24;
    const innerWidth = width - 48;
    const rolling = model.rolling;

    shareSectionHead(ctx, innerX, y + 32, innerWidth, rolling.label, rolling.dateLabel, theme);
    shareKpiRow(
      ctx,
      innerX,
      y + 54,
      innerWidth,
      [
        { label: 'Credits', value: rolling.kpis.credits, hint: rolling.kpis.creditsHint },
        { label: 'Tokens', value: rolling.kpis.tokens, hint: rolling.kpis.tokensHint },
        { label: '缓存命中率', value: rolling.kpis.cacheRatio, hint: rolling.kpis.cacheHint },
        { label: '混合成本', value: rolling.kpis.usdPerMillion, hint: 'USD / 1M 总 tokens' },
      ],
      theme
    );

    if (rolling.dayValues.length > 0) {
      drawShareCardBarChart(ctx, innerX, y + 118, innerWidth, 64, rolling.dayValues, theme);
      shareText(ctx, rolling.dayValues[0].date, innerX, y + 198, { size: 9, color: theme.faint });
      shareText(
        ctx,
        rolling.dayValues[rolling.dayValues.length - 1].date,
        innerX + innerWidth,
        y + 198,
        { size: 9, color: theme.faint, align: 'right' }
      );
    } else {
      shareText(ctx, '当前数据来源没有每日明细，无法绘制趋势图。', innerX, y + 110, {
        size: 11,
        color: theme.faint,
      });
    }
  };

  const drawShareCardHeatmap = (ctx, x, y, width, model, theme) => {
    const history = model.history;
    const dayValues = history.dayValues;
    if (dayValues.length === 0) return;

    const cell = 9;
    const step = cell + 2;
    const startMs = Date.parse(`${dayValues[0].date}T00:00:00Z`);
    const startDow = new Date(startMs).getUTCDay();
    const heatScale = history.heatScale ?? buildUsageHeatScale(dayValues);

    let lastMonth = -1;
    dayValues.forEach((item, index) => {
      const gridIndex = startDow + index;
      const column = Math.floor(gridIndex / 7);
      const row = gridIndex % 7;
      const cellX = x + column * step;
      const cellY = y + 16 + row * step;
      shareFillRoundRect(
        ctx,
        cellX,
        cellY,
        cell,
        cell,
        2,
        theme.heat[usageHeatLevel(item.credits, heatScale)]
      );

      const month = Number(item.date.slice(5, 7));
      if (row === 0 && month !== lastMonth) {
        shareText(ctx, `${month}月`, cellX, y + 8, { size: 9, color: theme.faint });
        lastMonth = month;
      }
    });

    const legendY = y + 16 + 7 * step + 8;
    const legendCell = 8;
    const legendWidth = 24 + 5 * (legendCell + 3) + 24;
    let legendX = x + width - legendWidth;
    shareText(ctx, '少', legendX, legendY + legendCell - 1, { size: 9, color: theme.faint });
    legendX += 18;
    for (let level = 0; level < 5; level += 1) {
      shareFillRoundRect(ctx, legendX, legendY, legendCell, legendCell, 2, theme.heat[level]);
      legendX += legendCell + 3;
    }
    shareText(ctx, '多', legendX + 4, legendY + legendCell - 1, { size: 9, color: theme.faint });
  };

  const drawShareCardHistory = (ctx, x, y, width, height, model, theme) => {
    shareSurface(ctx, x, y, width, height, theme);
    const innerX = x + 24;
    const innerWidth = width - 48;
    const history = model.history;

    shareSectionHead(ctx, innerX, y + 32, innerWidth, history.label, history.dateLabel, theme);
    shareKpiRow(
      ctx,
      innerX,
      y + 54,
      innerWidth,
      [
        { label: 'Credits', value: history.kpis.credits, hint: history.kpis.creditsHint },
        { label: 'Tokens', value: history.kpis.tokens, hint: history.kpis.tokensHint },
        {
          label: '活跃天数',
          value: history.activeDays,
          hint: history.fetchWindowDays ? `查询窗口 ${history.fetchWindowDays} 天` : '',
        },
        { label: '混合成本', value: history.kpis.usdPerMillion, hint: 'USD / 1M 总 tokens' },
      ],
      theme
    );

    if (history.dayValues.length > 0) {
      drawShareCardHeatmap(ctx, innerX, y + 116, innerWidth, model, theme);
    } else {
      shareText(ctx, '当前数据来源没有每日明细，无法绘制贡献热力图。', innerX, y + 110, {
        size: 11,
        color: theme.faint,
      });
    }
  };

  const drawShareCardFooter = (ctx, x, y, width, height, model, theme) => {
    const coverage = model.history?.firstDate
      ? `覆盖 ${model.history.firstDate} → ${model.history.lastDate}`
      : '暂无用量数据覆盖';
    shareText(ctx, coverage, x, y + 16, { size: 10, color: theme.faint });
    shareText(
      ctx,
      `${model.sourceLabel} · 更新于 ${formatLocalDateTime(model.generatedAtMs)}`,
      x + width,
      y + 16,
      { size: 10, color: theme.faint, align: 'right' }
    );
    shareText(
      ctx,
      `Codex Quota Compass v${model.version} · 数据来自 ChatGPT Codex 接口，仅供个人分享参考`,
      x + width / 2,
      y + 38,
      { size: 9, color: theme.faint, align: 'center' }
    );
  };

  const SHARE_CARD_DRAWERS = {
    header: drawShareCardHeader,
    hero: drawShareCardHero,
    estimate: drawShareCardEstimate,
    rolling: drawShareCardRolling,
    history: drawShareCardHistory,
    footer: drawShareCardFooter,
  };

  const buildShareCardSections = (model) => {
    const sections = [
      { id: 'header', height: 64 },
      { id: 'hero', height: 168 },
    ];
    if (model.estimate) sections.push({ id: 'estimate', height: 116 });
    if (model.rolling) {
      sections.push({ id: 'rolling', height: model.rolling.dayValues.length > 0 ? 210 : 132 });
    }
    if (model.history) {
      sections.push({ id: 'history', height: model.history.dayValues.length > 0 ? 252 : 132 });
    }
    sections.push({ id: 'footer', height: 50 });
    return sections;
  };

  const renderShareCardCanvas = (model, themeName = 'dark') => {
    const theme = SHARE_CARD_THEMES[themeName] ?? SHARE_CARD_THEMES.dark;
    const sections = buildShareCardSections(model);
    let contentHeight = 34 + 28;
    sections.forEach((section, index) => {
      contentHeight += section.height + (index > 0 ? SHARE_CARD_GAP : 0);
    });

    const canvas = document.createElement('canvas');
    canvas.width = SHARE_CARD_WIDTH * SHARE_CARD_SCALE;
    canvas.height = contentHeight * SHARE_CARD_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SHARE_CARD_SCALE, SHARE_CARD_SCALE);

    shareRoundRectPath(ctx, 0, 0, SHARE_CARD_WIDTH, contentHeight, 28);
    ctx.clip();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, SHARE_CARD_WIDTH, contentHeight);

    shareGlow(ctx, SHARE_CARD_WIDTH * 0.88, -40, 320, theme.glow1);
    shareGlow(ctx, -60, contentHeight * 0.5, 300, theme.glow2);
    shareGlow(ctx, SHARE_CARD_WIDTH * 0.35, contentHeight + 30, 280, theme.glow3);

    const aurora = ctx.createLinearGradient(0, 0, SHARE_CARD_WIDTH, 0);
    aurora.addColorStop(0, '#007aff');
    aurora.addColorStop(0.42, '#bf5af2');
    aurora.addColorStop(0.72, '#ff375f');
    aurora.addColorStop(1, '#ff9500');
    ctx.fillStyle = aurora;
    ctx.fillRect(0, 0, SHARE_CARD_WIDTH, 5);

    let cursorY = 34;
    sections.forEach((section, index) => {
      if (index > 0) cursorY += SHARE_CARD_GAP;
      SHARE_CARD_DRAWERS[section.id](
        ctx,
        SHARE_CARD_PAD,
        cursorY,
        SHARE_CARD_WIDTH - SHARE_CARD_PAD * 2,
        section.height,
        model,
        theme
      );
      cursorY += section.height;
    });

    return canvas;
  };

  const exportShareCard = () => {
    if (!state.result) return;
    try {
      const model = buildShareCardModel(state.result);
      const canvas = renderShareCardCanvas(model, 'light');
      canvas.toBlob((blob) => {
        if (!blob) {
          window.alert('生成分享卡片失败：浏览器未返回图像数据。');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `codex-quota-card-${ymdUtc(Date.now())}.png`;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          link.remove();
        }, 1000);
      }, 'image/png');
    } catch (error) {
      console.error('[CodexQuotaCompass] 分享卡片生成失败', error);
      window.alert(`生成分享卡片失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // ===== SHARE CARD MODULE END =====

  const css = `
    :host {
      color-scheme: light dark;
      --cqc-panel: rgba(245, 245, 247, 0.86);
      --cqc-surface: #ffffff;
      --cqc-surface-subtle: #f5f5f7;
      --cqc-text: #1d1d1f;
      --cqc-muted: #6e6e73;
      --cqc-faint: #a1a1a6;
      --cqc-border: rgba(0, 0, 0, 0.07);
      --cqc-border-strong: rgba(0, 0, 0, 0.12);
      --cqc-shadow: 0 24px 70px rgba(0, 0, 0, 0.14), 0 2px 10px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.45);
      --cqc-accent: #007aff;
      --cqc-accent-soft: rgba(0, 122, 255, 0.08);
      --cqc-accent-grad: linear-gradient(135deg, #007aff, #bf5af2 42%, #ff375f 72%, #ff9500);
      --cqc-grad-high: linear-gradient(90deg, #007aff, #5e5ce6 55%, #64d2ff);
      --cqc-grad-medium: linear-gradient(90deg, #ff9500, #ffbf47);
      --cqc-grad-low: linear-gradient(90deg, #ff3b30, #ff6482);
      --cqc-amber: #ff9500;
      --cqc-amber-soft: rgba(255, 149, 0, 0.12);
      --cqc-red: #ff3b30;
      --cqc-red-soft: rgba(255, 59, 48, 0.10);
      --cqc-track: rgba(0, 0, 0, 0.08);
      --cqc-track-inset: inset 0 1px 2px rgba(0, 0, 0, 0.08);
      --cqc-glow-high: 0 0 10px rgba(0, 122, 255, 0.34);
      --cqc-glow-medium: 0 0 10px rgba(255, 149, 0, 0.34);
      --cqc-glow-low: 0 0 10px rgba(255, 59, 48, 0.32);
      --cqc-table-head: rgba(0, 0, 0, 0.035);
      --cqc-toggle-shadow: 0 10px 26px rgba(191, 90, 242, 0.32), 0 2px 8px rgba(0, 122, 255, 0.20);
      --cqc-heat-0: ${SHARE_CARD_THEMES.light.heat[0]};
      --cqc-heat-1: ${SHARE_CARD_THEMES.light.heat[1]};
      --cqc-heat-2: ${SHARE_CARD_THEMES.light.heat[2]};
      --cqc-heat-3: ${SHARE_CARD_THEMES.light.heat[3]};
      --cqc-heat-4: ${SHARE_CARD_THEMES.light.heat[4]};
      font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-variant-numeric: tabular-nums;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    button {
      font: inherit;
    }
    @keyframes cqc-aurora {
      from {
        background-position: 0% 50%;
      }
      to {
        background-position: 100% 50%;
      }
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --cqc-panel: rgba(28, 28, 30, 0.82);
        --cqc-surface: rgba(44, 44, 46, 0.72);
        --cqc-surface-subtle: rgba(58, 58, 60, 0.55);
        --cqc-text: #f5f5f7;
        --cqc-muted: #98989d;
        --cqc-faint: #6e6e73;
        --cqc-border: rgba(255, 255, 255, 0.09);
        --cqc-border-strong: rgba(255, 255, 255, 0.16);
        --cqc-shadow: 0 24px 80px rgba(0, 0, 0, 0.56), 0 2px 12px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.07);
        --cqc-accent: #0a84ff;
        --cqc-accent-soft: rgba(10, 132, 255, 0.16);
        --cqc-accent-grad: linear-gradient(135deg, #0a84ff, #bf5af2 42%, #ff375f 72%, #ff9f0a);
        --cqc-grad-high: linear-gradient(90deg, #0a84ff, #7d7aff 55%, #64d2ff);
        --cqc-grad-medium: linear-gradient(90deg, #ff9f0a, #ffd60a);
        --cqc-grad-low: linear-gradient(90deg, #ff453a, #ff6482);
        --cqc-amber: #ff9f0a;
        --cqc-amber-soft: rgba(255, 159, 10, 0.14);
        --cqc-red: #ff453a;
        --cqc-red-soft: rgba(255, 69, 58, 0.14);
        --cqc-track: rgba(255, 255, 255, 0.12);
        --cqc-track-inset: inset 0 1px 2px rgba(0, 0, 0, 0.38);
        --cqc-glow-high: 0 0 12px rgba(10, 132, 255, 0.46);
        --cqc-glow-medium: 0 0 12px rgba(255, 159, 10, 0.36);
        --cqc-glow-low: 0 0 12px rgba(255, 69, 58, 0.40);
        --cqc-table-head: rgba(255, 255, 255, 0.05);
        --cqc-toggle-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 0 26px rgba(191, 90, 242, 0.30);
        --cqc-heat-0: ${SHARE_CARD_THEMES.dark.heat[0]};
        --cqc-heat-1: ${SHARE_CARD_THEMES.dark.heat[1]};
        --cqc-heat-2: ${SHARE_CARD_THEMES.dark.heat[2]};
        --cqc-heat-3: ${SHARE_CARD_THEMES.dark.heat[3]};
        --cqc-heat-4: ${SHARE_CARD_THEMES.dark.heat[4]};
      }
    }
    .cqc-toggle {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483646;
      min-width: 136px;
      height: 38px;
      border: 0;
      border-radius: 999px;
      background: var(--cqc-accent-grad);
      background-size: 220% 220%;
      animation: cqc-aurora 9s ease-in-out infinite alternate;
      color: #ffffff;
      box-shadow: var(--cqc-toggle-shadow);
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      padding: 0 15px;
      transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
    }
    .cqc-toggle::before {
      content: '';
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.25);
      vertical-align: 1px;
    }
    .cqc-toggle:hover {
      transform: translateY(-1px);
      filter: brightness(1.06);
    }
    .cqc-panel {
      position: fixed;
      right: 20px;
      bottom: 70px;
      z-index: 2147483646;
      width: min(880px, calc(100vw - 32px));
      max-height: min(840px, calc(100vh - 96px));
      display: flex;
      flex-direction: column;
      background: var(--cqc-panel);
      color: var(--cqc-text);
      border: 1px solid var(--cqc-border);
      border-radius: 22px;
      box-shadow: var(--cqc-shadow);
      backdrop-filter: blur(30px) saturate(1.8);
      -webkit-backdrop-filter: blur(30px) saturate(1.8);
      overflow: hidden;
      contain: layout paint style;
    }
    .cqc-panel[hidden] {
      display: none;
    }
    .cqc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 56px;
      padding: 10px 14px 10px 18px;
      border-bottom: 1px solid var(--cqc-border);
    }
    .cqc-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .cqc-title strong {
      font-size: 14px;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }
    .cqc-title span {
      color: var(--cqc-muted);
      font-size: 10.5px;
    }
    .cqc-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .cqc-action {
      height: 30px;
      border: 1px solid var(--cqc-border);
      border-radius: 999px;
      background: transparent;
      color: var(--cqc-text);
      cursor: pointer;
      padding: 0 13px;
      font-size: 11.5px;
      font-weight: 600;
      transition: background 140ms ease, border-color 140ms ease;
    }
    .cqc-action.primary {
      color: #fff;
      background: var(--cqc-accent);
      border-color: transparent;
    }
    .cqc-action:not(:disabled):hover {
      border-color: var(--cqc-accent);
      background: var(--cqc-accent-soft);
    }
    .cqc-action.primary:not(:disabled):hover {
      color: #fff;
      background: var(--cqc-accent);
      filter: brightness(1.07);
    }
    .cqc-action:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .cqc-body {
      overflow: auto;
      padding: 16px;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .cqc-loading,
    .cqc-muted {
      color: var(--cqc-muted);
      font-size: 12px;
      padding: 18px 16px;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0;
      font-size: 13px;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }
    h3::before {
      content: '';
      flex: 0 0 auto;
      width: 3px;
      height: 11px;
      border-radius: 2px;
      background: color-mix(in srgb, var(--cqc-text) 78%, transparent);
    }
    .cqc-overview {
      position: relative;
      display: grid;
      grid-template-columns: minmax(190px, 0.85fr) minmax(0, 2.15fr);
      gap: 14px 18px;
      padding: 16px;
      overflow: hidden;
      background:
        radial-gradient(130% 150% at 0% 0%, var(--cqc-accent-soft), transparent 55%),
        var(--cqc-surface);
      border: 1px solid var(--cqc-border);
      border-radius: 18px;
    }
    .cqc-overview::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--cqc-accent-grad);
      background-size: 220% 220%;
      animation: cqc-aurora 9s ease-in-out infinite alternate;
    }
    .cqc-identity {
      min-width: 0;
      padding-right: 14px;
      border-right: 1px solid var(--cqc-border);
    }
    .cqc-plan-row {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
    }
    .cqc-plan-row strong {
      flex: 0 0 auto;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--cqc-accent);
      color: #ffffff;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.01em;
      line-height: 1.3;
    }
    .cqc-account {
      min-width: 0;
      overflow: hidden;
      color: var(--cqc-muted);
      font-size: 11.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-utility-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }
    .cqc-utility-row span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      max-width: 100%;
      padding: 3px 7px;
      overflow: hidden;
      border: 1px solid var(--cqc-border);
      border-radius: 8px;
      color: var(--cqc-muted);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-utility-row b {
      color: var(--cqc-text);
    }
    .cqc-overview-kpis {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .cqc-kpi {
      min-width: 0;
      padding: 3px 10px 5px;
      border-left: 2px solid var(--cqc-border-strong);
    }
    .cqc-kpi.high {
      border-left-color: var(--cqc-accent);
    }
    .cqc-kpi.medium {
      border-left-color: var(--cqc-amber);
    }
    .cqc-kpi.low {
      border-left-color: var(--cqc-red);
    }
    .cqc-kpi.accent {
      border-left-color: var(--cqc-accent);
    }
    .cqc-kpi span,
    .cqc-kpi small {
      display: block;
      min-width: 0;
      overflow: hidden;
      color: var(--cqc-muted);
      font-size: 10.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-kpi strong {
      display: block;
      margin: 4px 0 3px;
      overflow: hidden;
      font-size: 20px;
      line-height: 1;
      letter-spacing: -0.05em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-signal-rail {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: auto minmax(120px, 1fr) auto;
      align-items: center;
      gap: 10px;
      color: var(--cqc-muted);
      font-size: 10.5px;
    }
    .cqc-signal-rail strong {
      color: var(--cqc-text);
      font-size: 11.5px;
    }
    .cqc-primary-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
      gap: 12px;
      margin-top: 12px;
    }
    .cqc-section-card,
    .cqc-analytics-section {
      min-width: 0;
      padding: 14px;
      background: var(--cqc-surface);
      border: 1px solid var(--cqc-border);
      border-radius: 16px;
    }
    .cqc-analytics-section {
      margin-top: 12px;
    }
    .cqc-section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .cqc-section-head em {
      color: var(--cqc-faint);
      font-size: 10.5px;
      font-style: normal;
      text-align: right;
    }
    .cqc-window-list,
    .cqc-ranges {
      display: grid;
      gap: 10px;
    }
    .cqc-window {
      background: var(--cqc-surface-subtle);
      border: 1px solid var(--cqc-border);
      border-radius: 14px;
      padding: 10px 12px;
      contain: content;
    }
    .cqc-window-main,
    .cqc-range-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 9px;
      margin-bottom: 7px;
    }
    .cqc-window-title {
      font-size: 11.5px;
      font-weight: 700;
    }
    .cqc-window-sub,
    .cqc-range-header span,
    .cqc-range-header em,
    .cqc-facts,
    .cqc-footer {
      color: var(--cqc-muted);
      font-size: 10.5px;
    }
    .cqc-window-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      white-space: nowrap;
    }
    .cqc-window-meta strong {
      font-size: 14px;
    }
    .cqc-window-meta span {
      color: var(--cqc-muted);
      font-size: 10px;
    }
    .cqc-progress {
      height: 7px;
      border-radius: 999px;
      background: var(--cqc-track);
      box-shadow: var(--cqc-track-inset);
    }
    .cqc-progress-fill {
      height: 100%;
      border-radius: inherit;
      transition: width 180ms ease;
    }
    .cqc-progress-fill.high {
      background: var(--cqc-grad-high);
      box-shadow: var(--cqc-glow-high);
    }
    .cqc-progress-fill.medium {
      background: var(--cqc-grad-medium);
      box-shadow: var(--cqc-glow-medium);
    }
    .cqc-progress-fill.low {
      background: var(--cqc-grad-low);
      box-shadow: var(--cqc-glow-low);
    }
    .cqc-estimate {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .cqc-estimate.single {
      grid-template-columns: 1fr;
    }
    .cqc-estimate-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      padding: 10px 12px;
      background: var(--cqc-surface-subtle);
      border: 1px solid var(--cqc-border);
      border-radius: 14px;
    }
    .cqc-estimate span,
    .cqc-estimate em,
    .cqc-estimate p {
      color: var(--cqc-muted);
      font-size: 10.5px;
      font-style: normal;
    }
    .cqc-estimate strong {
      overflow: hidden;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-estimate p {
      grid-column: 1 / -1;
      margin: 0;
      padding: 8px 10px;
      background: var(--cqc-surface-subtle);
      border: 1px solid var(--cqc-border);
      border-radius: 12px;
      line-height: 1.5;
    }
    .cqc-coverage {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      margin-bottom: 10px;
      padding: 10px 12px;
      background: var(--cqc-surface-subtle);
      border: 1px solid var(--cqc-border);
      border-radius: 14px;
    }
    .cqc-coverage div {
      min-width: 0;
    }
    .cqc-coverage span,
    .cqc-coverage em {
      display: block;
      color: var(--cqc-muted);
      font-size: 10px;
      font-style: normal;
    }
    .cqc-coverage strong {
      display: inline-block;
      max-width: 100%;
      margin-top: 2px;
      overflow: hidden;
      font-size: 11.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-heatmap-card {
      --cqc-heatmap-cell: 9px;
      --cqc-heatmap-gap: 2px;
      min-width: 0;
      margin: 10px 0;
      padding: 11px 12px;
      background: var(--cqc-surface-subtle);
      border: 1px solid var(--cqc-border);
      border-radius: 14px;
    }
    .cqc-heatmap-head,
    .cqc-heatmap-meta {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .cqc-heatmap-head strong,
    .cqc-heatmap-head span {
      display: block;
    }
    .cqc-heatmap-head strong {
      font-size: 11.5px;
    }
    .cqc-heatmap-head span,
    .cqc-heatmap-head em,
    .cqc-heatmap-meta {
      color: var(--cqc-muted);
      font-size: 9.5px;
      font-style: normal;
      line-height: 1.45;
    }
    .cqc-heatmap-head em {
      flex: 0 0 auto;
    }
    .cqc-heatmap-scroll {
      max-width: 100%;
      margin-top: 6px;
      padding: 2px 0 7px;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scrollbar-color: var(--cqc-border-strong) transparent;
      scrollbar-width: thin;
    }
    .cqc-heatmap-inner {
      width: max-content;
      min-width: 100%;
    }
    .cqc-heatmap-months,
    .cqc-heatmap-grid {
      display: grid;
      grid-template-columns: repeat(var(--cqc-heatmap-columns), var(--cqc-heatmap-cell));
      column-gap: var(--cqc-heatmap-gap);
      width: max-content;
    }
    .cqc-heatmap-months {
      min-height: 11px;
      margin-bottom: 4px;
      align-items: end;
      color: var(--cqc-faint);
      font-size: 8.5px;
      line-height: 1.2;
    }
    .cqc-heatmap-months span {
      min-width: 0;
      overflow: visible;
      white-space: nowrap;
    }
    .cqc-heatmap-grid {
      grid-template-rows: repeat(7, var(--cqc-heatmap-cell));
      grid-auto-flow: column;
      row-gap: var(--cqc-heatmap-gap);
    }
    .cqc-heatmap-cell {
      display: block;
      width: var(--cqc-heatmap-cell);
      height: var(--cqc-heatmap-cell);
      border-radius: 2px;
      box-shadow: inset 0 0 0 0.5px var(--cqc-border);
    }
    .cqc-heatmap-cell.placeholder {
      visibility: hidden;
    }
    .cqc-heatmap-cell.level-0 {
      background: var(--cqc-heat-0);
    }
    .cqc-heatmap-cell.level-1 {
      background: var(--cqc-heat-1);
    }
    .cqc-heatmap-cell.level-2 {
      background: var(--cqc-heat-2);
    }
    .cqc-heatmap-cell.level-3 {
      background: var(--cqc-heat-3);
    }
    .cqc-heatmap-cell.level-4 {
      background: var(--cqc-heat-4);
    }
    .cqc-heatmap-meta {
      align-items: center;
      margin-top: 5px;
    }
    .cqc-heatmap-meta > span {
      min-width: 0;
    }
    .cqc-heatmap-legend {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 3px;
      color: var(--cqc-faint);
      white-space: nowrap;
    }
    .cqc-heatmap-legend .cqc-heatmap-cell {
      width: 8px;
      height: 8px;
    }
    .cqc-tip {
      position: fixed;
      z-index: 2147483647;
      padding: 6px 9px;
      background: var(--cqc-surface);
      color: var(--cqc-text);
      border: 1px solid var(--cqc-border-strong);
      border-radius: 9px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      font-size: 10.5px;
      line-height: 1.45;
      pointer-events: none;
      white-space: nowrap;
    }
    .cqc-tip[hidden] {
      display: none;
    }
    .cqc-tip strong {
      display: block;
      margin-bottom: 1px;
      font-size: 11px;
    }
    .cqc-tip span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--cqc-muted);
    }
    .cqc-tip b {
      font-weight: 500;
    }
    .cqc-tip-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      box-shadow: inset 0 0 0 0.5px var(--cqc-border-strong);
    }
    .cqc-tip-dot.level-0 {
      background: var(--cqc-heat-0);
    }
    .cqc-tip-dot.level-1 {
      background: var(--cqc-heat-1);
    }
    .cqc-tip-dot.level-2 {
      background: var(--cqc-heat-2);
    }
    .cqc-tip-dot.level-3 {
      background: var(--cqc-heat-3);
    }
    .cqc-tip-dot.level-4 {
      background: var(--cqc-heat-4);
    }
    .cqc-ranges {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .cqc-range {
      min-width: 0;
      align-self: start;
      padding: 12px;
      background: var(--cqc-surface-subtle);
      border: 1px solid var(--cqc-border);
      border-radius: 14px;
      contain: content;
    }
    .cqc-range.history .cqc-range-header strong::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      margin-right: 6px;
      border-radius: 2px;
      background: var(--cqc-accent-grad);
      vertical-align: 1px;
    }
    .cqc-range-header strong {
      display: block;
      margin-bottom: 2px;
      font-size: 11.5px;
    }
    .cqc-range-header span,
    .cqc-range-header em {
      color: var(--cqc-muted);
      font-size: 10px;
      font-style: normal;
    }
    .cqc-range-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .cqc-range-metrics > div {
      min-width: 0;
      padding-top: 7px;
      border-top: 1px solid var(--cqc-border);
    }
    .cqc-range-metrics span,
    .cqc-range-metrics small {
      display: block;
      overflow: hidden;
      color: var(--cqc-muted);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-range-metrics strong {
      display: block;
      margin: 3px 0 2px;
      overflow: hidden;
      font-size: 14px;
      letter-spacing: -0.035em;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    details {
      margin-top: 10px;
    }
    summary {
      cursor: pointer;
      color: var(--cqc-accent);
      font-size: 10.5px;
      font-weight: 600;
    }
    summary::marker {
      color: var(--cqc-faint);
    }
    .cqc-table-note {
      margin-top: 8px;
      color: var(--cqc-faint);
      font-size: 10px;
    }
    .cqc-table {
      margin-top: 6px;
      border: 1px solid var(--cqc-border);
      border-radius: 12px;
      overflow: hidden;
      font-size: 10px;
    }
    .cqc-table-head,
    .cqc-table-row {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) repeat(3, minmax(48px, 0.55fr));
      gap: 6px;
      padding: 6px 8px;
      align-items: center;
    }
    .cqc-table-daily .cqc-table-head,
    .cqc-table-daily .cqc-table-row {
      grid-template-columns: minmax(0, 1.1fr) repeat(4, minmax(42px, 0.55fr));
    }
    .cqc-table-head {
      color: var(--cqc-muted);
      background: var(--cqc-table-head);
      font-weight: 700;
    }
    .cqc-table-row + .cqc-table-row {
      border-top: 1px solid var(--cqc-border);
    }
    .cqc-table-row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-warning,
    .cqc-error {
      border: 1px solid color-mix(in srgb, var(--cqc-amber) 40%, transparent);
      background: var(--cqc-amber-soft);
      border-radius: 10px;
      padding: 9px 12px;
      color: var(--cqc-text);
      font-size: 10.5px;
      line-height: 1.5;
      margin-top: 10px;
    }
    .cqc-error {
      border-color: color-mix(in srgb, var(--cqc-red) 40%, transparent);
      background: var(--cqc-red-soft);
    }
    .cqc-error pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 8px 0;
      font-size: 10.5px;
    }
    .cqc-runtime {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--cqc-border);
    }
    .cqc-facts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .cqc-facts > span {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 7px;
      min-width: 0;
      padding: 6px 8px;
      background: var(--cqc-surface-subtle);
      border-radius: 10px;
      font-size: 10px;
    }
    .cqc-facts b {
      color: var(--cqc-muted);
    }
    .cqc-facts em {
      min-width: 0;
      overflow: hidden;
      color: var(--cqc-text);
      font-style: normal;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cqc-footer {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
      padding: 0 2px;
      color: var(--cqc-faint);
      font-size: 10px;
    }
    .cqc-toggle:focus-visible,
    .cqc-action:focus-visible,
    .cqc-heatmap-scroll:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--cqc-accent);
      outline-offset: 2px;
    }
    @media (max-width: 760px) {
      .cqc-panel {
        right: 8px;
        bottom: 62px;
        width: calc(100vw - 16px);
        max-height: calc(100dvh - 76px);
      }
      .cqc-toggle {
        right: 8px;
        bottom: 10px;
      }
      .cqc-overview {
        grid-template-columns: 1fr;
      }
      .cqc-identity {
        padding: 0 0 10px;
        border-right: 0;
        border-bottom: 1px solid var(--cqc-border);
      }
      .cqc-primary-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 520px) {
      .cqc-panel {
        border-radius: 14px;
      }
      .cqc-header {
        align-items: flex-start;
      }
      .cqc-title span {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cqc-action {
        padding: 0 7px;
      }
      .cqc-body {
        padding: 9px;
      }
      .cqc-overview-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .cqc-kpi.accent {
        grid-column: 1 / -1;
      }
      .cqc-signal-rail {
        grid-template-columns: 1fr auto;
      }
      .cqc-signal-rail > span {
        display: none;
      }
      .cqc-estimate,
      .cqc-ranges,
      .cqc-facts {
        grid-template-columns: 1fr;
      }
      .cqc-coverage {
        grid-template-columns: 1fr;
        gap: 6px;
      }
      .cqc-heatmap-card {
        --cqc-heatmap-cell: 8px;
      }
      .cqc-heatmap-meta {
        align-items: flex-start;
        flex-direction: column;
        gap: 5px;
      }
      .cqc-table-head,
      .cqc-table-row {
        grid-template-columns: minmax(0, 1.05fr) repeat(3, minmax(44px, 0.55fr));
      }
      .cqc-table-daily .cqc-table-head,
      .cqc-table-daily .cqc-table-row {
        grid-template-columns: minmax(0, 1fr) repeat(4, minmax(38px, 0.55fr));
      }
      .cqc-footer {
        flex-direction: column;
        gap: 2px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .cqc-toggle,
      .cqc-action,
      .cqc-progress-fill {
        transition: none;
      }
      .cqc-toggle,
      .cqc-overview::before {
        animation: none;
      }
    }
  `;

  const ensureUi = () => {
    const existing = document.getElementById(HOST_ID);
    if (existing?.shadowRoot) return existing.shadowRoot;

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${css}</style>
      <button class="cqc-toggle" type="button" title="打开 Codex quota 面板" aria-controls="cqc-panel">Codex Quota</button>
      <aside class="cqc-panel" id="cqc-panel" aria-label="Codex quota 与用量分析" hidden>
        <div class="cqc-header">
          <div class="cqc-title">
            <strong>Codex Quota Compass</strong>
            <span class="cqc-status" aria-live="polite">未加载</span>
          </div>
          <div class="cqc-actions">
            <button class="cqc-action primary cqc-refresh" type="button">刷新</button>
            <button class="cqc-action cqc-export" type="button" disabled>导出 JSON</button>
            <button class="cqc-action cqc-share" type="button" disabled>分享卡片</button>
            <button class="cqc-action cqc-close" type="button">关闭</button>
          </div>
        </div>
        <div class="cqc-body"></div>
      </aside>
      <div class="cqc-tip" role="tooltip" hidden>
        <strong></strong>
        <span><i class="cqc-tip-dot level-0" aria-hidden="true"></i><b class="cqc-tip-text"></b></span>
      </div>
    `;

    bindHeatmapTooltip(shadow);

    shadow.querySelector('.cqc-toggle')?.addEventListener('click', () => {
      state.panelOpen = !state.panelOpen;
      render(shadow);
      if (state.panelOpen && !state.result && !state.loading) {
        void refresh(shadow);
      }
    });
    shadow.querySelector('.cqc-close')?.addEventListener('click', () => {
      state.panelOpen = false;
      render(shadow);
    });
    shadow.querySelector('.cqc-refresh')?.addEventListener('click', () => {
      void refresh(shadow);
    });
    shadow.querySelector('.cqc-export')?.addEventListener('click', exportJson);
    shadow.querySelector('.cqc-share')?.addEventListener('click', exportShareCard);

    document.body.appendChild(host);
    render(shadow);
    return shadow;
  };

  const removeUi = () => {
    state.panelOpen = false;
    document.getElementById(HOST_ID)?.remove();
  };

  const runOnCodexCloudPath = () => {
    if (!isCodexCloudPath()) {
      removeUi();
      return;
    }

    const shadow = ensureUi();
    if (CONFIG.AUTO_LOAD && !state.result && !state.loading) {
      window.setTimeout(() => {
        if (!isCodexCloudPath()) return;
        void refresh(shadow);
      }, 800);
    }
  };

  const installRouteObserver = () => {
    const notifyRouteChange = () => window.setTimeout(runOnCodexCloudPath, 0);
    const patchHistoryMethod = (methodName) => {
      const original = window.history[methodName];
      if (typeof original !== 'function') return;
      window.history[methodName] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        notifyRouteChange();
        return result;
      };
    };

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', notifyRouteChange);
  };

  const boot = () => {
    installRouteObserver();
    runOnCodexCloudPath();
  };

  if (document.body) {
    boot();
  } else {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  }
})();
