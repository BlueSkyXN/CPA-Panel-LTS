import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const accounting = await vite.ssrLoadModule('/src/utils/usage/tokenAccounting.ts');
const performance = await vite.ssrLoadModule('/src/utils/usage/performance.ts');
const usage = await vite.ssrLoadModule('/src/utils/usage.ts');
const throughput = await vite.ssrLoadModule('/src/utils/usage/throughputAnalytics.ts');
test.after(() => vite.close());
const breakdown = {
  schema_version: 2,
  quality: 'complete',
  total_tokens: 150,
  unclassified_tokens: 0,
  input: { total_tokens: 10, uncached_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0 },
  output: { total_tokens: 140, non_reasoning_tokens: 100, reasoning_tokens: 40 },
};

test('Gemini separate reasoning and OpenAI subset produce the same rate numerators', () => {
  for (const output_tokens of [100, 140]) {
    const raw = { input_tokens: 10, output_tokens, reasoning_tokens: 40, total_tokens: 150 };
    const tokens = accounting.resolvePerformanceTokens(raw, breakdown);
    assert.deepEqual(tokens, { outputTokens: 140, reasoningTokens: 40, nonReasoningTokens: 100 });
    assert.equal(performance.calculateAverageTps(tokens.outputTokens, 1000), 140);
    assert.equal(
      performance.calculateVisibleAverageTps(tokens.outputTokens, tokens.reasoningTokens, 1000),
      100
    );
    assert.equal(
      performance.calculateReasoningRatio(tokens.outputTokens, tokens.reasoningTokens),
      40 / 140
    );
    assert.equal(raw.output_tokens, output_tokens);
  }
});

test('unclassified, malformed, or inconsistent metadata cannot fall back to a subset guess', () => {
  const raw = { output_tokens: 100, reasoning_tokens: 40, total_tokens: 150 };
  for (const b of [
    null,
    {},
    { ...breakdown, schema_version: 1 },
    { ...breakdown, quality: 'unclassified' },
    { ...breakdown, output: { ...breakdown.output, total_tokens: 141 } },
    { ...breakdown, total_tokens: 151 },
  ]) {
    assert.equal(accounting.resolvePerformanceTokens(raw, b).outputTokens, null);
  }
  assert.deepEqual(accounting.resolvePerformanceTokens(raw), {
    outputTokens: 100,
    reasoningTokens: 40,
    nonReasoningTokens: 60,
  });
});

test('snapshot detail parsing retains optional accounting without rewriting raw counters', () => {
  const result = usage.collectUsageDetails({
    apis: {
      test: {
        models: {
          gemini: {
            details: [
              {
                timestamp: '2026-10-13T00:00:00Z',
                tokens: {
                  input_tokens: 10,
                  output_tokens: 100,
                  reasoning_tokens: 40,
                  total_tokens: 150,
                },
                token_breakdown: breakdown,
              },
            ],
          },
        },
      },
    },
  });
  assert.equal(result[0].tokens.output_tokens, 100);
  assert.deepEqual(result[0].token_breakdown, breakdown);
});

test('accounting and timing keep table summaries and local trend samples aligned', () => {
  const base = {
    timestamp: '2026-10-13T00:00:00Z',
    latency_ms: 1000,
    ttfb_ms: 100,
    output_timing: { version: 1, streamed: true, duration_ms: 500 },
  };
  const details = [100, 140].map((output_tokens) => ({
    ...base,
    tokens: { input_tokens: 10, output_tokens, reasoning_tokens: 40, total_tokens: 150 },
    token_breakdown: breakdown,
  }));
  details.push({ ...details[0], token_breakdown: { ...breakdown, quality: 'unclassified' } });
  const summary = performance.summarizeUsagePerformance(
    details.map((d) => ({
      ...accounting.resolvePerformanceTokens(d.tokens, d.token_breakdown),
      latencyMs: d.latency_ms,
      ttfbMs: d.ttfb_ms,
      outputTiming: d.output_timing,
    }))
  );
  assert.equal(summary.totalCount, 3);
  assert.deepEqual(summary.outputTps, { value: 280, sampleCount: 2 });
  assert.deepEqual(summary.averageTps, { value: 140, sampleCount: 2 });
  assert.deepEqual(summary.visibleAverageTps, { value: 100, sampleCount: 2 });
  assert.deepEqual(summary.reasoningRatio, { value: 40 / 140, sampleCount: 2 });
  const [trend] = throughput.buildThroughputTrendSeries(details, 'hour');
  assert.equal(trend.outputTokens, 280);
  assert.equal(trend.decodeDurationMs, 1000);
  assert.equal(trend.outputSamples, 2);
  assert.equal(trend.visibleTokens, 200);
  assert.equal(trend.reasoningDenominator, 280);
});

test('contradictory input or cache buckets cannot claim complete accounting', () => {
  const raw = { input_tokens: 10, output_tokens: 100, reasoning_tokens: 40, total_tokens: 150 };
  for (const tokens of [
    { ...raw, input_tokens: 20 },
    { ...raw, cache_read_tokens: 1 },
    { ...raw, cache_creation_tokens: 1 },
  ]) {
    assert.equal(accounting.resolvePerformanceTokens(tokens, breakdown).outputTokens, null);
  }
});
