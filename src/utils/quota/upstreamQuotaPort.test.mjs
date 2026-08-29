import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [
  {
    applyXaiAutoTopupRule,
    buildAntigravityQuotaGroups,
    buildKimiQuotaRows,
    buildXaiBillingSummary,
    mergeXaiBillingSummaries,
  },
  { ANTIGRAVITY_CONFIG, buildClaudeQuotaWindows, XAI_CONFIG },
  {
    buildCodexAnalyticsRange,
    classifyCodexLeaderboardPayloadForAccount,
    codexTeamLeaderboardCacheKey,
    selectCodexDailyUsageDays,
  },
  authFileConstants,
  { invalidateAuthFileDerivedCaches },
  { useQuotaStore },
  { authFilesApi, normalizeAuthFilesResponse },
  { parseXaiAutoTopupPayload },
  quotaConstants,
  i18nModule,
  { apiCallApi },
  { parseAntigravitySubscriptionSummary },
] = await Promise.all([
  vite.ssrLoadModule('/src/utils/quota/builders.ts'),
  vite.ssrLoadModule('/src/components/quota/quotaConfigs.ts'),
  vite.ssrLoadModule('/src/lts/codexQuota/config.ts'),
  vite.ssrLoadModule('/src/features/authFiles/constants.ts'),
  vite.ssrLoadModule('/src/features/authFiles/cacheInvalidation.ts'),
  vite.ssrLoadModule('/src/stores/useQuotaStore.ts'),
  vite.ssrLoadModule('/src/services/api/authFiles.ts'),
  vite.ssrLoadModule('/src/utils/quota/parsers.ts'),
  vite.ssrLoadModule('/src/utils/quota/constants.ts'),
  vite.ssrLoadModule('/src/i18n/index.ts'),
  vite.ssrLoadModule('/src/services/api/apiCall.ts'),
  vite.ssrLoadModule('/src/services/api/antigravitySubscription.ts'),
]);

const i18n = i18nModule.default;

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('shows Kimi detail windows before the weekly summary', () => {
  const rows = buildKimiQuotaRows({
    usage: { used: 200, limit: 1000 },
    limits: [
      {
        detail: { used: 20, limit: 100 },
        window: { duration: 300, timeUnit: 'MINUTES' },
      },
    ],
  });

  assert.deepEqual(
    rows.map(({ id }) => id),
    ['limit-0', 'summary']
  );
  assert.equal(rows[0]?.labelKey, 'kimi_quota.limit_window');
  assert.deepEqual(rows[0]?.labelParams, { duration: '5h' });
  assert.equal(rows[1]?.labelKey, 'kimi_quota.weekly_limit');
});

test('formats Kimi reset durations longer than one day as days and hours', () => {
  const resetHint = (resetIn) =>
    buildKimiQuotaRows({ usage: { used: 200, limit: 1000, resetIn } })[0]?.resetHint;

  assert.equal(resetHint(132 * 3600), '5d 12h');
  assert.equal(resetHint(168 * 3600), '7d 0h');
  assert.equal(resetHint(5 * 3600 + 30 * 60), '5h 30m');
  assert.equal(resetHint(59), '<1m');
});

test('normalizes Kimi protobuf week units and retains the concrete reset instant', () => {
  const resetAt = '2099-08-03T12:34:56.000Z';
  const rows = buildKimiQuotaRows({
    limits: [
      {
        detail: { used: 1, limit: 10, reset_at: resetAt },
        window: { duration: 1, time_unit: 'TIME_UNIT_WEEK' },
      },
    ],
  });

  assert.equal(rows[0]?.labelParams?.duration, '1w');
  assert.equal(rows[0]?.resetAtMs, Date.parse(resetAt));
});

test('keeps xAI period type and dates from one endpoint', () => {
  const weekly = {
    periodType: 'weekly',
    usagePercent: 25,
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: undefined,
    productUsage: [],
    monthlyLimitCents: null,
    usedCents: null,
    includedUsedCents: null,
    onDemandCapCents: null,
    onDemandUsedCents: null,
    onDemandUsedPercent: null,
    usedPercent: null,
  };
  const monthly = {
    ...weekly,
    periodType: 'monthly',
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-09-01T00:00:00Z',
    monthlyLimitCents: 2000,
  };

  const merged = mergeXaiBillingSummaries(weekly, monthly);
  assert.equal(merged?.periodType, 'weekly');
  assert.equal(merged?.periodStart, weekly.periodStart);
  assert.equal(merged?.periodEnd, undefined);
});

