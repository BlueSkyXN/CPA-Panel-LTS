import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { bucketRangeAt } = await vite.ssrLoadModule('/src/components/usage/analyticsBucketDrill.ts');
test.after(() => vite.close());

const hour = (label) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date;
};

test('adjacent hour buckets end one millisecond before the next bucket start', () => {
  const base = hour();
  base.setMinutes(0, 0, 0);
  const t0 = base.getTime();
  const times = [t0, t0 + 3600000, t0 + 2 * 3600000];
  const first = bucketRangeAt(times, 0, 'hour');
  const second = bucketRangeAt(times, 1, 'hour');
  assert.ok(first);
  assert.ok(second);
  // 桶语义 [start, 下一桶起点)，Core 的 from_ms/to_ms 两端均含：
  // 终点收回 1ms，整点记录不会同时落进相邻两桶。
  assert.equal(first.endMs, t0 + 3600000 - 1);
  assert.equal(second.startMs, t0 + 3600000);
  assert.equal(second.endMs, t0 + 2 * 3600000 - 1);
});

test('truncated series falls back to local grain advance', () => {
  const base = hour();
  base.setMinutes(0, 0, 0);
  const t0 = base.getTime();
  const only = bucketRangeAt([t0], 0, 'hour');
  assert.ok(only);
  assert.equal(only.startMs, t0);
  assert.equal(only.endMs, t0 + 3600000 - 1);
});

test('day buckets stay gap-free across midnight without overlap', () => {
  const day0 = new Date();
  day0.setHours(0, 0, 0, 0);
  const t0 = day0.getTime();
  const times = [t0, t0 + 24 * 3600000];
  const first = bucketRangeAt(times, 0, 'day');
  assert.ok(first);
  assert.equal(first.endMs, t0 + 24 * 3600000 - 1);
});

test('window end clamps the last bucket so drill-down matches the visible window', () => {
  const base = hour();
  base.setMinutes(0, 0, 0);
  const t0 = base.getTime();
  // 窗口止于第二小时中间：第二桶下钻终点收敛到窗口终点，第一桶保持自然边界。
  const windowEnd = t0 + 90 * 60 * 1000;
  const times = [t0, t0 + 3600000, t0 + 2 * 3600000];
  const first = bucketRangeAt(times, 0, 'hour', { startMs: t0, endMs: windowEnd });
  assert.ok(first);
  assert.equal(first.endMs, t0 + 3600000 - 1);
  const last = bucketRangeAt(times, 1, 'hour', { startMs: t0, endMs: windowEnd });
  assert.ok(last);
  assert.equal(last.endMs, windowEnd);
});

test('bucket entirely beyond the window returns null', () => {
  const base = hour();
  base.setMinutes(0, 0, 0);
  const t0 = base.getTime();
  assert.equal(bucketRangeAt([t0, t0 + 3600000], 1, 'hour', { startMs: t0, endMs: t0 + 1000 }), null);
});

test('invalid indexes return null', () => {
  const base = hour();
  base.setMinutes(0, 0, 0);
  const times = [base.getTime(), base.getTime() + 3600000];
  assert.equal(bucketRangeAt(times, -1, 'hour'), null);
  assert.equal(bucketRangeAt(times, 99, 'hour'), null);
  assert.equal(bucketRangeAt([], 0, 'hour'), null);
});

for (const [name, dates] of [
  ['spring', ['2026-03-07T12:00:00-05:00', '2026-03-08T12:00:00-04:00', '2026-03-09T12:00:00-04:00']],
  ['fall', ['2026-10-31T12:00:00-04:00', '2026-11-01T12:00:00-05:00', '2026-11-02T12:00:00-05:00']],
]) {
  test(`local-day drill ranges cover every local millisecond exactly once across ${name} DST`, () => {
    const oldTZ = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const starts = dates.map((date) => {
        const day = new Date(date);
        day.setHours(0, 0, 0, 0);
        return day.getTime();
      });
      for (let i = 0; i < starts.length - 1; i += 1) {
        const range = bucketRangeAt(starts, i, 'day');
        assert.ok(range);
        assert.equal(range.startMs, starts[i]);
        // 无缝且不重叠：本桶终点 +1ms 即下一桶起点。
        assert.equal(range.endMs + 1, starts[i + 1]);
      }
    } finally {
      if (oldTZ === undefined) delete process.env.TZ;
      else process.env.TZ = oldTZ;
    }
  });
}

test('first partial bucket excludes records before the visible window', () => {
  const start = Date.parse('2026-10-17T01:00:00Z');
  assert.deepEqual(bucketRangeAt([start, start + 3600000], 0, 'hour', {
    startMs: start + 1800000, endMs: start + 5400000,
  }), { startMs: start + 1800000, endMs: start + 3599999 });
});

test('sparse observed series does not absorb missing empty buckets', () => {
  const start = Date.parse('2026-10-17T01:00:00Z');
  assert.deepEqual(bucketRangeAt([start, start + 3 * 3600000], 0, 'hour'), {
    startMs: start, endMs: start + 3599999,
  });
});

test('a one-millisecond intersection is valid and disjoint or invalid windows are rejected', () => {
  const start = Date.parse('2026-10-17T01:00:00Z');
  assert.deepEqual(bucketRangeAt([start], 0, 'hour', { startMs: start, endMs: start }), {
    startMs: start, endMs: start,
  });
  assert.equal(bucketRangeAt([start], 0, 'hour', { startMs: start + 3600000, endMs: start + 7200000 }), null);
  assert.equal(bucketRangeAt([start], 0, 'hour', { startMs: start + 1, endMs: start }), null);
  assert.equal(bucketRangeAt([start], 0.5, 'hour'), null);
});
