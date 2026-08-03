// ==UserScript==
// @name         Codex Quota Compass
// @namespace    https://github.com/BlueSkyXN/CPA-Panel-LTS
// @version      0.1.14
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

  const sortedDays = (payload) =>
    (payload?.data ?? [])
      .slice()
      .sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')));

  const sliceDailyUsagePayload = (payload, startDate, endDateExclusive) => ({
    ...payload,
    data: (payload?.data ?? []).filter((day) => {
      const date = normalizeString(day?.date);
      return date && date >= startDate && date < endDateExclusive;
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
    if (name && email) return `${name} <${email}>`;
    return email || name || userId || 'UNKNOWN';
  };

  const pickLeaderboardUserRow = (rows, currentEmail) => {
    const normalizedEmail = normalizeString(currentEmail)?.toLowerCase();
    if (!normalizedEmail) return null;
    return rows.find((row) => normalizeString(row.email)?.toLowerCase() === normalizedEmail) || null;
  };

  const buildLeaderboardRange = (payload, id, label, startDate, endDateInclusive, currentEmail) => {
    const rows = (payload?.data ?? []).slice().sort((left, right) => {
      const leftRank = normalizeNumber(left.rank) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = normalizeNumber(right.rank) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return num(right.credits) - num(left.credits);
    });

    let credits = 0;
    let tokens = 0;
    let threads = 0;
    let turns = 0;

    for (const row of rows) {
      credits += num(row.credits);
      tokens += num(row.text_tokens ?? row.textTokens);
      threads += num(row.n_threads ?? row.nThreads);
      turns += num(row.n_turns ?? row.nTurns);
    }

    const totalUsers = num(payload?.total_users ?? payload?.totalUsers) || rows.length;
    const currentUser = pickLeaderboardUserRow(rows, currentEmail);
    const selectedCredits = currentUser ? num(currentUser.credits) : credits;
    const selectedTokens = currentUser ? num(currentUser.text_tokens ?? currentUser.textTokens) : tokens;
    const selectedThreads = currentUser ? num(currentUser.n_threads ?? currentUser.nThreads) : threads;
    const selectedTurns = currentUser ? num(currentUser.n_turns ?? currentUser.nTurns) : turns;

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
      topClients: rows.slice(0, TOP_CLIENT_LIMIT).map((row) => {
        const rowCredits = num(row.credits);
        return {
          clientId: leaderboardUserLabel(row),
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
        'team-leaderboard-missing-email'
      );
    }

    const dates = buildAnalyticsDates(timing);
    const [sinceResetPayload, monthPayload, rollingPayload] = await Promise.all([
      fetchUsageLeaderboard(headers, dates.sinceResetStartDate, dates.endDateInclusive),
      fetchUsageLeaderboard(headers, dates.monthStartDate, dates.endDateInclusive),
      fetchUsageLeaderboard(headers, dates.rollingStartDate, dates.endDateInclusive),
    ]);

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

    if (!ranges.some((range) => range.matchedUserFound)) {
      throw createTypedError(
        `Team 用量排行榜没有找到当前邮箱 ${currentEmail} 的记录。`,
        'team-leaderboard-missing-user'
      );
    }

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
        warning: `${leaderboardError} 已回退到 daily analytics；Team 子号或非 owner/admin 账号可能看不到 workspace 排行榜。`,
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
      <div class="cqc-table">
        <div class="cqc-table-head">
          <span>Date</span><span>Credits</span><span>USD</span><span>Turns</span>
        </div>
        ${recent
          .map(
            (day) => `
              <div class="cqc-table-row">
                <span>${escapeHtml(day.date)}</span>
                <span>${formatNumber(day.credits, 2)}</span>
                <span>${formatUsd(day.usd)}</span>
                <span>${formatInteger(day.turns)}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  };

  const renderRange = (range) => {
    const isLeaderboard = range.leaderboardTotalCredits !== undefined;
    const creditsLabel = isLeaderboard ? '当前用户 Credits' : 'Credits';
    const creditsHint = isLeaderboard
      ? `${formatUsd(range.usd)} · workspace ${formatNumber(range.leaderboardTotalCredits, 2)}`
      : `${formatUsd(range.usd)}`;
    const detailSummary = isLeaderboard ? 'Team 用户排行' : '客户端与最近每日明细';

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
    if (source === 'daily-workspace-fallback') return 'Daily analytics（排行榜回退）';
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
            <span class="cqc-account" title="${escapeHtml(result.userEmail || '')}">${escapeHtml(result.userEmail || '未返回账号')}</span>
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
        <div class="cqc-ranges">
          ${(result.analytics?.ranges ?? []).map(renderRange).join('')}
        </div>
        <details class="cqc-runtime">
          <summary>运行与时间信息</summary>
          <div class="cqc-facts">
            ${renderFact('日期桶', result.analytics?.dateBucket ?? 'UTC', 'daily analytics 按 UTC 日期桶聚合')}
            ${renderFact('数据来源', `${analyticsSourceLabel(result.analytics?.source)}${result.analytics?.requestCount ? ` · ${result.analytics.requestCount} 次请求` : ''}`)}
            ${renderFact('当前账号', result.meInfo?.name && result.userEmail ? `${result.meInfo.name} <${result.userEmail}>` : result.userEmail || '-')}
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
    if (!panel || !body || !status || !exportButton) return;

    panel.hidden = !state.panelOpen;
    exportButton.disabled = !state.result;
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
      .cqc-table-head,
      .cqc-table-row {
        grid-template-columns: minmax(0, 1.05fr) repeat(3, minmax(44px, 0.55fr));
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
            <button class="cqc-action cqc-close" type="button">关闭</button>
          </div>
        </div>
        <div class="cqc-body"></div>
      </aside>
    `;

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
