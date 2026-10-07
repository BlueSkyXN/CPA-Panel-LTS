import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [latency, cache, errors] = await Promise.all([
  vite.ssrLoadModule('/src/utils/usage/latencyAnalysis.ts'),
  vite.ssrLoadModule('/src/utils/usage/cacheAnalytics.ts'),
  vite.ssrLoadModule('/src/utils/usage/errorAnalytics.ts'),
]);
test.after(() => vite.close());

const aggregators = [
  { name: 'latency', collect: latency.collectLatencyAnalysisRows, build: latency.buildLatencyPercentileSeries,
    counts: (series) => series.sampleCounts, times: (series) => series.times },
  { name: 'cache', collect: cache.collectCacheAnalysisRows, build: cache.buildCacheTrendSeries,
    counts: (series) => series.map((point) => point.requests), times: (series) => series.map((point) => point.timestampMs) },
  { name: 'errors', collect: errors.collectErrorAnalysisRows, build: errors.buildFailureTrendSeries,
    counts: (series) => series.map((point) => point.requests), times: (series) => series.map((point) => point.timestampMs) },
];
const detail = (timestampMs) => ({ __timestampMs: timestampMs, latency_ms: 1000, failed: false,
  tokens: { input_tokens: 10, cache_read_tokens: 5 } });

for (const aggregate of aggregators) {
  test(`${aggregate.name}: all-history handles 200000 records without spreading arguments`, () => {
    const start = Date.parse('2026-10-07T12:00:00Z');
    const rows = aggregate.collect(Array.from({ length: 200000 }, (_, i) => detail(start + i)));
    const series = aggregate.build(rows, 'day', null);
    assert.equal(aggregate.counts(series).reduce((sum, count) => sum + count, 0), rows.length);
  });

  for (const [name, dates] of [
    ['spring', ['2026-03-07T12:00:00-05:00', '2026-03-08T12:00:00-04:00', '2026-03-09T12:00:00-04:00', '2026-03-10T12:00:00-04:00']],
    ['fall', ['2026-10-31T12:00:00-04:00', '2026-11-01T12:00:00-05:00', '2026-11-02T12:00:00-05:00', '2026-11-03T12:00:00-05:00']],
  ]) {
    test(`${aggregate.name}: local-day buckets preserve all samples across ${name} DST`, () => {
      const oldTZ = process.env.TZ;
      process.env.TZ = 'America/New_York';
      try {
        const rows = aggregate.collect(dates.map((date) => detail(Date.parse(date))));
        const expected = dates.map((date) => { const day = new Date(date); day.setHours(0, 0, 0, 0); return day.getTime(); });
        for (const window of [null, { startMs: expected[0], endMs: Date.parse(dates.at(-1)) }]) {
          const series = aggregate.build(rows, 'day', window);
          assert.deepEqual(aggregate.times(series), expected);
          assert.deepEqual(aggregate.counts(series), [1, 1, 1, 1]);
        }
      } finally {
        if (oldTZ === undefined) delete process.env.TZ;
        else process.env.TZ = oldTZ;
      }
    });
  }

  for (const [timezone, grain, dates, counts] of [
    ['America/Sao_Paulo', 'day', ['2018-11-03T12:00:00-03:00', '2018-11-04T12:00:00-02:00', '2018-11-05T12:00:00-02:00', '2018-11-06T12:00:00-02:00'], [1, 1, 1, 1]],
    ['Australia/Lord_Howe', 'hour', ['2026-10-04T01:15:00+10:30', '2026-10-04T02:40:00+11:00', '2026-10-04T03:20:00+11:00', '2026-10-04T04:20:00+11:00'], [1, 1, 1, 1]],
    ['America/New_York', 'hour', ['2026-11-01T00:30:00-04:00', '2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00', '2026-11-01T02:30:00-05:00'], [1, 2, 1]],
  ]) {
    test(`${aggregate.name}: ${grain} buckets normalize skipped boundaries in ${timezone}`, () => {
      const oldTZ = process.env.TZ;
      process.env.TZ = timezone;
      try {
        const rows = aggregate.collect(dates.map((date) => detail(Date.parse(date))));
        const expected = [...new Set(dates.map((value) => {
          const date = new Date(value);
          if (grain === 'day') date.setHours(0, 0, 0, 0);
          else date.setMinutes(0, 0, 0);
          return date.getTime();
        }))];
        for (const window of [null, { startMs: expected[0], endMs: Date.parse(dates.at(-1)) }]) {
          const series = aggregate.build(rows, grain, window);
          assert.deepEqual(aggregate.times(series), expected);
          assert.deepEqual(aggregate.counts(series), counts);
        }
      } finally {
        if (oldTZ === undefined) delete process.env.TZ;
        else process.env.TZ = oldTZ;
      }
    });
  }

  test(`${aggregate.name}: large sparse windows keep samples without padding every bucket`, () => {
    const start = Date.parse('2000-01-01T12:00:00Z');
    const end = Date.parse('2026-10-07T12:00:00Z');
    const rows = aggregate.collect([detail(start), detail(end)]);
    const series = aggregate.build(rows, 'hour', { startMs: start, endMs: end });
    assert.equal(aggregate.times(series).length, 2);
    assert.deepEqual(aggregate.counts(series), [1, 1]);
  });
}
