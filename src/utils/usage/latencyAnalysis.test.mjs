import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./latencyAnalysis.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const analysis = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

const at = (year, month, day, hour, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

test('collects rows with ISO fallback timestamps and timing version gate', () => {
  const rows = analysis.collectLatencyAnalysisRows([
    {
      __timestampMs: at(2026, 10, 7, 10, 5),
      latency_ms: 2_000,
      ttfb_ms: 200,
      timing_version: 1,
      ttft_ms: 480,
      ttfa_ms: 920,
      failed: false,
    },
    { timestamp: '2026-10-07T09:30:00Z', latency_ms: 1_500, failed: false },
    { timestamp: 'not-a-timestamp' },
    null,
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].latencyMs, 2_000);
  assert.equal(rows[0].ttftMs, 480);
  assert.equal(rows[0].ttfaMs, 920);
  assert.equal(rows[1].timestampMs, Date.parse('2026-10-07T09:30:00Z'));
  // __timestampMs 优先于 timestamp 字符串。
  const explicitWins = analysis.collectLatencyAnalysisRows([
    { timestamp: '2026-10-07T09:30:00Z', __timestampMs: at(2026, 10, 7, 12, 0) },
  ]);
  assert.equal(explicitWins[0].timestampMs, at(2026, 10, 7, 12, 0));
});

test('rejects semantic timings outside version contract or causal bounds', () => {
  const rows = analysis.collectLatencyAnalysisRows([
    { __timestampMs: 1, latency_ms: 2_000, ttfb_ms: 200, ttft_ms: 480 },
    { __timestampMs: 2, latency_ms: 2_000, ttfb_ms: 200, timing_version: 2, ttft_ms: 480 },
    { __timestampMs: 3, latency_ms: 2_000, ttfb_ms: 200, timing_version: 1, ttft_ms: 100 },
    { __timestampMs: 4, latency_ms: 2_000, ttfb_ms: 200, timing_version: 1, ttft_ms: 2_500 },
    { __timestampMs: 5, latency_ms: -3, failed: true },
  ]);
  assert.equal(rows[0].ttftMs, null);
  assert.equal(rows[1].ttftMs, null);
  assert.equal(rows[2].ttftMs, null);
  assert.equal(rows[3].ttftMs, null);
  assert.equal(rows[4].latencyMs, null);
  assert.equal(rows[4].failed, true);
});

test('builds histogram with half-open log buckets from success samples only', () => {
  const rows = analysis.collectLatencyAnalysisRows([
    { __timestampMs: 1, latency_ms: 99, failed: false },
    { __timestampMs: 2, latency_ms: 100, failed: false },
    { __timestampMs: 3, latency_ms: 249, failed: false },
    { __timestampMs: 4, latency_ms: 250, failed: false },
    { __timestampMs: 5, latency_ms: 4_000, failed: false },
    { __timestampMs: 6, latency_ms: 20_000, failed: false },
    { __timestampMs: 7, latency_ms: 500, failed: true },
    { __timestampMs: 8, failed: false },
  ]);
  const histogram = analysis.buildLatencyHistogram(rows);
  assert.equal(histogram.counts.length, analysis.LATENCY_HISTOGRAM_EDGE_MS.length);
  assert.deepEqual(histogram.counts, [1, 2, 1, 0, 0, 1, 0, 1]);
  assert.equal(histogram.sampleCount, 6);
});

test('builds hourly percentile series with padded empty buckets and window filter', () => {
  const base = at(2026, 10, 7, 9);
  const rows = analysis.collectLatencyAnalysisRows([
    { __timestampMs: base + 5 * 60_000, latency_ms: 100, failed: false },
    { __timestampMs: base + 6 * 60_000, latency_ms: 300, failed: false },
    { __timestampMs: base + 7 * 60_000, latency_ms: 500, failed: false },
    { __timestampMs: base + 61 * 60_000, latency_ms: 5_000, failed: false },
    { __timestampMs: base + 9 * 60_000, latency_ms: 900, failed: true },
    { __timestampMs: base - 60 * 60_000, latency_ms: 777, failed: false },
  ]);
  const series = analysis.buildLatencyPercentileSeries(rows, 'hour', {
    startMs: base,
    endMs: base + 2 * 3_600_000 - 1,
  });
  assert.equal(series.times.length, 2);
  assert.equal(series.times[0], base);
  assert.deepEqual(series.sampleCounts, [3, 1]);
  assert.equal(series.p50[0], 300);
  assert.equal(series.p95[0], 500);
  assert.equal(series.p99[0], 500);
  assert.equal(series.average[0], 300);
  assert.equal(series.p50[1], 5_000);
  assert.equal(series.average[1], 5_000);
  // 无样本的桶保持 null。
  const single = analysis.buildLatencyPercentileSeries(
    analysis.collectLatencyAnalysisRows([{ __timestampMs: base, latency_ms: 120 }]),
    'hour',
    { startMs: base, endMs: base + 2 * 3_600_000 - 1 }
  );
  assert.equal(single.times.length, 2);
  assert.equal(single.p50[1], null);
  assert.equal(single.sampleCounts[1], 0);
});

test('buckets daily grain by local-day floor and derives window when omitted', () => {
  const rows = analysis.collectLatencyAnalysisRows([
    { __timestampMs: at(2026, 10, 6, 23, 59), latency_ms: 100, failed: false },
    { __timestampMs: at(2026, 10, 7, 0, 1), latency_ms: 200, failed: false },
    { __timestampMs: at(2026, 10, 7, 18, 30), latency_ms: 300, failed: false },
  ]);
  const series = analysis.buildLatencyPercentileSeries(rows, 'day');
  assert.equal(series.times.length, 2);
  assert.deepEqual(series.sampleCounts, [1, 2]);
  assert.equal(series.p50[1], 200);
});

test('summarizes window percentiles over success rows with first-content semantics', () => {
  const rows = analysis.collectLatencyAnalysisRows([
    { __timestampMs: 1, latency_ms: 1_000, ttfb_ms: 100, timing_version: 1, ttft_ms: 300, failed: false },
    { __timestampMs: 2, latency_ms: 2_000, ttfb_ms: 100, timing_version: 1, ttft_ms: 600, ttfa_ms: 900, failed: false },
    { __timestampMs: 3, latency_ms: 1_000, ttfb_ms: 40, timing_version: 1, ttft_ms: 50, failed: false },
    { __timestampMs: 4, latency_ms: 9_999, failed: true },
  ]);
  const summaries = analysis.summarizeLatencyRows(rows);
  assert.equal(summaries.latency.sampleCount, 3);
  assert.equal(summaries.latency.p50, 1_000);
  assert.equal(summaries.latency.p95, 2_000);
  assert.equal(summaries.ttft.sampleCount, 3);
  assert.equal(summaries.ttft.p50, 300);
  assert.equal(summaries.ttfa.sampleCount, 1);
  assert.equal(summaries.ttfa.p50, 900);
  assert.equal(summaries.firstContent.sampleCount, 3);
  assert.equal(summaries.firstContent.p50, 300);
  assert.equal(summaries.firstContent.p95, 600);
});