test('parses current xAI billing supplements without breaking legacy fields', () => {
  const current = buildXaiBillingSummary(
    {
      credit_usage_percent: '35',
      current_period: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-08-01T00:00:00Z' },
      prepaid_balance: { val: 875 },
      is_unified_billing_user: true,
      history: [{ billing_cycle: { year: 2026, month: 7 }, total_used: { val: 42 } }],
    },
    { on_demand_enabled: false, subscription_tier: 'SuperGrok Heavy' }
  );

  assert.equal(current?.periodType, 'weekly');
  assert.equal(current?.usagePercent, 35);
  assert.equal(current?.prepaidBalanceCents, 875);
  assert.equal(current?.isUnifiedBillingUser, true);
  assert.equal(current?.onDemandEnabled, false);
  assert.equal(current?.subscriptionTier, 'SuperGrok Heavy');
  assert.equal(current?.historyCount, 1);

  const withTopup = applyXaiAutoTopupRule(current, {
    enabled: true,
    min_before_hitting_sl: { val: -100 },
    topup_amount: { val: -750 },
    max_amount_per_month: { val: -2500 },
  });
  assert.equal(withTopup.autoTopupEnabled, true);
  assert.equal(withTopup.autoTopupAmountCents, -750);
  assert.equal(withTopup.autoTopupMaxPerMonthCents, -2500);

  const disabledTopup = applyXaiAutoTopupRule(current, {});
  assert.equal(disabledTopup.autoTopupEnabled, false);
  assert.equal(disabledTopup.autoTopupAmountCents, null);

  for (const missingRule of [undefined, null]) {
    const noRule = applyXaiAutoTopupRule(current, missingRule);
    assert.equal(noRule.autoTopupEnabled, false);
    assert.equal(noRule.autoTopupAmountCents, null);
    assert.equal(noRule.autoTopupMaxPerMonthCents, null);
  }

  const previous = {
    status: 'success',
    billing: withTopup,
  };
  const preserved = XAI_CONFIG.buildSuccessState(
    { billing: current, preserveAutoTopup: true },
    previous
  );
  assert.equal(preserved.billing?.autoTopupEnabled, true);
  assert.equal(preserved.billing?.autoTopupAmountCents, -750);
  const cleared = XAI_CONFIG.buildSuccessState(
    { billing: current, preserveAutoTopup: false },
    previous
  );
  assert.equal(cleared.billing?.autoTopupEnabled, null);

  for (const malformed of [
    [],
    '[ ]',
    { rule: [] },
    '{"rule":[]}',
    { raw: 'upstream-not-json' },
    '{"raw":"upstream-not-json"}',
  ]) {
    assert.equal(parseXaiAutoTopupPayload(malformed), null);
  }
  assert.deepEqual(parseXaiAutoTopupPayload('{}'), {});
  assert.deepEqual(parseXaiAutoTopupPayload('{"rule":null}'), { rule: null });

  const legacy = buildXaiBillingSummary({
    monthlyLimit: { val: 15000 },
    used: { val: 1250 },
    onDemandCap: { val: 5000 },
  });
  assert.equal(legacy?.monthlyLimitCents, 15000);
  assert.equal(legacy?.prepaidBalanceCents, null);
  assert.equal(legacy?.onDemandEnabled, null);
  assert.equal(legacy?.subscriptionTier, null);
  assert.equal(legacy?.historyCount, 0);
});

