import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createServer } from 'vite';
const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ decodeUsageAnalytics, usageAnalyticsApi }, cache, { useAuthStore }, { buildUsageAnalytics }] = await Promise.all([
  vite.ssrLoadModule('/src/services/api/usageAnalytics.ts'), vite.ssrLoadModule('/src/stores/usageAnalyticsCache.ts'),
  vite.ssrLoadModule('/src/stores/useAuthStore.ts'), vite.ssrLoadModule('/src/utils/usage/analyticsModel.ts'),
]);
const fixtures = JSON.parse(await readFile(new URL('../../utils/usage/fixtures/analytics-v1.json', import.meta.url), 'utf8'));
const originalQuery = usageAnalyticsApi.query;
const request = { bound: 'synthetic', now_ms: 1000, timezone: 'UTC', include_options: true, filter: {} };
const response = (q = request) => ({ version: 1, analytics_version: 1, bound: q.bound, now_ms: q.now_ms, timezone: q.timezone, from_ms: q.from_ms ?? null, to_ms: q.to_ms ?? null, total: 0, analyzed: 0, data: buildUsageAnalytics([], null), options: { models: [], identities: [] } });
test.after(async () => { cache.clearUsageAnalyticsCache(); usageAnalyticsApi.query = originalQuery; await vite.close(); globalThis.window = originalWindow; });
test.beforeEach(() => cache.clearUsageAnalyticsCache());

test('shared fixtures preserve all chart values and decode successfully', () => {
  const old = process.env.TZ;
  try {
    for (const f of fixtures) {
      process.env.TZ = f.timezone;
      assert.deepEqual(buildUsageAnalytics(f.rows, f.from_ms === undefined ? null : { startMs: f.from_ms, endMs: f.to_ms }), f.expected, f.name);
      assert.doesNotThrow(() => decodeUsageAnalytics({ ...response(), data: f.expected, total: f.rows.length, analyzed: f.expected.cache.requests }));
    }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
test('cores without a throughput series degrade to an empty series', () => {
  const payload = response();
  delete payload.data.hour.throughput;
  delete payload.data.day.throughput;
  const decoded = decodeUsageAnalytics(payload);
  assert.deepEqual(decoded.data.hour.throughput, []);
  assert.deepEqual(decoded.data.day.throughput, []);
  payload.data.hour.throughput = [{ timestampMs: 1 }];
  assert.throws(() => decodeUsageAnalytics(payload));
});
test('invalid aggregate schemas are rejected instead of entering fallback', () => {
  for (const mutate of [r => { r.analytics_version = 2; }, r => { r.bound = ''; }, r => { r.data.hour.latency.p95 = [1]; }, r => { r.data.timings.latency.p50 = -1; }, r => { r.data.histogram.counts = []; }, r => { r.analyzed = 2; }, r => { r.data.cache.cacheReadRate = NaN; }]) {
    const r = response(); mutate(r); assert.throws(() => decodeUsageAnalytics(r));
  }
});
test('concurrent subscribers and page remounts reuse a single completed result', async () => {
  let resolve; let calls = 0;
  usageAnalyticsApi.query = (q) => { calls++; return new Promise(done => { resolve = () => done(response(q)); }); };
  const a = cache.acquireUsageAnalytics(request), b = cache.acquireUsageAnalytics(request);
  assert.equal(calls, 1); a.release(); resolve(); await b.promise; b.release();
  const c = cache.acquireUsageAnalytics(request); await c.promise; c.release();
  assert.equal(calls, 1); assert.ok(cache.peekAnalyticsOptions(request));
});
test('last observer cancellation and connection changes discard late results', async () => {
  let resolve; let signal;
  usageAnalyticsApi.query = (q, s) => { signal = s; return new Promise(done => { resolve = () => done(response(q)); }); };
  const a = cache.acquireUsageAnalytics(request); a.release(); assert.equal(signal.aborted, true); resolve(); await assert.rejects(a.promise);
  const b = cache.acquireUsageAnalytics(request);
  useAuthStore.setState({ apiBase: 'https://other-synthetic.invalid' });
  assert.equal(signal.aborted, true); resolve(); await assert.rejects(b.promise);
  assert.equal(cache.peekUsageAnalytics(cache.analyticsCacheKey(request)), null);
});
test('bounded cache evicts oldest results and expires them', async () => {
  usageAnalyticsApi.query = async (q) => response(q);
  for (let i = 0; i < 9; i++) { const a = cache.acquireUsageAnalytics({ ...request, bound: String(i) }); await a.promise; a.release(); }
  assert.equal(cache.peekUsageAnalytics(cache.analyticsCacheKey({ ...request, bound: '0' })), null);
  const originalNow = Date.now;
  try { const now = Date.now(); Date.now = () => now + 240001; assert.equal(cache.peekUsageAnalytics(cache.analyticsCacheKey({ ...request, bound: '8' })), null); }
  finally { Date.now = originalNow; }
});
test('errors and mismatched snapshots never populate result cache', async () => {
  for (const query of [async () => { throw new Error('synthetic failure'); }, async () => ({ ...response(), bound: 'wrong' })]) {
    usageAnalyticsApi.query = query; const a = cache.acquireUsageAnalytics(request); await assert.rejects(a.promise); a.release();
    assert.equal(cache.peekUsageAnalytics(cache.analyticsCacheKey(request)), null);
  }
});
