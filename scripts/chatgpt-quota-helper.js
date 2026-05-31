// ==UserScript==
// @name         ChatGPT Quota Helper
// @namespace    https://github.com/BlueSkyXN/CPA-Panel-LTS
// @version      1.1.0
// @author       BlueSkyXN
// @description  在 chatgpt.com 实时显示 DR / Agent / Codex 5h / Codex 7d 配额：折叠式面板、状态指示灯、自动与手动刷新。
// @match        https://chatgpt.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/BlueSkyXN/CPA-Panel-LTS/blob/main/scripts/chatgpt-quota-helper.js
// @supportURL   https://github.com/BlueSkyXN/CPA-Panel-LTS/issues
// @downloadURL  https://raw.githubusercontent.com/BlueSkyXN/CPA-Panel-LTS/main/scripts/chatgpt-quota-helper.js
// @updateURL    https://raw.githubusercontent.com/BlueSkyXN/CPA-Panel-LTS/main/scripts/chatgpt-quota-helper.js
// ==/UserScript==

(function () {
  'use strict';

  // ========== 配置 ==========

  const PATHS = {
    CONVERSATION_INIT: '/backend-api/conversation/init',
    SESSION: '/api/auth/session',
    CODEX_USAGE: '/backend-api/wham/usage'
  };

  const FIVE_HOUR_SECONDS = 5 * 60 * 60;
  const WEEK_SECONDS = 7 * 24 * 60 * 60;

  // Codex 自动刷新开关：默认关闭。
  // 设为 true 才会按 CODEX_AUTO_REFRESH_MS 周期自动刷新；
  // 关闭时仍保留「首次进入拉取」与「手动点刷新」，只是不再周期性请求。
  const CODEX_AUTO_REFRESH_ENABLED = false;

  // Codex 自动刷新间隔：5 分钟（仅在 CODEX_AUTO_REFRESH_ENABLED 为 true 时生效）
  const CODEX_AUTO_REFRESH_MS = 5 * 60 * 1000;
  const CODEX_AUTO_REFRESH_JITTER = 0.10;
  const CODEX_AUTO_BACKOFF_BASE_MS = 60 * 1000;
  const CODEX_AUTO_BACKOFF_MAX_MS = 5 * 60 * 1000;
  const CODEX_AUTO_MAX_CONSECUTIVE_ERRORS = 3;
  const SESSION_INFO_FALLBACK_TTL_MS = 60 * 1000;
  const SESSION_INFO_EXP_SKEW_MS = 30 * 1000;
  const RECOVERY_QUERY_PARAM = 'cqh_recover';
  const RECOVERY_STORAGE_KEY = 'cqh_recovery';
  const RECOVERY_MARKER_TTL_MS = 2 * 60 * 1000;

  // 指示灯阈值
  const DR_AGENT_LOW = 5;        // DR / Agent 剩余 < 5 视为低水位
  const CODEX_LOW_PERCENT = 20;  // Codex 剩余百分比 < 20% 视为低水位

  // 不在这些路径前缀下挂载面板（chatgpt.com 是 SPA，这里在脚本内部判断而非 @exclude）
  const EXCLUDED_PATH_PREFIXES = ['/codex/'];

  // ========== 状态 ==========

  const state = {
    dr: null,
    agent: null,
    codex5h: null,
    codex7d: null,
    codexError: '',
    codexLoading: false,
    codexBackoffUntil: 0,
    codexAutoPaused: false,
    consecutiveCodexErrors: 0,
    pageIssue: null,
    recoveryRecommended: false,
    recoveryNotice: '',
    lastUpdated: 0
  };

  let capturedConversationInitOnce = false;
  let codexTimer = null;
  let sessionInfoCache = null;

  // 在脚本插桩前抓住原始 fetch，避免后续被站点或自身 patch 影响
  const originalFetch = window.fetch;

  installRecoveryShortcut();

  // ========== 工具函数 ==========

  function isConversationInitUrl(input) {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input && input.url
            ? input.url
            : '';

      if (!url) return false;

      const u = new URL(url, location.origin);
      return u.origin === location.origin && u.pathname === PATHS.CONVERSATION_INIT;
    } catch {
      return false;
    }
  }

  function getLimit(data, featureName) {
    const arr = Array.isArray(data?.limits_progress) ? data.limits_progress : [];
    return arr.find(x => x && x.feature_name === featureName) || null;
  }

  function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  function normalizeEpochMs(value) {
    const n = normalizeNumber(value);
    if (n === null) return null;
    return n > 1e12 ? n : n * 1000;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits = 2) {
    const multiplier = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
  }

  function formatDurationMs(ms) {
    if (!Number.isFinite(ms)) return '-';
    if (ms <= 0) return '0H';

    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    if (ms >= DAY) {
      return `${Math.ceil(ms / DAY)}D`;
    }

    return `${Math.max(1, Math.ceil(ms / HOUR))}H`;
  }

  function formatRetryDurationMs(ms) {
    if (!Number.isFinite(ms)) return '-';
    if (ms <= 0) return '0M';

    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;

    if (ms < HOUR) {
      return `${Math.max(1, Math.ceil(ms / MINUTE))}M`;
    }

    return formatDurationMs(ms);
  }

  function formatIsoReset(value) {
    if (!value) return '-';

    const resetMs = new Date(value).getTime();
    if (!Number.isFinite(resetMs)) return '-';

    return formatDurationMs(resetMs - Date.now());
  }

  function formatWindowReset(quota) {
    if (!quota) return '-';

    if (quota.resetAfterSeconds !== null && quota.resetAfterSeconds !== undefined) {
      return formatDurationMs(quota.resetAfterSeconds * 1000);
    }

    if (Number.isFinite(quota.resetAtMs)) {
      return formatDurationMs(quota.resetAtMs - Date.now());
    }

    return '-';
  }

  function formatRemaining(value) {
    const n = normalizeNumber(value);
    return n === null ? '-' : String(Math.round(n));
  }

  function formatPercent(value) {
    const n = normalizeNumber(value);
    if (n === null) return '-';
    return `${Math.round(n)}%`;
  }

  function formatClock(ms) {
    if (!ms) return '未更新';
    const d = new Date(ms);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `更新于 ${h}:${m}:${s}`;
  }

  function sanitizeErrorMessage(value) {
    return String(value || '')
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
      .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
      .replace(/https?:\/\/[^\s"'<>]+/g, rawUrl => {
        try {
          const url = new URL(rawUrl);
          return `${url.origin}${url.pathname}`;
        } catch {
          return '[url]';
        }
      })
      .slice(0, 180);
  }

  function getResponseHeader(response, name) {
    try {
      return response?.headers?.get(name) || '';
    } catch {
      return '';
    }
  }

  function isCloudflareChallengeHeaders(status, cfMitigated, cfRay, contentType) {
    if (String(cfMitigated || '').toLowerCase() === 'challenge') return true;

    const statusCode = normalizeNumber(status);
    return (
      (statusCode === 403 || statusCode === 503) &&
      Boolean(cfRay) &&
      String(contentType || '').toLowerCase().includes('text/html')
    );
  }

  function isCloudflareChallengeResponse(response) {
    return isCloudflareChallengeHeaders(
      response?.status,
      getResponseHeader(response, 'cf-mitigated'),
      getResponseHeader(response, 'cf-ray'),
      getResponseHeader(response, 'content-type')
    );
  }

  function createCodexError(message, options = {}) {
    const error = new Error(message);
    error.cqhCode = options.code || '';
    error.cqhPauseAuto = Boolean(options.pauseAuto);
    error.cqhRecoveryRecommended = Boolean(options.recoveryRecommended);
    return error;
  }

  function getCodexErrorInfo(error) {
    return {
      message: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
      code: error?.cqhCode || '',
      pauseAuto: Boolean(error?.cqhPauseAuto),
      recoveryRecommended: Boolean(error?.cqhRecoveryRecommended)
    };
  }

  function getCodexAutoBackoffMs(errorCount) {
    const exponent = Math.max(0, Math.min(errorCount - 1, 3));
    return Math.min(
      CODEX_AUTO_BACKOFF_MAX_MS,
      CODEX_AUTO_BACKOFF_BASE_MS * (2 ** exponent)
    );
  }

  function getCodexAutoRefreshDelayMs() {
    const now = Date.now();
    if (state.codexBackoffUntil && state.codexBackoffUntil > now) {
      return state.codexBackoffUntil - now;
    }

    const jitter = 1 - CODEX_AUTO_REFRESH_JITTER + (Math.random() * CODEX_AUTO_REFRESH_JITTER * 2);
    return Math.max(1000, Math.round(CODEX_AUTO_REFRESH_MS * jitter));
  }

  function canScheduleCodexAutoRefresh() {
    return CODEX_AUTO_REFRESH_ENABLED && !document.hidden && !state.codexAutoPaused && !isExcludedPath();
  }

  function clearSessionInfoCache() {
    sessionInfoCache = null;
  }

  function clearRecoveryState() {
    state.pageIssue = null;
    state.recoveryRecommended = false;
    state.recoveryNotice = '';
  }

  function recordPageIssue(kind, message) {
    const now = Date.now();
    const current = state.pageIssue;
    if (current && current.kind === kind && now - current.detectedAt < 5000) return;

    state.pageIssue = {
      kind,
      message,
      detectedAt: now
    };
    state.recoveryRecommended = true;
    state.codexAutoPaused = true;
    state.codexBackoffUntil = 0;
    stopCodexAutoRefresh();

    if (!isExcludedPath()) {
      renderPanel();
    }
  }

  function isChunkLikeMessage(value) {
    const text = sanitizeErrorMessage(value).toLowerCase();
    return (
      text.includes('chunkloaderror') ||
      text.includes('loading chunk') ||
      text.includes('failed to fetch dynamically imported module') ||
      text.includes('importing a module script failed') ||
      text.includes('error loading dynamically imported module') ||
      text.includes('css_chunk_load_failed')
    );
  }

  function getErrorEventText(event) {
    const parts = [];
    if (event?.message) parts.push(event.message);
    if (event?.error?.message) parts.push(event.error.message);
    return parts.join(' ');
  }

  function getRejectionText(reason) {
    if (!reason) return '';
    if (typeof reason === 'string') return reason;
    if (reason instanceof Error) return reason.message;
    if (typeof reason.message === 'string') return reason.message;
    return String(reason);
  }

  function isResourceChunkErrorTarget(target) {
    if (!target || target === window) return false;

    const tag = String(target.tagName || '').toLowerCase();
    if (tag !== 'script' && tag !== 'link') return false;

    const url = target.src || target.href || '';
    return (
      /\/_next\/static\//i.test(url) ||
      /chunk/i.test(url)
    );
  }

  function inspectFetchResponseForPageIssue(response) {
    if (isCloudflareChallengeResponse(response)) {
      recordPageIssue('cf-challenge', '检测到 Cloudflare challenge，建议恢复页面');
    }
  }

  function inspectXhrForPageIssue(xhr) {
    try {
      if (isCloudflareChallengeHeaders(
        xhr.status,
        xhr.getResponseHeader('cf-mitigated'),
        xhr.getResponseHeader('cf-ray'),
        xhr.getResponseHeader('content-type')
      )) {
        recordPageIssue('cf-challenge', '检测到 Cloudflare challenge，建议恢复页面');
      }
    } catch {
      // ignore
    }
  }

  // ========== Codex usage 解析 ==========

  function getWindowSeconds(windowInfo) {
    if (!windowInfo) return null;

    return normalizeNumber(
      windowInfo.limit_window_seconds ??
      windowInfo.limitWindowSeconds
    );
  }

  function pickCodexWindows(rateLimit) {
    const primaryWindow =
      rateLimit?.primary_window ??
      rateLimit?.primaryWindow ??
      null;

    const secondaryWindow =
      rateLimit?.secondary_window ??
      rateLimit?.secondaryWindow ??
      null;

    const rawWindows = [primaryWindow, secondaryWindow].filter(Boolean);

    let fiveHourWindow = null;
    let weeklyWindow = null;

    for (const windowInfo of rawWindows) {
      const seconds = getWindowSeconds(windowInfo);

      if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
        fiveHourWindow = windowInfo;
      }

      if (seconds === WEEK_SECONDS && !weeklyWindow) {
        weeklyWindow = windowInfo;
      }
    }

    // 兼容字段缺失：通常 primary 是 5h，secondary 是 7d。
    if (!fiveHourWindow && primaryWindow && primaryWindow !== weeklyWindow) {
      fiveHourWindow = primaryWindow;
    }

    if (!weeklyWindow && secondaryWindow && secondaryWindow !== fiveHourWindow) {
      weeklyWindow = secondaryWindow;
    }

    return { fiveHourWindow, weeklyWindow };
  }

  function toCodexQuota(windowInfo, rateLimit) {
    if (!windowInfo) return null;

    const remainingPercentRaw = normalizeNumber(
      windowInfo.remaining_percent ??
      windowInfo.remainingPercent
    );

    const usedPercentRaw = normalizeNumber(
      windowInfo.used_percent ??
      windowInfo.usedPercent
    );

    const limitReached = Boolean(
      rateLimit?.limit_reached ??
      rateLimit?.limitReached
    );

    let remainingPercent = null;

    if (remainingPercentRaw !== null) {
      remainingPercent = remainingPercentRaw;
    } else if (usedPercentRaw !== null) {
      remainingPercent = 100 - usedPercentRaw;
    } else if (limitReached) {
      remainingPercent = 0;
    }

    if (remainingPercent !== null) {
      remainingPercent = round(clamp(remainingPercent, 0, 100), 2);
    }

    const resetAfterSeconds = normalizeNumber(
      windowInfo.reset_after_seconds ??
      windowInfo.resetAfterSeconds ??
      windowInfo.remaining_seconds ??
      windowInfo.remainingSeconds
    );

    const resetAtMs = normalizeEpochMs(
      windowInfo.reset_at ??
      windowInfo.resetAt
    );

    return {
      remainingPercent,
      resetAfterSeconds,
      resetAtMs
    };
  }

  // ========== Session / JWT ==========

  function looksLikeJwt(value) {
    return typeof value === 'string' &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim());
  }

  function decodeBase64Url(value) {
    const base64 = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(value.length + ((4 - value.length % 4) % 4), '=');

    const binary = atob(base64);

    try {
      return decodeURIComponent(
        Array.from(binary)
          .map(ch => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join('')
      );
    } catch {
      return binary;
    }
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token).split('.');
      if (parts.length < 2) return null;
      return JSON.parse(decodeBase64Url(parts[1]));
    } catch {
      return null;
    }
  }

  function findAccessToken(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8) return '';

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && /access/i.test(key) && looksLikeJwt(child)) {
        return child.trim();
      }

      if (child && typeof child === 'object') {
        const found = findAccessToken(child, depth + 1);
        if (found) return found;
      }
    }

    return '';
  }

  function findChatgptAccountId(value, depth = 0) {
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
  }

  function getSessionInfoExpiresAt(tokenPayload, now) {
    const expMs = normalizeEpochMs(tokenPayload?.exp);

    if (expMs && expMs > now + SESSION_INFO_EXP_SKEW_MS) {
      return expMs - SESSION_INFO_EXP_SKEW_MS;
    }

    return now + SESSION_INFO_FALLBACK_TTL_MS;
  }

  async function getSessionInfo(options = {}) {
    try {
      const now = Date.now();
      if (
        !options.force &&
        sessionInfoCache &&
        sessionInfoCache.expiresAt > now
      ) {
        return sessionInfoCache.value;
      }

      if (typeof originalFetch !== 'function') {
        return { accessToken: '', accountId: '' };
      }

      const response = await originalFetch.call(window, PATHS.SESSION, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json'
        }
      });

      if (isCloudflareChallengeResponse(response)) {
        throw createCodexError('检测到 Cloudflare challenge，已暂停自动刷新', {
          code: 'cf-challenge',
          pauseAuto: true,
          recoveryRecommended: true
        });
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clearSessionInfoCache();
        }
        return { accessToken: '', accountId: '' };
      }

      const session = await response.json();
      const accessToken = findAccessToken(session);

      const tokenPayload = accessToken ? decodeJwtPayload(accessToken) || {} : {};

      const accountId =
        findChatgptAccountId(session) ||
        findChatgptAccountId(tokenPayload) ||
        '';

      const result = { accessToken, accountId };
      sessionInfoCache = {
        value: result,
        expiresAt: getSessionInfoExpiresAt(tokenPayload, now)
      };

      return result;
    } catch (error) {
      if (error?.cqhCode) throw error;
      return { accessToken: '', accountId: '' };
    }
  }

  function buildCodexHeaders(sessionInfo) {
    const headers = {
      accept: 'application/json'
    };

    if (sessionInfo.accessToken) {
      headers.authorization = `Bearer ${sessionInfo.accessToken}`;
    }

    if (sessionInfo.accountId) {
      headers['Chatgpt-Account-Id'] = sessionInfo.accountId;
    }

    return headers;
  }

  async function fetchCodexUsage(options = {}) {
    if (typeof originalFetch !== 'function') {
      throw new Error('fetch unavailable');
    }

    const sessionInfo = await getSessionInfo({ force: Boolean(options.forceSession) });
    const headers = buildCodexHeaders(sessionInfo);

    const response = await originalFetch.call(window, PATHS.CODEX_USAGE, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers
    });

    if (isCloudflareChallengeResponse(response)) {
      throw createCodexError('检测到 Cloudflare challenge，已暂停自动刷新', {
        code: 'cf-challenge',
        pauseAuto: true,
        recoveryRecommended: true
      });
    }

    const contentType = getResponseHeader(response, 'content-type').toLowerCase();

    if (!response.ok) {
      if (response.status === 401 && !options.forceSession) {
        clearSessionInfoCache();
        return fetchCodexUsage({ ...options, forceSession: true });
      }

      if (response.status === 401 || response.status === 403) {
        clearSessionInfoCache();
      }

      throw createCodexError(`Codex usage HTTP ${response.status}`, {
        code: 'http'
      });
    }

    if (contentType.includes('text/html')) {
      throw createCodexError('Codex usage 返回 HTML，建议恢复页面', {
        code: 'html-response',
        pauseAuto: true,
        recoveryRecommended: true
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw createCodexError(`Codex usage JSON 解析失败: ${sanitizeErrorMessage(error.message)}`, {
        code: 'json-parse'
      });
    }
  }

  async function loadCodexUsage(options = {}) {
    const source = options.source || 'auto';
    const isManual = source === 'manual';

    if (!isManual) {
      if (document.hidden || state.codexAutoPaused) {
        renderPanel();
        return;
      }

      if (state.codexBackoffUntil && Date.now() < state.codexBackoffUntil) {
        renderPanel();
        return;
      }
    }

    if (state.codexLoading) return;

    state.codexLoading = true;
    if (isManual) {
      state.codexBackoffUntil = 0;
    }
    renderPanel();

    try {
      const usage = await fetchCodexUsage({ forceSession: Boolean(options.forceSession) });

      const rateLimit =
        usage.rate_limit ??
        usage.rateLimit ??
        null;

      const { fiveHourWindow, weeklyWindow } = pickCodexWindows(rateLimit);

      state.codex5h = toCodexQuota(fiveHourWindow, rateLimit);
      state.codex7d = toCodexQuota(weeklyWindow, rateLimit);
      state.codexError = '';
      state.codexAutoPaused = false;
      state.codexBackoffUntil = 0;
      state.consecutiveCodexErrors = 0;
      if (state.pageIssue?.kind !== 'chunk-load') {
        clearRecoveryState();
      } else {
        state.recoveryNotice = '';
      }
      state.lastUpdated = Date.now();
    } catch (error) {
      const info = getCodexErrorInfo(error);
      state.codexError = info.message || 'Codex usage 请求失败';
      state.consecutiveCodexErrors += 1;

      if (info.pauseAuto) {
        state.codexAutoPaused = true;
      }

      if (info.recoveryRecommended) {
        state.pageIssue = {
          kind: info.code || 'codex-recovery',
          message: state.codexError,
          detectedAt: Date.now()
        };
        state.recoveryRecommended = true;
      } else if (!isManual) {
        if (state.consecutiveCodexErrors >= CODEX_AUTO_MAX_CONSECUTIVE_ERRORS) {
          state.codexAutoPaused = true;
          state.codexBackoffUntil = 0;
        } else {
          state.codexBackoffUntil = Date.now() + getCodexAutoBackoffMs(state.consecutiveCodexErrors);
        }
      }

      // 出错时保留旧的 codex5h/codex7d，便于继续展示，但若从未拿到也置空
      if (!state.lastUpdated) {
        state.codex5h = null;
        state.codex7d = null;
      }
    } finally {
      state.codexLoading = false;
      renderPanel();
    }
  }

  function startCodexAutoRefresh() {
    if (codexTimer || !canScheduleCodexAutoRefresh()) return;

    codexTimer = setTimeout(() => {
      codexTimer = null;
      loadCodexUsage({ source: 'auto' }).finally(startCodexAutoRefresh);
    }, getCodexAutoRefreshDelayMs());
  }

  function stopCodexAutoRefresh() {
    if (!codexTimer) return;
    clearTimeout(codexTimer);
    codexTimer = null;
  }

  // ========== UI ==========

  function injectStyle() {
    if (document.getElementById('cqh-style')) return;

    const style = document.createElement('style');
    style.id = 'cqh-style';

    style.textContent = `
      .cqh-panel {
        position: fixed;
        right: 14px;
        top: 72px;
        z-index: 100;
        box-sizing: border-box;

        min-width: 168px;
        max-width: calc(100vw - 28px);
        padding: 8px 12px;

        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.4;

        color: rgba(20, 20, 20, 0.86);
        background: rgba(255, 255, 255, 0.78);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);

        opacity: 0.85;
        max-height: 36px;
        overflow: hidden;
        transition: opacity 0.18s ease, max-height 0.22s ease;
      }

      .cqh-panel:hover,
      .cqh-panel.cqh-expanded {
        opacity: 1;
        max-height: 360px;
      }

      .cqh-summary {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        white-space: nowrap;
        font-weight: 600;
        font-size: 12px;
        user-select: none;
      }

      .cqh-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
        background: #94a3b8;
        transition: background-color 0.2s ease;
      }

      .cqh-indicator.cqh-ok   { background: #10b981; }
      .cqh-indicator.cqh-warn { background: #f59e0b; }
      .cqh-indicator.cqh-bad  { background: #ef4444; }

      .cqh-panel.cqh-loading .cqh-indicator {
        animation: cqh-pulse 1s ease-in-out infinite;
      }

      @keyframes cqh-pulse {
        0%, 100% { transform: scale(1);   opacity: 1;   }
        50%      { transform: scale(1.3); opacity: 0.55; }
      }

      .cqh-summary-text {
        font-variant-numeric: tabular-nums;
      }

      .cqh-details {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed rgba(0, 0, 0, 0.10);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .cqh-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        white-space: nowrap;
      }

      .cqh-row-label {
        font-weight: 600;
        color: rgba(71, 85, 105, 0.95);
        min-width: 56px;
      }

      .cqh-row-value {
        font-variant-numeric: tabular-nums;
        text-align: right;
      }

      .cqh-footer {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px dashed rgba(0, 0, 0, 0.06);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: rgba(100, 116, 139, 0.95);
        font-size: 11px;
      }

      .cqh-footer-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .cqh-action {
        appearance: none;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: transparent;
        cursor: pointer;
        color: #2563eb;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 6px;
        line-height: 1.4;
      }

      .cqh-action[hidden] {
        display: none;
      }

      .cqh-action:hover:not(:disabled) {
        background: rgba(37, 99, 235, 0.08);
      }

      .cqh-action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .cqh-row-value.cqh-error-text {
        color: #dc2626;
      }

      .cqh-error-line {
        margin-top: 4px;
        color: #dc2626;
        font-size: 11px;
        line-height: 1.4;
        white-space: normal;
        word-break: break-all;
      }

      @media (prefers-color-scheme: dark) {
        .cqh-panel {
          color: rgba(229, 231, 235, 0.92);
          background: rgba(28, 28, 28, 0.78);
          border-color: rgba(255, 255, 255, 0.08);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.30);
        }
        .cqh-details {
          border-top-color: rgba(255, 255, 255, 0.10);
        }
        .cqh-footer {
          border-top-color: rgba(255, 255, 255, 0.06);
          color: rgba(148, 163, 184, 0.95);
        }
        .cqh-row-label {
          color: rgba(148, 163, 184, 0.95);
        }
        .cqh-action {
          color: #60a5fa;
          border-color: rgba(255, 255, 255, 0.10);
        }
        .cqh-action:hover:not(:disabled) {
          background: rgba(96, 165, 250, 0.10);
        }
      }
    `;

    document.documentElement.appendChild(style);
  }

  function ensurePanel() {
    let panel = document.getElementById('cqh-panel');
    if (panel) return panel;

    injectStyle();

    panel = document.createElement('div');
    panel.id = 'cqh-panel';
    panel.className = 'cqh-panel';
    panel.setAttribute('role', 'status');
    panel.innerHTML = `
      <div class="cqh-summary" data-cqh="summary" title="点击切换详情">
        <span class="cqh-indicator" data-cqh="indicator"></span>
        <span class="cqh-summary-text" data-cqh="summary-text">加载中…</span>
      </div>
      <div class="cqh-details">
        <div class="cqh-row">
          <span class="cqh-row-label">DR</span>
          <span class="cqh-row-value" data-cqh="dr">-</span>
        </div>
        <div class="cqh-row">
          <span class="cqh-row-label">Agent</span>
          <span class="cqh-row-value" data-cqh="agent">-</span>
        </div>
        <div class="cqh-row">
          <span class="cqh-row-label">Codex5H</span>
          <span class="cqh-row-value" data-cqh="codex5h">-</span>
        </div>
        <div class="cqh-row">
          <span class="cqh-row-label">Codex7D</span>
          <span class="cqh-row-value" data-cqh="codex7d">-</span>
        </div>
        <div class="cqh-error-line" data-cqh="error-line" hidden></div>
        <div class="cqh-footer">
          <span data-cqh="updated">未更新</span>
          <span class="cqh-footer-actions">
            <button type="button" class="cqh-action cqh-recover" data-cqh="recover" hidden>恢复</button>
            <button type="button" class="cqh-action cqh-refresh" data-cqh="refresh">刷新</button>
          </span>
        </div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(panel);

    const summary = panel.querySelector('[data-cqh="summary"]');
    summary.addEventListener('click', () => {
      panel.classList.toggle('cqh-expanded');
    });

    const refreshButton = panel.querySelector('[data-cqh="refresh"]');
    refreshButton.addEventListener('click', (event) => {
      event.stopPropagation();
      loadCodexUsage({ source: 'manual' }).finally(startCodexAutoRefresh);
    });

    const recoverButton = panel.querySelector('[data-cqh="recover"]');
    recoverButton.addEventListener('click', (event) => {
      event.stopPropagation();
      recoverPage();
    });

    return panel;
  }

  function computeIndicatorClass() {
    if (state.pageIssue?.kind === 'chunk-load') return 'cqh-bad';
    if (state.pageIssue || state.codexAutoPaused) return 'cqh-warn';

    // 首次加载、什么数据都没有：保持中性灰
    if (!state.lastUpdated && !state.dr && !state.agent) {
      if (state.codexError) return 'cqh-warn';
      return '';
    }

    const drRemaining = normalizeNumber(state.dr?.remaining);
    const agentRemaining = normalizeNumber(state.agent?.remaining);
    const codex5hPct = state.codex5h?.remainingPercent ?? null;
    const codex7dPct = state.codex7d?.remainingPercent ?? null;

    const anyZero =
      drRemaining === 0 ||
      agentRemaining === 0 ||
      codex5hPct === 0 ||
      codex7dPct === 0;
    if (anyZero) return 'cqh-bad';

    const anyLow =
      (drRemaining !== null && drRemaining < DR_AGENT_LOW) ||
      (agentRemaining !== null && agentRemaining < DR_AGENT_LOW) ||
      (codex5hPct !== null && codex5hPct < CODEX_LOW_PERCENT) ||
      (codex7dPct !== null && codex7dPct < CODEX_LOW_PERCENT);
    if (anyLow) return 'cqh-warn';

    return 'cqh-ok';
  }

  function buildSummaryText() {
    if (!state.lastUpdated && !state.dr && !state.agent) {
      if (state.pageIssue) return '需恢复';
      if (state.codexLoading) return '加载中…';
      if (state.codexError) return '错误';
      if (state.recoveryNotice) return '恢复中';
      return '等待数据';
    }

    const drText = state.dr ? `DR${formatRemaining(state.dr.remaining)}` : 'DR-';

    const codex5hText =
      state.codex5h?.remainingPercent !== null && state.codex5h?.remainingPercent !== undefined
        ? formatPercent(state.codex5h.remainingPercent)
        : '-';

    const codex7dText =
      state.codex7d?.remainingPercent !== null && state.codex7d?.remainingPercent !== undefined
        ? formatPercent(state.codex7d.remainingPercent)
        : '-';

    return `${drText}｜${codex5hText}｜${codex7dText}`;
  }

  function buildStatusLineText() {
    const parts = [];

    if (state.pageIssue?.message) {
      parts.push(state.pageIssue.message);
    } else if (state.codexError) {
      parts.push(state.codexError);
    } else if (state.recoveryNotice) {
      parts.push(state.recoveryNotice);
    }

    if (state.codexAutoPaused) {
      parts.push('自动刷新已暂停');
    } else if (state.codexBackoffUntil && Date.now() < state.codexBackoffUntil) {
      parts.push(`自动刷新 ${formatRetryDurationMs(state.codexBackoffUntil - Date.now())} 后重试`);
    }

    return parts.join('；');
  }

  function shouldShowRecoveryButton() {
    return true;
  }

  function renderPanel() {
    if (!document.body && !document.documentElement) return;

    const panel = ensurePanel();

    panel.classList.toggle('cqh-loading', state.codexLoading);

    // 指示灯颜色
    const indicator = panel.querySelector('[data-cqh="indicator"]');
    indicator.classList.remove('cqh-ok', 'cqh-warn', 'cqh-bad');
    const cls = computeIndicatorClass();
    if (cls) indicator.classList.add(cls);

    // 摘要文本
    panel.querySelector('[data-cqh="summary-text"]').textContent = buildSummaryText();

    // 详情：DR
    const drCell = panel.querySelector('[data-cqh="dr"]');
    if (state.dr) {
      drCell.textContent = `${formatRemaining(state.dr.remaining)} (${formatIsoReset(state.dr.reset_after)})`;
    } else {
      drCell.textContent = '等待对话';
    }

    // 详情：Agent
    const agentCell = panel.querySelector('[data-cqh="agent"]');
    if (state.agent) {
      agentCell.textContent = `${formatRemaining(state.agent.remaining)} (${formatIsoReset(state.agent.reset_after)})`;
    } else {
      agentCell.textContent = '等待对话';
    }

    // 详情：Codex 5H
    const codex5hCell = panel.querySelector('[data-cqh="codex5h"]');
    codex5hCell.classList.remove('cqh-error-text');
    if (state.codex5h) {
      codex5hCell.textContent = `${formatPercent(state.codex5h.remainingPercent)} (${formatWindowReset(state.codex5h)})`;
    } else if (state.codexError) {
      codex5hCell.textContent = '错误';
      codex5hCell.classList.add('cqh-error-text');
    } else if (state.codexLoading) {
      codex5hCell.textContent = '加载中…';
    } else {
      codex5hCell.textContent = '-';
    }

    // 详情：Codex 7D
    const codex7dCell = panel.querySelector('[data-cqh="codex7d"]');
    codex7dCell.classList.remove('cqh-error-text');
    if (state.codex7d) {
      codex7dCell.textContent = `${formatPercent(state.codex7d.remainingPercent)} (${formatWindowReset(state.codex7d)})`;
    } else if (state.codexError) {
      codex7dCell.textContent = '错误';
      codex7dCell.classList.add('cqh-error-text');
    } else if (state.codexLoading) {
      codex7dCell.textContent = '加载中…';
    } else {
      codex7dCell.textContent = '-';
    }

    // 错误和恢复提示（只显示净化后的短消息）
    const errorLine = panel.querySelector('[data-cqh="error-line"]');
    const statusLineText = buildStatusLineText();
    if (statusLineText) {
      errorLine.textContent = statusLineText;
      errorLine.hidden = false;
    } else {
      errorLine.textContent = '';
      errorLine.hidden = true;
    }

    // 更新时间
    panel.querySelector('[data-cqh="updated"]').textContent = formatClock(state.lastUpdated);

    // 刷新按钮
    const refreshButton = panel.querySelector('[data-cqh="refresh"]');
    refreshButton.disabled = state.codexLoading;
    refreshButton.textContent = state.codexLoading ? '加载中' : '刷新';

    const recoverButton = panel.querySelector('[data-cqh="recover"]');
    recoverButton.hidden = !shouldShowRecoveryButton();
    recoverButton.disabled = false;
    recoverButton.textContent = state.recoveryRecommended || state.pageIssue ? '恢复加载' : '恢复';
  }

  function installRecoveryShortcut() {
    window.addEventListener('keydown', (event) => {
      if (
        event.altKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.code === 'KeyR'
      ) {
        event.preventDefault();
        event.stopPropagation();
        recoverPage();
      }
    }, true);
  }

  function setRecoveryMarker(kind) {
    try {
      sessionStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({
        ts: Date.now(),
        kind: kind || 'manual'
      }));
    } catch {
      // ignore
    }
  }

  function consumeRecoveryMarker() {
    try {
      const raw = sessionStorage.getItem(RECOVERY_STORAGE_KEY);
      if (!raw) return;

      sessionStorage.removeItem(RECOVERY_STORAGE_KEY);
      const marker = JSON.parse(raw);
      if (marker?.ts && Date.now() - marker.ts <= RECOVERY_MARKER_TTL_MS) {
        state.recoveryNotice = '已尝试恢复页面，等待数据刷新';
      }
    } catch {
      // ignore
    }
  }

  function cleanupRecoveryQueryParam() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has(RECOVERY_QUERY_PARAM)) return;

      url.searchParams.delete(RECOVERY_QUERY_PARAM);
      const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
      history.replaceState(history.state, '', cleanUrl);
    } catch {
      // ignore
    }
  }

  function buildRecoveryUrl() {
    const url = new URL(location.href);
    url.searchParams.set(RECOVERY_QUERY_PARAM, String(Date.now()));
    return url.toString();
  }

  function recoverPage() {
    const kind = state.pageIssue?.kind || 'manual';

    if (!state.pageIssue && !state.recoveryRecommended) {
      const confirmed = window.confirm('恢复加载会重新加载当前页面，可能丢失未发送内容。继续吗？');
      if (!confirmed) return;
    }

    clearSessionInfoCache();
    state.codexBackoffUntil = 0;
    state.codexAutoPaused = false;
    state.consecutiveCodexErrors = 0;

    setRecoveryMarker(kind);
    location.replace(buildRecoveryUrl());
  }

  function installPageHealthObserver() {
    window.addEventListener('error', (event) => {
      if (isResourceChunkErrorTarget(event.target)) {
        recordPageIssue('chunk-load', '检测到前端资源加载失败，建议恢复页面');
        return;
      }

      if (isChunkLikeMessage(getErrorEventText(event))) {
        recordPageIssue('chunk-load', '检测到前端资源加载失败，建议恢复页面');
      }
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
      if (isChunkLikeMessage(getRejectionText(event.reason))) {
        recordPageIssue('chunk-load', '检测到前端资源加载失败，建议恢复页面');
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden || isExcludedPath()) {
        stopCodexAutoRefresh();
        renderPanel();
        return;
      }

      if (!CODEX_AUTO_REFRESH_ENABLED) {
        renderPanel();
        return;
      }

      if (!state.codexAutoPaused && !state.codexLoading) {
        loadCodexUsage({ source: 'auto' }).finally(startCodexAutoRefresh);
      } else {
        startCodexAutoRefresh();
      }
    });
  }

  // ========== 数据捕获 ==========

  function handleConversationInitData(data) {
    if (capturedConversationInitOnce) return;

    if (!data || typeof data !== 'object') return;
    if (!Array.isArray(data.limits_progress)) return;

    const dr = getLimit(data, 'deep_research');

    const agent =
      getLimit(data, 'odyssey') ||
      getLimit(data, 'agent') ||
      getLimit(data, 'agent_mode');

    if (!dr && !agent) return;

    state.dr = dr;
    state.agent = agent;

    capturedConversationInitOnce = true;
    renderPanel();
  }

  if (typeof originalFetch === 'function') {
    window.fetch = async function patchedFetch(input) {
      const response = await originalFetch.apply(this, arguments);

      try {
        inspectFetchResponseForPageIssue(response);

        if (isConversationInitUrl(input)) {
          response
            .clone()
            .json()
            .then(handleConversationInitData)
            .catch(() => {});
        }
      } catch {
        // ignore
      }

      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(_method, url) {
    this.__cqhUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    try {
      this.addEventListener('loadend', function () {
        try {
          inspectXhrForPageIssue(this);

          if (isConversationInitUrl(this.__cqhUrl)) {
            if (!this.responseText) return;
            handleConversationInitData(JSON.parse(this.responseText));
          }
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    return originalSend.apply(this, arguments);
  };

  // ========== 路径守卫 / SPA 路由 ==========

  function isExcludedPath() {
    const path = location.pathname || '/';
    return EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
  }

  function removePanel() {
    const panel = document.getElementById('cqh-panel');
    if (panel) panel.remove();
  }

  function applyForCurrentPath() {
    if (isExcludedPath()) {
      stopCodexAutoRefresh();
      removePanel();
      return;
    }

    ensurePanel();
    renderPanel();

    if (!state.lastUpdated && !state.codexLoading) {
      loadCodexUsage({ source: 'auto' });
    }

    startCodexAutoRefresh();
  }

  function installRouteObserver() {
    const notify = () => setTimeout(applyForCurrentPath, 0);

    const patchHistoryMethod = (methodName) => {
      const original = window.history[methodName];
      if (typeof original !== 'function') return;
      window.history[methodName] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        notify();
        return result;
      };
    };

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', notify);
  }

  // ========== 启动 ==========

  function boot() {
    cleanupRecoveryQueryParam();
    consumeRecoveryMarker();
    installRouteObserver();
    applyForCurrentPath();
  }

  installPageHealthObserver();

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
