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
