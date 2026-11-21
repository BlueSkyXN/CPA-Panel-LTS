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
      const result = buildUsageAnalytics(f.rows, f.from_ms === undefined ? null : { startMs: f.from_ms, endMs: f.to_ms });
      delete result.cache.observed;
      for (const p of [...result.hour.cache, ...result.day.cache]) delete p.observed;
      assert.deepEqual(result, f.expected, f.name);
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

test('effort directories are optional for older Core and validated when present', () => {
  const r = response();
  assert.doesNotThrow(() => decodeUsageAnalytics(r));
  r.options.efforts = ['', 'high', 'custom:42'];
  assert.deepEqual(decodeUsageAnalytics(r).options.efforts, r.options.efforts);
  for (const efforts of [null, ['high', 1], 'high']) {
    r.options.efforts = efforts;
    assert.throws(() => decodeUsageAnalytics(r));
  }
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

test('analytics requests use the LTS scope on a V8 connection', async () => {
  const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
  const adapter = apiClient.instance.defaults.adapter;
  apiClient.setConfig({ apiBase: 'https://core.invalid', managementKey: 'synthetic' });
  try {
    apiClient.instance.defaults.adapter = async (config) => {
      assert.equal(config.baseURL, 'https://core.invalid/v0/management');
      assert.equal(config.url, '/usage/query/analytics');
      return { status: 200, statusText: 'OK', config, headers: {}, data: response() };
    };
    const result = await originalQuery(request);
    assert.equal(result.analytics_version, 1);
  } finally {
    apiClient.instance.defaults.adapter = adapter;
    apiClient.clearConfig();
  }
});

test('observed cache ratio retains explicit zero, excludes unknown and agrees across grains', () => {
  const rows = [7680, 7680, 6656, 4096, 0, null].map((value, index) => ({
    timestamp: new Date(Date.UTC(2026, 10, 20, 7 + index, 15)).toISOString(),
    latency_ms: 120, failed: false,
    tokens: { input_tokens: 8192, cache_read_tokens: value ?? 0 },
    cache_observation: {
      version: 1,
      read: value === null ? { state: 'absent' } : { state: 'present', value },
      write: { state: 'present', value: 0 },
    },
  }));
  const data = buildUsageAnalytics(rows, null);
  assert.equal(data.cache.cacheReadRate, .53125);
  assert.deepEqual(data.cache.observed, {
    read: { positive: 4, zero: 1, unknown: 1 },
    write: { positive: 0, zero: 6, unknown: 0 },
    readTokens: 26112, inputTokens: 40960, rate: .6375,
  });
  assert.equal(data.hour.cache[4].observed.rate, 0);
  assert.equal(data.hour.cache[5].observed.rate, null);
  assert.equal(data.hour.cache[5].observed.read.unknown, 1);
  assert.doesNotThrow(() => decodeUsageAnalytics({ ...response(), data, total: 6, analyzed: 6 }));
  data.cache.observed.read.unknown = 0;
  assert.throws(() => decodeUsageAnalytics({ ...response(), data, total: 6, analyzed: 6 }));
});

test('all-time observed totals retain undated requests outside the series', () => {
  const data = buildUsageAnalytics([
    {timestamp: '2026-11-20T07:15:00Z', latency_ms: 1, failed: false, tokens: {input_tokens: 39}},
    {timestamp: 'invalid', latency_ms: 1, failed: false, tokens: {input_tokens: 10}},
  ], null);
  assert.equal(data.cache.requests, 1);
  assert.equal(data.cache.observed.read.unknown, 2);
  assert.equal(data.hour.cache[0].observed.read.unknown, 1);
  assert.doesNotThrow(() => decodeUsageAnalytics({ ...response(), data, total: 2, analyzed: 1 }));
});
