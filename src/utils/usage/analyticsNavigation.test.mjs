import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { readAnalyticsReturnContext, analyticsReturnState } = await vite.ssrLoadModule('/src/utils/usage/analyticsNavigation.ts');
test.after(async () => { await vite.close(); globalThis.window = originalWindow; });

const connection = JSON.stringify(['synthetic-profile', 'http://synthetic.invalid']);
const context = {
  pathname: '/analytics/observability',
  search: '?range=24h',
  connection,
  filters: {
    model: 'synthetic-model', tier: 'fast_to_std', effort: 'high',
    source: { value: 'auth:1', label: 'Synthetic credential', identities: [{ source: 'synthetic-source', auth_index: '1' }] },
  },
  grain: 'day',
  timeWindow: { startMs: 1000, endMs: 10000 },
  session: { version: 1, bound: 'synthetic-bound', now_ms: 10000, models: ['synthetic-model'], max_page_size: 100, analytics_version: 1 },
  scrollTop: 900,
  focusId: 'analytics-latency-bucket-open',
};

test('explicit return restores the original cohort, snapshot, grain and reading position', () => {
  const original = structuredClone(context);
  const read = readAnalyticsReturnContext(original, connection);
  assert.deepEqual(read, original);
  const state = analyticsReturnState(read);
  assert.deepEqual(state.analyticsFilters, original.filters);
  assert.equal(state.analyticsGrain, 'day');
  assert.equal(state.analyticsRestoreContext.session.bound, 'synthetic-bound');
  assert.equal(state.analyticsRestoreContext.timeWindow.startMs, 1000);
  assert.equal(state.analyticsRestoreContext.scrollTop, 900);
  assert.equal(state.analyticsRestoreContext.focusId, 'analytics-latency-bucket-open');
});

test('event-page edits do not replace the original return filters or window', () => {
  const eventState = { analyticsFilters: { model: 'edited' }, analyticsReturnContext: structuredClone(context) };
  const state = analyticsReturnState(readAnalyticsReturnContext(eventState.analyticsReturnContext, connection));
  assert.equal(state.analyticsFilters.model, 'synthetic-model');
  assert.deepEqual(state.analyticsRestoreContext.timeWindow, context.timeWindow);
});

test('return context never follows external, unrelated or malformed paths', () => {
  for (const patch of [
    { pathname: '//external.invalid' }, { pathname: 'https://external.invalid' },
    { pathname: '/usage' }, { search: 'https://external.invalid' },
    { session: { bound: 'invalid' } }, { filters: { tier: 'not-a-tier' } },
    { grain: 'minute' }, { scrollTop: -1 }, { scrollTop: NaN },
    { timeWindow: { startMs: 10000, endMs: 1000 } },
    { timeWindow: { startMs: 0, endMs: Infinity } },
  ]) assert.equal(readAnalyticsReturnContext({ ...context, ...patch }, connection), null);
});

test('changing connections drops the old snapshot rather than querying the new Core with it', () => {
  assert.equal(readAnalyticsReturnContext(context, 'another-connection'), null);
});

test('legacy and all-history contexts remain supported without a query session', () => {
  assert.deepEqual(readAnalyticsReturnContext({ ...context, session: null, timeWindow: null }, connection), {
    ...context, session: null, timeWindow: null,
  });
});

test('only known drill controls can receive restored focus', () => {
  assert.equal(readAnalyticsReturnContext({ ...context, focusId: 'untrusted-selector' }, connection).focusId, null);
});
