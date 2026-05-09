// ==UserScript==
// @name         Codex Quota Compass
// @namespace    https://github.com/BlueSkyXN/CPA-Panel-LTS
// @version      0.1.3
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
    ROLLING_DAYS: 30,
    USD_PER_CREDIT: 40 / 1000,

    // 仅在自动 session 取不到 access token 时，才建议在自己电脑临时填写。
    // 不要把填过 token 的脚本、截图或导出结果发给别人。
    MANUAL_ACCESS_TOKEN: '',

    USAGE_PATH: '/backend-api/wham/usage',
    DAILY_USAGE_PATH: '/backend-api/wham/analytics/daily-workspace-usage-counts',
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
      if (response.status === 401) {
        throw new Error(
          [
            `HTTP 401 Unauthorized: ${path}`,
            '没有拿到有效 Authorization，或当前 ChatGPT session 已过期。',
            '请先刷新 chatgpt.com 并确认已登录；仍失败时，可临时填写 CONFIG.MANUAL_ACCESS_TOKEN。',
          ].join('\n')
        );
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${path}\n${body.slice(0, 600)}`);
    }

    return response.json();
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
        const primary = rateInfo.primary_window ?? rateInfo.primaryWindow ?? null;
        const secondary = rateInfo.secondary_window ?? rateInfo.secondaryWindow ?? null;
        const fiveHour = toQuotaWindow(
          `${idPrefix}-five-hour-${index}`,
          `${limitName} 5 小时`,
          primary,
          rateInfo
        );
        const weekly = toQuotaWindow(
          `${idPrefix}-weekly-${index}`,
          `${limitName} 7 天`,
          secondary,
          rateInfo
        );
        if (fiveHour) windows.push(fiveHour);
        if (weekly) windows.push(weekly);
      });
    }

    return windows;
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

  const sortedDays = (payload) =>
    (payload?.data ?? [])
      .slice()
      .sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')));

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

  const collectQuota = async () => {
    const sessionInfo = await getSessionInfo();
    const headers = buildRequestHeaders(sessionInfo);
    const usage = await apiGet(CONFIG.USAGE_PATH, headers);

    const rateLimit = usage.rate_limit ?? usage.rateLimit ?? null;
    const weeklyWindow = pickClassifiedWindows(rateLimit).weeklyWindow;
    const timing = getWindowTiming(weeklyWindow);
    const windows = buildQuotaWindows(usage);
    let analytics = null;
    let analyticsError = '';

    if (weeklyWindow && timing) {
      const apiNowMs = timing.serverNowMs;
      const endDateExclusive = ymdUtc(apiNowMs + DAY_MS);
      const sinceResetStartDate = ymdUtc(timing.windowStartMs);
      const monthStartDate = firstDayOfMonthUtc(apiNowMs);
      const rollingStartDate = ymdUtc(apiNowMs - (CONFIG.ROLLING_DAYS - 1) * DAY_MS);

      try {
        const [sinceResetPayload, monthPayload, rollingPayload] = await Promise.all([
          fetchDailyUsage(headers, sinceResetStartDate, endDateExclusive),
          fetchDailyUsage(headers, monthStartDate, endDateExclusive),
          fetchDailyUsage(headers, rollingStartDate, endDateExclusive),
        ]);

        const sinceResetRange = buildAnalyticsRange(
          sinceResetPayload,
          'since-reset',
          '上次重置至今',
          sinceResetStartDate,
          endDateExclusive
        );
        const monthRange = buildAnalyticsRange(
          monthPayload,
          'month-to-date',
          '本月初至今',
          monthStartDate,
          endDateExclusive
        );
        const rollingRange = buildAnalyticsRange(
          rollingPayload,
          'rolling',
          `近 ${CONFIG.ROLLING_DAYS} 天`,
          rollingStartDate,
          endDateExclusive
        );

        analytics = {
          dateBucket: 'UTC',
          userTimeZone: getUserTimeZone(),
          backendNowLabel: formatUserDateTime(apiNowMs),
          backendNowUtcLabel: formatUtcDateTime(apiNowMs),
          windowStartLabel: formatUserDateTime(timing.windowStartMs),
          windowStartUtcLabel: formatUtcDateTime(timing.windowStartMs),
          resetAtLabel: formatUserDateTime(timing.resetAtMs),
          resetAtUtcLabel: formatUtcDateTime(timing.resetAtMs),
          weeklyEstimate: buildWeeklyEstimate(
            weeklyWindow,
            sinceResetRange,
            sinceResetPayload,
            sinceResetStartDate
          ),
          ranges: [sinceResetRange, monthRange, rollingRange],
        };
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
      planType: normalizePlanType(usage.plan_type ?? usage.planType),
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
      <div class="cqc-progress">
        <div class="cqc-progress-fill ${progressClass(percent)}" style="width:${Math.round(normalized)}%"></div>
      </div>
    `;
  };

  const metricCard = (label, value, hint = '') => `
    <div class="cqc-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </div>
  `;

  const renderFact = (label, value, title = '') => `
    <span${title ? ` title="${escapeHtml(title)}"` : ''}>
      ${escapeHtml(label)}：${escapeHtml(value)}
    </span>
  `;

  const renderWindowRow = (windowInfo) => {
    const remainingLabel =
      windowInfo.remainingPercent === null || windowInfo.remainingPercent === undefined
        ? '--'
        : `${Math.round(windowInfo.remainingPercent)}%`;
    const usedLabel =
      windowInfo.usedPercent === null || windowInfo.usedPercent === undefined
        ? 'unknown'
        : `${formatNumber(windowInfo.usedPercent, 2)}% used`;

    return `
      <div class="cqc-window">
        <div class="cqc-window-main">
          <div>
            <div class="cqc-window-title">${escapeHtml(windowInfo.label)}</div>
            <div class="cqc-window-sub">${escapeHtml(usedLabel)} · reset in ${escapeHtml(windowInfo.resetInLabel)}</div>
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

  const renderRange = (range) => `
    <div class="cqc-range">
      <div class="cqc-range-header">
        <div>
          <strong>${escapeHtml(range.label)}</strong>
          <span>${escapeHtml(rangeDateLabel(range))}</span>
        </div>
        <em>${escapeHtml(range.returnedDays)} buckets</em>
      </div>
      <div class="cqc-range-grid">
        ${metricCard('Credits', `${formatNumber(range.credits, 2)}`, `${formatUsd(range.usd)}`)}
        ${metricCard('Tokens', formatInteger(range.tokens), `${formatInteger(range.turns)} turns`)}
      </div>
      <details>
        <summary>客户端与最近每日明细</summary>
        ${renderClientRows(range.topClients)}
        ${renderDailyRows(range.days)}
      </details>
    </div>
  `;

  const renderResult = (result) => {
    const weeklyWindow = result.windows.find((item) => item.id === 'codex-weekly');
    const fiveHourWindow = result.windows.find((item) => item.id === 'codex-five-hour');
    const weeklyEstimate = result.analytics?.weeklyEstimate ?? null;
    const summary = [
      metricCard('Plan', getPlanLabel(result.planType)),
      metricCard(
        '7 天剩余',
        weeklyWindow?.remainingPercent === null || weeklyWindow?.remainingPercent === undefined
          ? '--'
          : `${Math.round(weeklyWindow.remainingPercent)}%`,
        weeklyWindow ? `reset ${weeklyWindow.resetLabel}` : ''
      ),
      metricCard(
        '5 小时剩余',
        fiveHourWindow?.remainingPercent === null || fiveHourWindow?.remainingPercent === undefined
          ? '--'
          : `${Math.round(fiveHourWindow.remainingPercent)}%`,
        fiveHourWindow ? `reset ${fiveHourWindow.resetLabel}` : ''
      ),
      metricCard(
        '周额度估算',
        weeklyEstimate ? `${formatInteger(weeklyEstimate.totalCreditsWithResetDay)} credits` : '--',
        weeklyEstimate ? `${formatUsd(weeklyEstimate.totalUsdWithResetDay)}` : ''
      ),
    ].join('');

    const weeklyEstimateBlock = weeklyEstimate
      ? `
        <div class="cqc-estimate">
          <div>
            <span>包含重置日</span>
            <strong>${formatNumber(weeklyEstimate.totalCreditsWithResetDay, 2)} credits</strong>
            <em>${formatUsd(weeklyEstimate.totalUsdWithResetDay)} total · remaining ${formatNumber(weeklyEstimate.remainingCreditsWithResetDay, 2)}</em>
          </div>
          <div>
            <span>排除重置日</span>
            <strong>${formatNumber(weeklyEstimate.totalCreditsWithoutResetDay, 2)} credits</strong>
            <em>${formatUsd(weeklyEstimate.totalUsdWithoutResetDay)} total · remaining ${formatNumber(weeklyEstimate.remainingCreditsWithoutResetDay, 2)}</em>
          </div>
          <p>daily analytics 只能按天聚合，真实值通常介于两种口径之间；used_percent 表示已用比例。</p>
        </div>
      `
      : '<div class="cqc-muted">暂无周额度反推数据。</div>';

    return `
      <div class="cqc-summary">${summary}</div>

      <section>
        <h3>限制窗口</h3>
        <div class="cqc-window-list">
          ${
            result.windows.length > 0
              ? result.windows.map(renderWindowRow).join('')
              : '<div class="cqc-muted">未返回限制窗口。</div>'
          }
        </div>
      </section>

      <section>
        <h3>周额度估算</h3>
        ${weeklyEstimateBlock}
      </section>

      <section>
        <h3>Daily Analytics</h3>
        <div class="cqc-facts">
          ${renderFact('日期桶', result.analytics?.dateBucket ?? 'UTC', 'daily analytics 按 UTC 日期桶聚合')}
          ${renderFact('用户时区', result.analytics?.userTimeZone ?? getUserTimeZone())}
          ${renderFact('后端当前', result.analytics?.backendNowLabel ?? '-', result.analytics?.backendNowUtcLabel ? `UTC: ${result.analytics.backendNowUtcLabel}` : '')}
          ${renderFact('窗口开始', result.analytics?.windowStartLabel ?? '-', result.analytics?.windowStartUtcLabel ? `UTC: ${result.analytics.windowStartUtcLabel}` : '')}
          ${renderFact('下次重置', result.analytics?.resetAtLabel ?? '-', result.analytics?.resetAtUtcLabel ? `UTC: ${result.analytics.resetAtUtcLabel}` : '')}
        </div>
        ${
          result.analyticsError
            ? `<div class="cqc-warning">${escapeHtml(result.analyticsError)}</div>`
            : ''
        }
        <div class="cqc-ranges">
          ${(result.analytics?.ranges ?? []).map(renderRange).join('')}
        </div>
      </section>

      <footer class="cqc-footer">
        <span>更新于 ${escapeHtml(formatLocalDateTime(Date.parse(result.fetchedAt)))}</span>
        <span>token: ${escapeHtml(result.tokenSource)}${result.hasAccountHeader ? ' · account header' : ''}</span>
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
      button.textContent = 'Codex Quota · loading';
      return;
    }
    if (state.result) {
      const weeklyWindow = state.result.windows.find((item) => item.id === 'codex-weekly');
      if (weeklyWindow?.remainingPercent !== null && weeklyWindow?.remainingPercent !== undefined) {
        button.textContent = `Codex 7d ${Math.round(weeklyWindow.remainingPercent)}%`;
        return;
      }
      button.textContent = 'Codex Quota · ready';
      return;
    }
    if (state.error) {
      button.textContent = 'Codex Quota · error';
      return;
    }
    button.textContent = 'Codex Quota';
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
      --cqc-bg: rgba(255, 255, 255, 0.98);
      --cqc-elevated: #ffffff;
      --cqc-text: #1d2329;
      --cqc-muted: #667085;
      --cqc-border: rgba(15, 23, 42, 0.12);
      --cqc-shadow: 0 16px 50px rgba(15, 23, 42, 0.22);
      --cqc-blue: #2563eb;
      --cqc-green: #10b981;
      --cqc-amber: #d97706;
      --cqc-red: #dc2626;
      --cqc-purple: #6d5bd0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --cqc-bg: rgba(18, 24, 33, 0.98);
        --cqc-elevated: #1d2633;
        --cqc-text: #eef2f7;
        --cqc-muted: #a6b0bf;
        --cqc-border: rgba(226, 232, 240, 0.14);
        --cqc-shadow: 0 18px 56px rgba(0, 0, 0, 0.42);
      }
    }
    .cqc-toggle {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483646;
      min-width: 132px;
      height: 42px;
      border: 1px solid var(--cqc-border);
      border-radius: 999px;
      background: var(--cqc-bg);
      color: var(--cqc-text);
      box-shadow: var(--cqc-shadow);
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
      padding: 0 16px;
    }
    .cqc-panel {
      position: fixed;
      right: 20px;
      bottom: 74px;
      z-index: 2147483646;
      width: min(720px, calc(100vw - 32px));
      max-height: min(760px, calc(100vh - 104px));
      display: flex;
      flex-direction: column;
      background: var(--cqc-bg);
      color: var(--cqc-text);
      border: 1px solid var(--cqc-border);
      border-radius: 14px;
      box-shadow: var(--cqc-shadow);
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
      padding: 14px 16px;
      border-bottom: 1px solid var(--cqc-border);
      background: var(--cqc-elevated);
    }
    .cqc-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .cqc-title strong {
      font-size: 15px;
      line-height: 1.25;
    }
    .cqc-title span {
      color: var(--cqc-muted);
      font-size: 12px;
    }
    .cqc-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .cqc-action {
      height: 32px;
      border: 1px solid var(--cqc-border);
      border-radius: 8px;
      background: transparent;
      color: var(--cqc-text);
      cursor: pointer;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 650;
    }
    .cqc-action.primary {
      color: #fff;
      background: var(--cqc-blue);
      border-color: var(--cqc-blue);
    }
    .cqc-action:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .cqc-body {
      overflow: auto;
      padding: 16px;
      overscroll-behavior: contain;
    }
    .cqc-loading,
    .cqc-muted {
      color: var(--cqc-muted);
      font-size: 13px;
      padding: 14px;
    }
    .cqc-summary,
    .cqc-range-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .cqc-metric {
      min-width: 0;
      background: var(--cqc-elevated);
      border: 1px solid var(--cqc-border);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cqc-metric span,
    .cqc-metric small {
      color: var(--cqc-muted);
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cqc-metric strong {
      font-size: 18px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    section {
      margin-top: 18px;
    }
    h3 {
      margin: 0 0 10px;
      font-size: 14px;
      line-height: 1.25;
    }
    .cqc-window-list,
    .cqc-ranges {
      display: grid;
      gap: 10px;
    }
    .cqc-window,
    .cqc-range,
    .cqc-estimate {
      background: var(--cqc-elevated);
      border: 1px solid var(--cqc-border);
      border-radius: 10px;
      padding: 12px;
      contain: content;
    }
    .cqc-window-main,
    .cqc-range-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .cqc-window-title {
      font-size: 13px;
      font-weight: 700;
    }
    .cqc-window-sub,
    .cqc-range-header span,
    .cqc-range-header em,
    .cqc-facts,
    .cqc-footer {
      color: var(--cqc-muted);
      font-size: 12px;
    }
    .cqc-window-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      white-space: nowrap;
    }
    .cqc-window-meta strong {
      font-size: 16px;
    }
    .cqc-window-meta span {
      color: var(--cqc-muted);
      font-size: 11px;
    }
    .cqc-progress {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.25);
    }
    .cqc-progress-fill {
      height: 100%;
      border-radius: inherit;
      transition: width 180ms ease;
    }
    .cqc-progress-fill.high {
      background: var(--cqc-green);
    }
    .cqc-progress-fill.medium {
      background: var(--cqc-amber);
    }
    .cqc-progress-fill.low {
      background: var(--cqc-red);
    }
    .cqc-estimate {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .cqc-estimate div {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .cqc-estimate span,
    .cqc-estimate em,
    .cqc-estimate p {
      color: var(--cqc-muted);
      font-size: 12px;
      font-style: normal;
    }
    .cqc-estimate strong {
      font-size: 16px;
    }
    .cqc-estimate p {
      grid-column: 1 / -1;
      margin: 0;
      line-height: 1.45;
    }
    .cqc-facts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-bottom: 10px;
    }
    .cqc-range-header strong {
      display: block;
      margin-bottom: 2px;
      font-size: 13px;
    }
    details {
      margin-top: 10px;
    }
    summary {
      cursor: pointer;
      color: var(--cqc-purple);
      font-size: 12px;
      font-weight: 700;
    }
    .cqc-table {
      margin-top: 10px;
      border: 1px solid var(--cqc-border);
      border-radius: 8px;
      overflow: hidden;
      font-size: 12px;
    }
    .cqc-table-head,
    .cqc-table-row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(64px, 0.55fr));
      gap: 8px;
      padding: 8px 10px;
      align-items: center;
    }
    .cqc-table-head {
      color: var(--cqc-muted);
      background: rgba(148, 163, 184, 0.12);
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
      border: 1px solid rgba(217, 119, 6, 0.35);
      background: rgba(217, 119, 6, 0.10);
      border-radius: 10px;
      padding: 10px;
      color: var(--cqc-text);
      font-size: 12px;
      line-height: 1.45;
      margin-bottom: 10px;
    }
    .cqc-error {
      border-color: rgba(220, 38, 38, 0.35);
      background: rgba(220, 38, 38, 0.10);
    }
    .cqc-error pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 8px 0;
      font-size: 12px;
    }
    .cqc-footer {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 18px;
      padding-top: 12px;
      border-top: 1px solid var(--cqc-border);
    }
    @media (max-width: 640px) {
      .cqc-panel {
        right: 8px;
        bottom: 62px;
        width: calc(100vw - 16px);
      }
      .cqc-toggle {
        right: 8px;
        bottom: 10px;
      }
      .cqc-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .cqc-actions {
        justify-content: flex-start;
      }
      .cqc-summary,
      .cqc-range-grid,
      .cqc-estimate {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .cqc-table-head,
      .cqc-table-row {
        grid-template-columns: minmax(0, 1.1fr) repeat(3, minmax(48px, 0.55fr));
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
      <button class="cqc-toggle" type="button" title="打开 Codex quota 面板">Codex Quota</button>
      <aside class="cqc-panel" hidden>
        <div class="cqc-header">
          <div class="cqc-title">
            <strong>Codex Quota Compass</strong>
            <span class="cqc-status">未加载</span>
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
