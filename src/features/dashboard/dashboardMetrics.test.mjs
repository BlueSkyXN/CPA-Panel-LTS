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

const [format, dashboard, overview] = await Promise.all([
  vite.ssrLoadModule('/src/utils/format.ts'),
  vite.ssrLoadModule('/src/features/dashboard/utils.ts'),
  vite.ssrLoadModule('/src/features/dashboard/hooks/useDashboardOverview.ts'),
]);

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('formats compact dashboard values without unstable boundaries', () => {
  assert.equal(format.formatCompactNumber(999), '999');
  assert.equal(format.formatCompactNumber(1284), '1.3K');
  assert.equal(format.formatCompactNumber(999_999), '1M');
  assert.equal(format.formatCompactNumber(-1500), '-1.5K');
  assert.equal(format.formatPercent(99.5), '99.5%');
  assert.equal(format.formatPercent(Number.NaN), '—');
});

test('keeps chart scales above the peak with whole-number grid intervals', () => {
  for (const peak of [0, 1, 7, 112, 1533]) {
    const max = dashboard.axisMax(peak, 4);
    assert.ok(max >= peak);
    assert.equal(Number.isInteger(max / 4), true);
  }
  assert.equal(dashboard.axisMax(112, 4), 120);
});

test('keeps labels, windows, and success-rate severity deterministic', () => {
  assert.equal(dashboard.providerLabel('xai', 'Unattributed'), 'xAI');
  assert.equal(dashboard.providerLabel('unknown', 'Unattributed'), 'Unattributed');
  assert.deepEqual(dashboard.splitWindowMinutes(200), { hours: 3, minutes: 20 });
  assert.equal(dashboard.toneForSuccessRate(95), 'good');
  assert.equal(dashboard.toneForSuccessRate(79.9), 'critical');
});

test('retains LTS ampcode and Interactions API in dashboard key counts', () => {
  const counts = overview.getProviderKeyCounts({
    geminiApiKeys: [{ apiKey: 'gemini-key' }],
    interactionsApiKeys: [{ apiKey: 'interactions-key' }],
    codexApiKeys: [{ apiKey: 'codex-key' }],
    ampcode: { upstreamUrl: 'https://amp.example.test' },
  });

  assert.equal(counts.ampcode, 1);
  assert.equal(counts.interactions, 1);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 4);
});

test('keeps provider totals scoped to the same recent buckets as the traffic chart', () => {
  const summary = overview.summarizeProviderTraffic([
    [
      { time: '12:00-12:10', success: 3, failed: 1 },
      { time: '12:10-12:20', success: 2, failed: 0 },
    ],
    [
      { time: '12:00-12:10', success: 1, failed: 0 },
      { time: '12:10-12:20', success: 0, failed: 1 },
    ],
  ]);

  assert.equal(summary.success, 6);
  assert.equal(summary.failure, 2);
  assert.equal(summary.total, 8);
  assert.equal(summary.successRate, 75);
  assert.deepEqual(
    summary.buckets.map(({ success, failed }) => ({ success, failed })),
    [
      { success: 4, failed: 1 },
      { success: 2, failed: 1 },
    ]
  );
});
