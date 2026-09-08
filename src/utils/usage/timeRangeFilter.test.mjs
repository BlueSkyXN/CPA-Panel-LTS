import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const usageModule = await vite.ssrLoadModule('/src/utils/usage.ts');
const workspace = await vite.ssrLoadModule('/src/utils/usage/eventWorkspace.ts');

test.after(async () => {
  await vite.close();
});

const NOW_MS = Date.parse('2026-08-17T12:00:00Z');

const buildUsage = () => ({
  total_requests: 3,
  success_count: 3,
  failure_count: 0,
  total_tokens: 700,
  apis: {
    'POST /v1/messages': {
      total_requests: 3,
      success_count: 3,
      failure_count: 0,
      total_tokens: 700,
      models: {
        'claude-x': {
          total_requests: 3,
          success_count: 3,
          failure_count: 0,
          total_tokens: 700,
          details: [
            { timestamp: '2026-08-17T11:30:00Z', tokens: { total_tokens: 100 } },
            { timestamp: '2026-08-16T00:00:00Z', tokens: { total_tokens: 200 } },
            { timestamp: '2026-08-18T00:00:00Z', tokens: { total_tokens: 400 } },
          ],
        },
      },
    },
  },
});

test('filterUsageByTimeRange keeps data untouched for the all range', () => {
  const usage = buildUsage();
  assert.equal(usageModule.filterUsageByTimeRange(usage, 'all', NOW_MS), usage);
});

test('filterUsageByTimeRange filters preset ranges against now', () => {
  const filtered = usageModule.filterUsageByTimeRange(buildUsage(), '24h', NOW_MS);
  const models = filtered.apis['POST /v1/messages'].models;
  // 只有 now-24h 之后的 11:30 事件保留；更早的 00:00 与未来事件被剔除
  assert.equal(models['claude-x'].details.length, 1);
  assert.equal(models['claude-x'].details[0].timestamp, '2026-08-17T11:30:00Z');
  assert.equal(models['claude-x'].total_requests, 1);
  assert.equal(filtered.apis['POST /v1/messages'].total_requests, 1);
  assert.equal(filtered.total_requests, 1);
});

test('filterUsageByTimeRange honors explicit custom windows including the end bound', () => {
  const customWindow = {
    startMs: Date.parse('2026-08-15T12:00:00Z'),
    endMs: Date.parse('2026-08-17T11:45:00Z'),
  };
  const filtered = usageModule.filterUsageByTimeRange(buildUsage(), customWindow, NOW_MS);
  const models = filtered.apis['POST /v1/messages'].models;
  assert.deepEqual(
    models['claude-x'].details.map((detail) => detail.timestamp),
    ['2026-08-17T11:30:00Z', '2026-08-16T00:00:00Z']
  );
  assert.equal(filtered.total_requests, 2);
});

test('filterUsageByTimeRange falls back to unfiltered data for invalid custom windows', () => {
  const usage = buildUsage();
  const invalidWindow = {
    startMs: Date.parse('2026-08-17T12:00:00Z'),
    endMs: Date.parse('2026-08-16T12:00:00Z'),
  };
  assert.equal(usageModule.filterUsageByTimeRange(usage, invalidWindow, NOW_MS), usage);
});

test('resolveUsageTimeRangeWindow derives absolute windows', () => {
  assert.equal(usageModule.resolveUsageTimeRangeWindow('all', NOW_MS), null);
  assert.equal(usageModule.resolveUsageTimeRangeWindow('custom', NOW_MS), null);
  assert.deepEqual(usageModule.resolveUsageTimeRangeWindow('3h', NOW_MS), {
    startMs: NOW_MS - 3 * 60 * 60 * 1000,
    endMs: NOW_MS,
  });
  assert.deepEqual(
    usageModule.resolveUsageTimeRangeWindow(
      { startMs: 1000, endMs: 2000 },
      NOW_MS
    ),
    { startMs: 1000, endMs: 2000 }
  );
  assert.equal(usageModule.resolveUsageTimeRangeWindow({ startMs: 2000, endMs: 1000 }, NOW_MS), null);
});

test('usageTimeRangeWindowHours reports window span in hours', () => {
  assert.equal(usageModule.usageTimeRangeWindowHours(null), undefined);
  assert.equal(
    usageModule.usageTimeRangeWindowHours(usageModule.resolveUsageTimeRangeWindow('48h', NOW_MS)),
    48
  );
  assert.equal(
    usageModule.usageTimeRangeWindowHours({
      startMs: NOW_MS - 90 * 60 * 1000,
      endMs: NOW_MS,
    }),
    2
  );
});

