import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [cache, error] = await Promise.all([
  vite.ssrLoadModule('/src/utils/usage/cacheAnalytics.ts'),
  vite.ssrLoadModule('/src/utils/usage/errorAnalytics.ts'),
]);
test.after(() => vite.close());

const at = (year, month, day, hour, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

test('collects cache rows with cached_tokens mirror fallback', () => {
  const rows = cache.collectCacheAnalysisRows([
    {
      __timestampMs: at(2026, 10, 7, 10),
      tokens: { input_tokens: 1_000, cache_read_tokens: 400, cache_creation_tokens: 100 },
    },
    { __timestampMs: at(2026, 10, 7, 11), tokens: { input_tokens: 200, cached_tokens: 80 } },
    { __timestampMs: at(2026, 10, 7, 12), tokens: { input_tokens: 50 } },
    { timestamp: 'bad' },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    { i: rows[0].inputTokens, r: rows[0].cacheReadTokens, w: rows[0].cacheWriteTokens },
    { i: 1_000, r: 400, w: 100 }
  );
  assert.equal(rows[1].cacheReadTokens, 80);
  assert.equal(rows[1].cacheWriteTokens, 0);
  assert.equal(rows[2].cacheReadTokens, 0);
});

test('summarizes window cache metrics with guarded ratios', () => {
  const rows = cache.collectCacheAnalysisRows([
    { __timestampMs: 1, tokens: { input_tokens: 1_000, cache_read_tokens: 600 } },
    { __timestampMs: 2, tokens: { input_tokens: 500, cache_read_tokens: 0 } },
    { __timestampMs: 3, tokens: { input_tokens: 500, cache_read_tokens: 500 } },
  ]);
  const summary = cache.summarizeCacheAnalytics(rows);
  assert.equal(summary.requests, 3);
  assert.equal(summary.cachedRequests, 2);
  assert.equal(summary.cacheHitRequestRatio, 2 / 3);
  assert.equal(summary.inputTokens, 2_000);
  assert.equal(summary.cacheReadTokens, 1_100);
  assert.equal(summary.cacheReadRate, 1_100 / 2_000);
  const empty = cache.summarizeCacheAnalytics([]);
  assert.equal(empty.cacheReadRate, null);
  assert.equal(empty.cacheHitRequestRatio, null);
});

test('builds cache rate trend per hour bucket with padding', () => {
  const base = at(2026, 10, 7, 9);
  const rows = cache.collectCacheAnalysisRows([
    { __timestampMs: base + 60_000, tokens: { input_tokens: 100, cache_read_tokens: 50 } },
    { __timestampMs: base + 120_000, tokens: { input_tokens: 100, cache_read_tokens: 50 } },
    { __timestampMs: base + 61 * 60_000, tokens: { input_tokens: 400, cache_read_tokens: 100 } },
  ]);
  const points = cache.buildCacheTrendSeries(rows, 'hour', {
    startMs: base,
    endMs: base + 2 * 3_600_000 - 1,
  });
  assert.equal(points.length, 2);
  assert.deepEqual(
    points.map((point) => point.cacheRate),
    [0.5, 0.25]
  );
  assert.deepEqual(
    points.map((point) => point.requests),
    [2, 1]
  );
  assert.deepEqual(
    points.map((point) => point.cachedRequests),
    [2, 1]
  );
});

test('classifies failure status families', () => {
  assert.equal(error.classifyFailureStatus(429), '429');
  assert.equal(error.classifyFailureStatus(401), '4xx');
  assert.equal(error.classifyFailureStatus(503), '5xx');
  assert.equal(error.classifyFailureStatus(null), 'other');
  assert.equal(error.classifyFailureStatus(302), 'other');
});

test('summarizes errors by status with shares and top reasons', () => {
  const rows = error.collectErrorAnalysisRows([
    { __timestampMs: 1, failed: true, failure_status: 429, failure_reason: 'rate_limited' },
    { __timestampMs: 2, failed: true, failure_status: 429, failure_reason: 'rate_limited' },
    { __timestampMs: 3, failed: true, failure_status: 500, failure_reason: 'upstream_error' },
    { __timestampMs: 4, failed: true, failure_status: 999, failure_reason: 'x' },
    { __timestampMs: 5, failed: true },
    { __timestampMs: 6, failed: false },
    { __timestampMs: 7, failed: false },
  ]);
  const summary = error.summarizeErrorAnalytics(rows);
  assert.equal(summary.totalRequests, 7);
  assert.equal(summary.failedRequests, 5);
  assert.equal(summary.failureRate, 5 / 7);
  assert.equal(summary.byStatus.length, 3);
  assert.equal(summary.byStatus[0].status, 429);
  assert.equal(summary.byStatus[0].count, 2);
  assert.equal(summary.byStatus[0].share, 2 / 5);
  assert.equal(summary.byStatus[2].status, null);
  assert.equal(summary.byStatus[2].count, 2);
  assert.equal(summary.topReasons[0].reason, 'rate_limited');
  assert.equal(summary.topReasons[0].count, 2);
});

test('builds failure rate trend and guards zero-request buckets', () => {
  const base = at(2026, 10, 7, 9);
  const rows = error.collectErrorAnalysisRows([
    { __timestampMs: base + 60_000, failed: true, failure_status: 429 },
    { __timestampMs: base + 120_000, failed: false },
    { __timestampMs: base + 120_000, failed: false },
    { __timestampMs: base + 121 * 60_000, failed: false },
  ]);
  const points = error.buildFailureTrendSeries(rows, 'hour', {
    startMs: base,
    endMs: base + 3 * 3_600_000 - 1,
  });
  assert.equal(points.length, 3);
  assert.deepEqual(
    points.map((point) => point.failureRate),
    [1 / 3, null, 0]
  );
  assert.deepEqual(
    points.map((point) => point.failures),
    [1, 0, 0]
  );
});
