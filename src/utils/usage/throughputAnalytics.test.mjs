import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const throughput = await vite.ssrLoadModule('/src/utils/usage/throughputAnalytics.ts');
test.after(() => vite.close());

test('local trends share legacy and measured sample eligibility with the table and Core', () => {
  const base = { timestamp: '2026-10-13T00:00:00Z', latency_ms: 1_000, ttfb_ms: 200, tokens: { output_tokens: 100, reasoning_tokens: 0 } };
  const result = throughput.buildThroughputTrendSeries([
    base,
    { ...base, output_timing: { version: 1, streamed: true, duration_ms: 200 } },
    { ...base, output_timing: { version: 1, streamed: false } },
    { ...base, output_timing: null },
  ], 'hour');
  assert.equal(result.length, 1);
  assert.equal(result[0].outputSamples, 2);
  assert.equal(result[0].outputTokens, 200);
  assert.equal(result[0].decodeDurationMs, 1_000);
  assert.equal(result[0].averageSamples, 4);
});