const usage = usageModule;
const now = Date.parse('2026-09-07T12:00:00Z');
const hour = 3_600_000;
const event = (ms, failed = false) => ({ timestamp: new Date(ms).toISOString(), failed, tokens: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
const fixture = {
  total_requests: 9, total_tokens: 9999, success_count: 8, failure_count: 1,
  apis: { 'POST /v1/responses': { models: {
    'gpt-5.6-sol': { total_requests: 9, total_tokens: 9999, details: [
      event(now - hour - 1), event(now - hour), event(now - hour / 2, true), event(now), event(now + 1),
      { timestamp: 'invalid', tokens: { total_tokens: 99 } },
    ] },
  } } },
};

for (const [range, hours] of [['1h', 1], ['3h', 3], ['6h', 6], ['12h', 12], ['24h', 24], ['48h', 48], ['7d', 168], ['14d', 336], ['30d', 720], ['90d', 2160]]) {
  test(`${range} has the exact configured lookback`, () => {
    assert.deepEqual(usage.resolveUsageTimeRangeWindow(range, now), { startMs: now - hours * hour, endMs: now });
  });
}

test('bounded filtering includes both boundaries and excludes future/invalid timestamps', () => {
  const before = JSON.stringify(fixture);
  const filtered = usage.filterUsageByTimeRange(fixture, '1h', now);
  assert.equal(filtered.total_requests, 3);
  assert.equal(filtered.success_count, 2);
  assert.equal(filtered.failure_count, 1);
  assert.equal(filtered.total_tokens, 45);
  assert.equal(filtered.apis['POST /v1/responses'].models['gpt-5.6-sol'].details.length, 3);
  assert.equal(JSON.stringify(fixture), before);
});

test('custom absolute windows use their own end, not the current clock', () => {
  const filtered = usage.filterUsageByTimeRange(fixture, { startMs: now - hour, endMs: now - hour / 2 }, now);
  assert.equal(filtered.total_requests, 2);
  assert.equal(filtered.total_tokens, 30);
});

test('All Time retains aggregate-only usage and the original snapshot', () => {
  assert.equal(usage.filterUsageByTimeRange(fixture, 'all', now), fixture);
  assert.equal(usage.filterUsageByTimeRange(fixture, 'all', now).total_tokens, 9999);
});

test('empty bounded windows return zero totals instead of all historical aggregates', () => {
  const filtered = usage.filterUsageByTimeRange(fixture, { startMs: now + hour, endMs: now + 2 * hour }, now);
  assert.equal(filtered.total_requests, 0);
  assert.equal(filtered.total_tokens, 0);
  assert.deepEqual(filtered.apis, {});
});

test('overview-to-workspace URLs preserve preset and custom scopes', () => {
  for (const range of [...usage.USAGE_PRESET_TIME_RANGES, 'all']) {
    const result = workspace.resolveUsageEventsScope(new URLSearchParams(workspace.buildUsageEventsSearch(range, null)));
    assert.deepEqual(result, { range, customRange: null, valid: true });
  }
  const customRange = { startMs: now - hour, endMs: now };
  const result = workspace.resolveUsageEventsScope(new URLSearchParams(workspace.buildUsageEventsSearch('custom', customRange)));
  assert.deepEqual(result, { range: 'custom', customRange, valid: true });
});

test('malformed custom URLs are invalid, never silently widened to all history', () => {
  for (const query of ['range=custom', 'range=custom&start=&end=1', 'range=custom&start=20&end=10', 'range=custom&start=no&end=10', 'range=custom&start=0&end=Infinity']) {
    assert.deepEqual(workspace.resolveUsageEventsScope(new URLSearchParams(query)), { range: 'custom', customRange: null, valid: false });
  }
});

test('direct workspace visits inherit stored scope and explicit URLs win', () => {
  const storage = { getItem: (key) => key.includes('custom') ? JSON.stringify({ start: '2026-09-06T00:00', end: '2026-09-07T00:00' }) : 'custom' };
  const inherited = workspace.resolveUsageEventsScope(new URLSearchParams(), storage);
  assert.equal(inherited.range, 'custom');
  assert.equal(inherited.valid, true);
  assert.equal(inherited.customRange.endMs - inherited.customRange.startMs, 24 * hour);
  assert.deepEqual(workspace.resolveUsageEventsScope(new URLSearchParams('range=all'), storage), { range: 'all', customRange: null, valid: true });
});

test('missing, blocked or malformed storage still allows a default workspace visit', () => {
  const blocked = { getItem() { throw new Error('storage blocked'); } };
  const malformed = { getItem: () => '{bad-json' };
  for (const storage of [undefined, blocked, malformed]) {
    assert.deepEqual(workspace.resolveUsageEventsScope(new URLSearchParams(), storage), { range: '24h', customRange: null, valid: true });
  }
});

for (const [name, window, timestamps] of [
  ['historical custom day', { startMs: now - 8 * 24 * hour, endMs: now - 7 * 24 * hour }, [now - 8 * 24 * hour, now - 7 * 24 * hour]],
  ['90 days', { startMs: now - 90 * 24 * hour, endMs: now }, [now - 45 * 24 * hour]],
  ['partial hours', { startMs: now - 40 * 60_000, endMs: now + 20 * 60_000 }, [now - 35 * 60_000, now + 15 * 60_000]],
  ['long custom range', { startMs: now - 1000 * 24 * hour, endMs: now }, [now - 500 * 24 * hour]],
]) {
  test(`all hourly charts retain the same requests and tokens for ${name}`, () => {
    const snapshot = { apis: { test: { models: { 'gpt-5.6-sol': { details: timestamps.map((ms) => ({
      timestamp: new Date(ms).toISOString(), tokens: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, failed: false,
    })) } } } } };
    const sum = (values) => values.reduce((total, value) => total + value, 0);
    const requests = usage.buildHourlySeriesByModel(snapshot, 'requests', window);
    assert.equal(sum([...requests.dataByModel.values()].flat()), timestamps.length);
    const chart = usage.buildChartData(snapshot, 'hour', 'tokens', ['all'], { timeWindow: window });
    assert.equal(sum(chart.datasets[0].data), timestamps.length * 120);
    const tokens = usage.buildHourlyTokenBreakdown(snapshot, window);
    assert.equal(sum(tokens.dataByCategory.input), timestamps.length * 100);
    assert.deepEqual(tokens.labels, requests.labels);
    const cost = usage.buildHourlyCostSeries(snapshot, undefined, window);
    assert.equal(cost.pricingCoverage.totalRequests, timestamps.length);
    assert.equal(sum(cost.data), sum(usage.buildDailyCostSeries(snapshot).data));
    assert.deepEqual(cost.labels, requests.labels);
    assert.ok(requests.labels.length <= 24 * 90 + 1, 'large custom ranges must not allocate unbounded empty buckets');
  });
}
