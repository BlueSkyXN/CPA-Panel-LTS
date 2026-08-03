import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [
  { buildKimiQuotaRows },
  { buildClaudeQuotaWindows },
  { buildCodexAnalyticsRange, selectCodexDailyUsageDays },
  authFileConstants,
] = await Promise.all([
  vite.ssrLoadModule('/src/utils/quota/builders.ts'),
  vite.ssrLoadModule('/src/components/quota/quotaConfigs.ts'),
  vite.ssrLoadModule('/src/lts/codexQuota/config.ts'),
  vite.ssrLoadModule('/src/features/authFiles/constants.ts'),
]);

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
      { date: '', totals: { credits: 2000, text_total_tokens: 2000 } },
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
