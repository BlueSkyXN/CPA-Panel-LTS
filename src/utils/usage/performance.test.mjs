import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./performance.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const performance = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('extracts optional Core TTFB values without accepting invalid data', () => {
  assert.equal(performance.extractTTFBMs({ ttfb_ms: 125 }), 125);
  assert.equal(performance.extractTTFBMs({ ttfb_ms: 0 }), 0);
  assert.equal(performance.extractTTFBMs({}), null);
  assert.equal(performance.extractTTFBMs({ ttfb_ms: -1 }), null);
  assert.equal(performance.extractTTFBMs({ ttfb_ms: 'not-a-number' }), null);
});

test('extracts semantic timing only from timing version 1 and enforces causal bounds', () => {
  const detail = { timing_version: 1, ttfb_ms: 120, ttft_ms: 480, ttfa_ms: 920 };
  assert.equal(performance.extractTimingVersion(detail), 1);
  assert.equal(performance.extractTTFTMs(detail), 480);
  assert.equal(performance.extractTTFAMs(detail), 920);
  assert.equal(performance.extractTTFTMs({ ttft_ms: 480 }), null);
  // ttfr_ms: canonical reasoning-only latency
  const detailWithReasoning = { timing_version: 1, ttfb_ms: 120, ttft_ms: 480, ttfr_ms: 480, ttfa_ms: 920 };
  assert.equal(performance.extractTTFRMs(detailWithReasoning), 480);
  assert.equal(performance.extractTTFRMs({ ttfr_ms: 480 }), null); // no timing_version
  assert.equal(performance.extractTTFRMs({ timing_version: 1 }), null); // no ttfr_ms
  assert.equal(performance.normalizeSemanticTimingMs(480, 2_000, 120), 480);
  assert.equal(performance.normalizeSemanticTimingMs(100, 2_000, 120), null);
  assert.equal(performance.normalizeSemanticTimingMs(2_100, 2_000, 120), null);
});

test('derives decode and end-to-end TPS from Core latency fields', () => {
  assert.equal(performance.calculateDecodeDurationMs(2_000, 500), 1_500);
  assert.equal(performance.calculateOutputTps(300, 2_000, 500), 200);
  assert.equal(performance.calculateAverageTps(300, 2_000), 150);
  assert.equal(performance.formatPerSecondValue(200), '200');
});

test('fails closed when timing or output data cannot produce a rate', () => {
  assert.equal(performance.calculateDecodeDurationMs(500, 500), null);
  assert.equal(performance.calculateDecodeDurationMs(400, 500), null);
  assert.equal(performance.calculateOutputTps(0, 2_000, 500), null);
  assert.equal(performance.calculateOutputTps(300, 2_000, null), null);
  assert.equal(performance.calculateAverageTps(300, 0), null);
  assert.equal(performance.formatPerSecondValue(null), '--');
});

test('derives visible TPS and reasoning ratio', () => {
  assert.equal(performance.calculateVisibleAverageTps(300, 100, 2_000), 100);
  assert.equal(performance.calculateReasoningRatio(300, 100), 1 / 3);
  assert.equal(performance.calculateVisibleAverageTps(300, 400, 2_000), null);
  assert.equal(performance.calculateReasoningRatio(0, 0), null);
});

test('summarizes filtered rows with weighted durations and independent sample counts', () => {
  const summary = performance.summarizeUsagePerformance([
    { outputTokens: 100, reasoningTokens: 20, latencyMs: 1_000, ttfbMs: 100 },
    { outputTokens: 300, reasoningTokens: 0, latencyMs: 2_000, ttfbMs: 500 },
    { outputTokens: 0, reasoningTokens: 0, latencyMs: 900, ttfbMs: 100 },
  ]);

  assert.equal(summary.totalCount, 3);
  assert.equal(summary.outputTps.sampleCount, 2);
  assert.equal(summary.averageTps.sampleCount, 2);
  assert.equal(summary.visibleAverageTps.sampleCount, 2);
  assert.equal(summary.reasoningRatio.sampleCount, 2);
  assert.equal(summary.outputTps.value, (400 * 1000) / 2_400);
  assert.equal(summary.averageTps.value, (400 * 1000) / 3_000);
  assert.equal(summary.visibleAverageTps.value, (380 * 1000) / 3_000);
  assert.equal(summary.reasoningRatio.value, 20 / 400);
  assert.notEqual(summary.outputTps.value, (100 / 0.9 + 300 / 1.5) / 2);
});
