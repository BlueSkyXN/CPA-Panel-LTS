import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const filters = await vite.ssrLoadModule('/src/utils/usage/analyticsFilters.ts');
const { buildSourceInfoMap } = await vite.ssrLoadModule('/src/utils/sourceResolver.ts');
const { collectUsageDetails } = await vite.ssrLoadModule('/src/utils/usage.ts');
test.after(async () => { await vite.close(); globalThis.window = originalWindow; });

const identityA = { source: 'synthetic-source-a', auth_index: '1' };
const identityB = { source: 'synthetic-source-b', auth_index: '2' };
const options = { models: ['model-a', 'model-b'], identities: [identityA, identityB] };
const sourceInfo = buildSourceInfoMap({});
const sources = filters.buildAnalyticsSources(options.identities, sourceInfo, new Map());

test('sources preserve exact identities and server filters combine model with source', () => {
  const selected = { model: 'model-a', source: sources[0] };
  assert.deepEqual(filters.analyticsQueryFilter(selected, options), {
    filter: { model: 'model-a', identities: [identityA] }, empty: false,
  });
  assert.equal(filters.analyticsQueryFilter(selected, { ...options, identities: [identityB] }).empty, true);
  assert.equal(filters.analyticsQueryFilter(selected, { ...options, models: [] }).filter.model, 'model-a');
});

test('same-label credentials remain distinct and provider identities are grouped', () => {
  const named = filters.buildAnalyticsSources(options.identities, sourceInfo, new Map([
    ['1', { name: 'Same name', type: 'codex' }], ['2', { name: 'Same name', type: 'codex' }],
  ]));
  assert.equal(new Set(named.map((entry) => entry.value)).size, 2);
  assert.equal(new Set(named.map((entry) => entry.label)).size, 2);
  const providerMap = buildSourceInfoMap({ openaiCompatibility: [{ name: 'Provider', apiKeyEntries: [{ authIndex: '1' }, { authIndex: '2' }] }] });
  const grouped = filters.buildAnalyticsSources(options.identities, providerMap, new Map());
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].identities.length, 2);
  assert.deepEqual(filters.analyticsQueryFilter({ source: grouped[0] }, options).filter.identities, options.identities);
});

test('legacy selection matches the same model/source pair as server queries', () => {
  const detail = (id) => ({ ...id, timestamp: '2026-10-08T00:00:00Z', tokens: {}, failed: false });
  const usage = { apis: { app: { models: {
    'model-a': { details: [detail(identityA), detail(identityB)] },
    'model-b': { details: [detail(identityA)] },
  } } } };
  assert.deepEqual(filters.legacyAnalyticsOptions(usage), options);
  const selected = { model: 'model-a', source: sources[0] };
  const matches = collectUsageDetails(usage).filter((item) => filters.matchesAnalyticsFilters(item, selected));
  assert.equal(matches.length, 1);
  assert.equal(matches[0].auth_index, '1');
});

test('navigation state contains normalized identities rather than raw credential keys', () => {
  const secret = 'sk-synthetic-not-a-real-secret-1234567890';
  const selected = filters.buildAnalyticsSources([{ source: secret, auth_index: '1' }], sourceInfo, new Map())[0];
  assert.ok(!JSON.stringify(selected).includes(secret));
  assert.deepEqual(filters.readAnalyticsNavigationState({ analyticsFilters: { source: selected } }), { source: selected });
  for (const state of [null, {}, { analyticsFilters: { model: 1 } }, { analyticsFilters: { source: { value: 'a', label: 'b', identities: [] } } }]) {
    assert.equal(filters.readAnalyticsNavigationState(state), null);
  }
  assert.deepEqual(filters.readAnalyticsNavigationState({ analyticsFilters: {} }), {});
});
