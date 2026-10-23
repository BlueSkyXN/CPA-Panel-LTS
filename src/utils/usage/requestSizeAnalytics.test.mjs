import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
test.after(() => vite.close());
const { buildRequestSizeDistribution, isRequestSizeDistribution, REQUEST_SIZE_EDGES } = await vite.ssrLoadModule(
  '/src/utils/usage/requestSizeAnalytics.ts'
);
const { buildUsageAnalytics } = await vite.ssrLoadModule('/src/utils/usage/analyticsModel.ts');
const { decodeUsageAnalytics } = await vite.ssrLoadModule('/src/services/api/usageAnalytics.ts');

const row = (overrides) => ({ timestamp: '2026-10-11T13:15:30Z', failed: false, size_version: 1, ...overrides });

test('buckets like Core: payload first, wire fallback, unmeasured rows counted separately', () => {
  const d = buildRequestSizeDistribution([
    row({ upstream_request_bytes: 272, upstream_request_wire_bytes: 204, upstream_transport: 'http' }),
    row({ upstream_request_wire_bytes: 70 * 1024, upstream_transport: 'http', failed: true }),
    row({ upstream_request_bytes: 1_080_631, upstream_transport: 'websocket' }),
    row({ upstream_request_bytes: 1_080_631, upstream_transport: 'websocket', failed: true }),
    row({ upstream_request_bytes: 5 * 1024 * 1024 }),
    { timestamp: '2026-10-11T13:15:30Z', failed: true },
    row({ size_version: 2, upstream_request_bytes: 10 }),
  ]);
  assert.deepEqual(d.edges, [...REQUEST_SIZE_EDGES]);
  assert.deepEqual(d.requests, [1, 1, 0, 0, 0, 2, 1]);
  assert.deepEqual(d.failures, [0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(d.websocketRequests, [0, 0, 0, 0, 0, 2, 0]);
  assert.deepEqual(d.websocketFailures, [0, 0, 0, 0, 0, 1, 0]);
  assert.equal(d.sampleCount, 5);
  assert.equal(d.unmeasured, 2);
  assert.equal(isRequestSizeDistribution(d), true);
});

test('analytics omit requestSize without measurements and include it with them', () => {
  assert.equal(buildRequestSizeDistribution([{ failed: false }]), null);
  assert.equal('requestSize' in buildUsageAnalytics([{ timestamp: '2026-10-11T13:15:30Z', failed: false }], null), false);
  const data = buildUsageAnalytics([row({ upstream_request_bytes: 1_080_631, upstream_transport: 'websocket' })], null);
  assert.equal(data.requestSize.sampleCount, 1);
});

test('decoder accepts Core requestSize, tolerates its absence and rejects inconsistent counts', () => {
  const base = decodeUsageAnalytics({
    version: 1, analytics_version: 1, bound: 'b', now_ms: 1, from_ms: null, to_ms: null, timezone: 'UTC',
    total: 0, analyzed: 0, data: buildUsageAnalytics([], null),
  });
  assert.equal(base.data.requestSize, undefined);
  const withSize = (requestSize) => ({
    version: 1, analytics_version: 1, bound: 'b', now_ms: 1, from_ms: null, to_ms: null, timezone: 'UTC',
    total: 0, analyzed: 0, data: { ...buildUsageAnalytics([], null), requestSize },
  });
  const core = {
    edges: [0, 65536, 262144, 524288, 786432, 1048576, 2097152],
    requests: [5, 0, 0, 0, 0, 1, 0],
    failures: [1, 0, 0, 0, 0, 0, 0],
    websocketRequests: [0, 0, 0, 0, 0, 1, 0],
    websocketFailures: [0, 0, 0, 0, 0, 0, 0],
    sampleCount: 6,
    unmeasured: 1318,
  };
  assert.deepEqual(decodeUsageAnalytics(withSize(core)).data.requestSize, core);
  for (const broken of [
    { ...core, sampleCount: 7 },
    { ...core, failures: [6, 0, 0, 0, 0, 0, 0] },
    { ...core, websocketRequests: [0, 0, 0, 0, 0, 1] },
    { ...core, edges: [1, 2, 3, 4, 5, 6, 7] },
    { ...core, websocketFailures: [0, 0, 0, 0, 0, 1, 0] },
    null,
  ]) {
    assert.throws(() => decodeUsageAnalytics(withSize(broken)), /Invalid usage analytics response/);
  }
});