test('uses the current official Grok Shell identity for xAI billing requests', () => {
  const { XAI_GROK_CLIENT_VERSION, buildXaiGrokUserAgent, buildXaiRequestHeaders } =
    quotaConstants;

  assert.equal(XAI_GROK_CLIENT_VERSION, '1.0.3');
  assert.equal(
    buildXaiGrokUserAgent('MacIntel', 'Mozilla/5.0 (Macintosh; ARM64 Mac OS X)'),
    'grok-pager/1.0.3 grok-shell/1.0.3 (macos; aarch64)'
  );
  assert.equal(
    buildXaiGrokUserAgent('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
    'grok-pager/1.0.3 grok-shell/1.0.3 (macos; x86_64)'
  );
  assert.equal(
    buildXaiGrokUserAgent(
      'MacIntel',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'macOS'
    ),
    'grok-pager/1.0.3 grok-shell/1.0.3 (macos; x86_64)'
  );
  assert.equal(
    buildXaiGrokUserAgent('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)'),
    'grok-pager/1.0.3 grok-shell/1.0.3 (linux; x86_64)'
  );
  assert.equal(
    buildXaiGrokUserAgent('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),
    'grok-pager/1.0.3 grok-shell/1.0.3 (windows; x86_64)'
  );
  const headers = buildXaiRequestHeaders();
  assert.deepEqual(
    { ...headers, 'user-agent': '<validated separately>' },
    {
      Authorization: 'Bearer $TOKEN$',
      'x-xai-token-auth': 'xai-grok-cli',
      'x-grok-client-version': '1.0.3',
      'x-grok-client-mode': 'interactive',
      accept: 'application/json',
      'user-agent': '<validated separately>',
    }
  );
  assert.match(
    headers['user-agent'],
    /^grok-pager\/1\.0\.3 grok-shell\/1\.0\.3 \((?:macos|windows|linux|unknown); (?:aarch64|x86_64|unknown)\)$/
  );
});

test('uses the current Codex TUI identity for Codex quota requests', () => {
  assert.deepEqual(quotaConstants.CODEX_REQUEST_HEADERS, {
    Accept: 'application/json',
    Authorization: 'Bearer $TOKEN$',
    'Content-Type': 'application/json',
    'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
  });
});

test('parses Antigravity quota-summary groups and current request identity', () => {
  assert.deepEqual(quotaConstants.ANTIGRAVITY_QUOTA_URLS, [
    'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
    'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
    'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  ]);
  assert.equal(
    quotaConstants.ANTIGRAVITY_REQUEST_HEADERS['User-Agent'],
    'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)'
  );

  const groups = buildAntigravityQuotaGroups({
    groups: [
      {
        displayName: 'Gemini models',
        description: 'Models within this group: Gemini 3.1 Pro, Gemini 3 Flash',
        buckets: [
          {
            bucketId: 'five-hour',
            displayName: '5 hour limit',
            window: '5h',
            remainingFraction: '0.4',
            resetTime: '2099-08-29T12:00:00Z',
          },
          {
            bucketId: 'weekly',
            displayName: 'Weekly limit',
            window: 'weekly',
            remainingFraction: 0.75,
          },
        ],
      },
    ],
  });

  assert.equal(groups[0]?.id, 'gemini-models');
  assert.deepEqual(
    groups[0]?.buckets.map(({ id, remainingFraction }) => ({ id, remainingFraction })),
    [
      { id: 'weekly', remainingFraction: 0.75 },
      { id: 'five-hour', remainingFraction: 0.4 },
    ]
  );
  assert.deepEqual(
    parseAntigravitySubscriptionSummary({ paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' } }),
    { plan: 'pro', tierId: 'g1-pro-tier', tierName: 'Google AI Pro' }
  );
});

test('loads Antigravity project metadata and keeps subscription lookup best-effort', async (t) => {
  const originalRequest = apiCallApi.request;
  const originalDownloadText = authFilesApi.downloadText;
  const seen = [];
  let downloaded = false;

  apiCallApi.request = async (payload) => {
    seen.push(payload);
    if (payload.url === quotaConstants.ANTIGRAVITY_CODE_ASSIST_URL) {
      return {
        statusCode: 503,
        header: {},
        bodyText: 'temporarily unavailable',
        body: null,
      };
    }
    return {
      statusCode: 200,
      header: { Date: [new Date(Date.now() + 5000).toUTCString()] },
      bodyText: '',
      body: {
        groups: [
          {
            displayName: 'Gemini models',
            buckets: [
              { bucketId: 'weekly', displayName: 'Weekly limit', remainingFraction: 0.5 },
            ],
          },
        ],
      },
    };
  };
  authFilesApi.downloadText = async () => {
    downloaded = true;
    return '{}';
  };
  t.after(() => {
    apiCallApi.request = originalRequest;
    authFilesApi.downloadText = originalDownloadText;
  });

  const result = await ANTIGRAVITY_CONFIG.fetchQuota(
    {
      name: 'antigravity.json',
      auth_index: 'auth-1',
      attributes: { gemini_virtual_project: 'project-42' },
    },
    i18n.t.bind(i18n)
  );

  assert.equal(downloaded, false);
  assert.equal(result.groups[0]?.buckets[0]?.remainingFraction, 0.5);
  assert.equal(result.subscription, null);
  assert.ok(result.serverTimeOffsetMs >= 3000 && result.serverTimeOffsetMs <= 6000);
  const quotaRequest = seen.find((payload) =>
    quotaConstants.ANTIGRAVITY_QUOTA_URLS.includes(payload.url)
  );
  assert.ok(quotaRequest);
  assert.equal(quotaRequest.data, JSON.stringify({ project: 'project-42' }));
});

test('does not render a pseudo monthly row for weekly xAI credits with prepaid balance', () => {
  const billing = buildXaiBillingSummary({
    creditUsagePercent: 35,
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-08-01T00:00:00Z',
      end: '2026-08-08T00:00:00Z',
    },
    prepaidBalance: { val: -875 },
    isUnifiedBillingUser: true,
  });
  assert.ok(billing);

  const markup = renderToStaticMarkup(
    XAI_CONFIG.renderQuotaItems(
      { status: 'success', billing },
      i18n.t.bind(i18n),
      {
        styles: new Proxy({}, { get: (_target, key) => String(key) }),
        QuotaProgressBar: () => null,
      }
    )
  );

  assert.match(markup, new RegExp(i18n.t('xai_quota.weekly_limit')));
  assert.match(markup, new RegExp(i18n.t('xai_quota.prepaid_balance_label')));
  assert.doesNotMatch(markup, new RegExp(i18n.t('xai_quota.monthly_credits')));
});

test('continues xAI billing without x-userid when identity lookup fails', async (t) => {
  const originalRequest = apiCallApi.request;
  const seen = [];
  apiCallApi.request = async (payload) => {
    seen.push(payload);
    if (payload.url === quotaConstants.XAI_USER_URL) {
      return { statusCode: 401, header: {}, bodyText: '', body: null };
    }
    if (payload.url === quotaConstants.XAI_BILLING_WEEKLY_URL) {
      return {
        statusCode: 200,
        header: {},
        bodyText: '',
        body: {
          config: {
            creditUsagePercent: 25,
            currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY' },
          },
        },
      };
    }
    if (payload.url === quotaConstants.XAI_BILLING_MONTHLY_URL) {
      return { statusCode: 404, header: {}, bodyText: '', body: null };
    }
    throw new Error(`unexpected URL ${payload.url}`);
  };
  t.after(() => {
    apiCallApi.request = originalRequest;
  });

  const result = await XAI_CONFIG.fetchQuota(
    { name: 'legacy-xai.json', type: 'xai', auth_index: 'xai-auth-index' },
    i18n.t.bind(i18n)
  );

  assert.equal(result.billing.usagePercent, 25);
  const weekly = seen.find((payload) => payload.url === quotaConstants.XAI_BILLING_WEEKLY_URL);
  assert.ok(weekly, 'weekly billing should run after /user failure');
  assert.equal(weekly.header['x-userid'], undefined);
});

test('treats disabled credentials separately from actionable problem states', () => {
  const { isProblemAuthFile } = authFileConstants;
  assert.equal(isProblemAuthFile({ name: 'disabled', disabled: true, status: 'error' }), false);
  assert.equal(
    isProblemAuthFile({ name: 'status-disabled', status: 'disabled', unavailable: true }),
    false
  );
  assert.equal(isProblemAuthFile({ name: 'unavailable', unavailable: true }), true);
  assert.equal(isProblemAuthFile({ name: 'error', status: 'error' }), true);
  assert.equal(isProblemAuthFile({ name: 'healthy', statusMessage: 'healthy' }), false);
  assert.equal(isProblemAuthFile({ name: 'warning', statusMessage: 'token expired' }), true);
});

test('invalidates model and quota caches together after auth-file mutation', () => {
  let invalidatedNames = null;
  useQuotaStore.getState().setKimiQuota({
    'auth.json': { status: 'idle', rows: [] },
  });
  const before = useQuotaStore.getState().cacheGeneration;

  invalidateAuthFileDerivedCaches(
    (names) => {
      invalidatedNames = names;
    },
    ['auth.json']
  );

  assert.deepEqual(invalidatedNames, ['auth.json']);
  assert.equal(useQuotaStore.getState().cacheGeneration, before + 1);
  assert.deepEqual(useQuotaStore.getState().kimiQuota, {});
});

test('normalizes auth-file boundary fields without dropping raw provider data', () => {
  const normalized = normalizeAuthFilesResponse({
    files: [
      {
        name: 'auth.json',
        runtime_only: 'true',
        auth_index: 42,
        status_message: ' ready ',
        recent_requests: [{ time: '10:00-10:10', success: '2', failed: 1 }],
        success: '3',
        failed: 2,
        priority: '7',
        note: ' test note ',
        modtime: '2026-08-03T00:00:00Z',
        provider_specific: { retained: true },
      },
    ],
  });

  const file = normalized.files[0];
  assert.equal(file.runtimeOnly, true);
  assert.equal(file.authIndex, '42');
  assert.equal(file.statusMessage, 'ready');
  assert.equal(file.successCount, 3);
  assert.equal(file.failureCount, 2);
  assert.equal(file.priority, 7);
  assert.equal(file.note, 'test note');
  assert.equal(file.modified, Date.parse('2026-08-03T00:00:00Z'));
  assert.deepEqual(file.recentRequests, [{ time: '10:00-10:10', success: 2, failed: 1 }]);
  assert.deepEqual(file.provider_specific, { retained: true });
  assert.equal(file.status_message, ' ready ');
});

test('slices one Codex daily payload into exact rolling ranges before aggregation', () => {
  const payload = {
    data: [
      { date: '2026-06-16', totals: { credits: 1000, text_total_tokens: 1000 } },
      { date: '2026-06-15', totals: { credits: 7, text_total_tokens: 70 } },
      { date: '2025-06-20', totals: { credits: 100, text_total_tokens: 100 } },
      { date: '2026-03-18', totals: { credits: 3, text_total_tokens: 30 } },
      { date: '2026-05-17', totals: { credits: 4, text_total_tokens: 40 } },
      { date: '2025-06-21', totals: { credits: 1, text_total_tokens: 10 } },
      { date: '2026-06-01', totals: { credits: 5, text_total_tokens: 50 } },
      { date: '2026-03-17', totals: { credits: 2, text_total_tokens: 20 } },
      { date: '2026-06-11', totals: { credits: 6, text_total_tokens: 60 } },
    ],
  };

  assert.deepEqual(
    selectCodexDailyUsageDays(payload, '2026-05-17', '2026-06-16').map((day) => day.date),
    ['2026-05-17', '2026-06-01', '2026-06-11', '2026-06-15']
  );

  const rolling90 = buildCodexAnalyticsRange(
    payload,
    'rolling-90',
    'codex_quota.analytics_rolling_days',
    '2026-03-18',
    '2026-06-16'
  );
  assert.deepEqual(
    {
      returnedDays: rolling90.returnedDays,
      firstDate: rolling90.firstDate,
      lastDate: rolling90.lastDate,
      credits: rolling90.credits,
      usd: rolling90.usd,
      tokens: rolling90.tokens,
    },
    {
      returnedDays: 5,
      firstDate: '2026-03-18',
      lastDate: '2026-06-15',
      credits: 25,
      usd: 1,
      tokens: 250,
    }
  );
});

test('rejects malformed and duplicate Codex daily buckets instead of double counting them', () => {
  assert.throws(
    () =>
      selectCodexDailyUsageDays(
        { data: [{ date: '2026-02-30', totals: { credits: 1 } }] },
        '2026-01-01',
        '2027-01-01'
      ),
    /invalid date/
  );
  assert.throws(
    () =>
      selectCodexDailyUsageDays(
        {
          data: [
            { date: '2026-06-15', totals: { credits: 1 } },
            { date: '2026-06-15', totals: { credits: 2 } },
          ],
        },
        '2026-01-01',
        '2027-01-01'
      ),
    /duplicate date 2026-06-15/
  );
});

test('isolates Team leaderboard cache keys by auth index', () => {
  const first = codexTeamLeaderboardCacheKey('auth-a', 'team-same', '2026-06-01', '2026-06-15');
  const second = codexTeamLeaderboardCacheKey('auth-b', 'team-same', '2026-06-01', '2026-06-15');
  assert.notEqual(first, second);
});

test('fails closed for incomplete or ambiguous Team leaderboard identity', () => {
  const accountEmail = 'current@example.test';
  const current = { email: accountEmail, credits: 2 };
  const other = { email: 'other@example.test', credits: 4 };

  assert.equal(
    classifyCodexLeaderboardPayloadForAccount({ total_users: 2, data: [current, other] }, null)
      .status,
    'missing-account-email'
  );
  assert.equal(
    classifyCodexLeaderboardPayloadForAccount(
      { total_users: 3, data: [current, other] },
      accountEmail
    ).status,
    'incomplete'
  );
  assert.equal(
    classifyCodexLeaderboardPayloadForAccount(
      { total_users: 2, has_more: true, data: [current, other] },
      accountEmail
    ).status,
    'incomplete'
  );
  assert.equal(
    classifyCodexLeaderboardPayloadForAccount({ total_users: 1, data: [other] }, accountEmail)
      .status,
    'user-missing'
  );
  assert.equal(
    classifyCodexLeaderboardPayloadForAccount(
      { total_users: 2, data: [current, { ...current }] },
      accountEmail
    ).status,
    'user-ambiguous'
  );
  assert.equal(
    classifyCodexLeaderboardPayloadForAccount(
      { total_users: 2, data: [current, other] },
      accountEmail
    ).status,
    'ok'
  );
});

test('builds the modern Claude Fable quota without duplicating the legacy field', () => {
  const modernReset = '2026-07-27T10:00:00.000000+00:00';
  const windows = buildClaudeQuotaWindows(
    {
      iguana_necktie: {
        utilization: 41,
        resets_at: '2026-07-28T10:00:00.000000+00:00',
      },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 12,
          resets_at: '2026-07-29T10:00:00.000000+00:00',
          is_active: false,
          scope: { model: { display_name: 'Fable 5' } },
        },
        {
          kind: 'weekly_scoped',
          percent: 64,
          resets_at: modernReset,
          is_active: true,
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    },
    (key) => key
  );

  assert.equal(windows.length, 1);
  assert.deepEqual(
    {
      id: windows[0]?.id,
      label: windows[0]?.label,
      labelKey: windows[0]?.labelKey,
      usedPercent: windows[0]?.usedPercent,
    },
    {
      id: 'seven-day-fable',
      label: 'claude_quota.seven_day_fable',
      labelKey: 'claude_quota.seven_day_fable',
      usedPercent: 64,
    }
  );
  assert.ok(windows[0]?.resetLabel);
});

test('keeps the legacy Claude Fable field when modern scoped data is unusable', () => {
  const windows = buildClaudeQuotaWindows(
    {
      iguana_necktie: {
        utilization: 41,
        resets_at: '2026-07-28T10:00:00.000000+00:00',
      },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: null,
          is_active: true,
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    },
    (key) => key
  );

  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.id, 'seven-day-fable');
  assert.equal(windows[0]?.usedPercent, 41);
});

test('uses the Kimi theme surface without changing other auth providers', () => {
  assert.equal(authFileConstants.isThemeSurfaceIconProvider(' KIMI '), true);
  assert.equal(authFileConstants.isThemeSurfaceIconProvider('codex'), false);
  assert.equal(authFileConstants.getThemeSurfaceIconBackground('light'), '#000000');
  assert.equal(authFileConstants.getThemeSurfaceIconBackground('dark'), '#ffffff');
});
