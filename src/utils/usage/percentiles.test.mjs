import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./percentiles.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const percentiles = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('returns null for empty or invalid sample sets', () => {
  assert.equal(percentiles.percentileFromSorted([], 50), null);
  assert.equal(percentiles.sortValidSamples([]).length, 0);
  assert.equal(percentiles.percentileFromSorted([100], 0), null);
  assert.equal(percentiles.percentileFromSorted([100], 101), null);
  assert.equal(percentiles.percentileFromSorted([100], Number.NaN), null);
});

test('drops negative and non-finite samples before summarizing', () => {
  const sorted = percentiles.sortValidSamples([-5, 200, Number.NaN, 100, Number.POSITIVE_INFINITY]);
  assert.deepEqual(sorted, [100, 200]);
  const summary = percentiles.summarizeSamples([-1, Number.NaN, 400]);
  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.p50, 400);
  assert.equal(summary.average, 400);
});

test('nearest-rank picks ceil(p/100*n)-1 without interpolation', () => {
  assert.equal(percentiles.percentileFromSorted([10], 95), 10);
  assert.equal(percentiles.percentileFromSorted([10, 20], 50), 10);
  assert.equal(percentiles.percentileFromSorted([10, 20], 51), 20);
  // n=100 时 p95 的 nearest-rank index 是 94，即第 95 个样本。
  const samples = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentiles.percentileFromSorted(samples, 95), 95);
  assert.equal(percentiles.percentileFromSorted(samples, 50), 50);
  assert.equal(percentiles.percentileFromSorted(samples, 99), 99);
  assert.equal(percentiles.percentileFromSorted(samples, 100), 100);
});

test('summarizes percentiles and mean for a representative latency set', () => {
  const summary = percentiles.summarizeSamples([120, 240, 360, 480, 600]);
  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.p50, 360);
  assert.equal(summary.p90, 600);
  assert.equal(summary.p95, 600);
  assert.equal(summary.p99, 600);
  assert.equal(summary.average, 360);
});

test('handles duplicate sample values without skew', () => {
  const summary = percentiles.summarizeSamples([500, 500, 500, 500, 900]);
  assert.equal(summary.p50, 500);
  assert.equal(summary.p95, 900);
  assert.equal(summary.average, 580);
});
