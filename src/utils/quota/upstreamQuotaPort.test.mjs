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

const [{ buildKimiQuotaRows }, { buildClaudeQuotaWindows }, authFileConstants] = await Promise.all([
  vite.ssrLoadModule('/src/utils/quota/builders.ts'),
  vite.ssrLoadModule('/src/components/quota/quotaConfigs.ts'),
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
