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
const options = { models: ['model-a', 'model-b'], identities: [identityA, identityB], efforts: [''] };
const sourceInfo = buildSourceInfoMap({});
const sources = filters.buildAnalyticsSources(options.identities, sourceInfo, new Map());

test('server filters combine tier and model with exact source identities', () => {
  const selected = { model: 'model-a', source: sources[0], tier: 'fast' };
  assert.deepEqual(filters.analyticsQueryFilter(selected, options), {
    filter: { model: 'model-a', tier_flow: 'fast', identities: [identityA] }, empty: false,
  });
  assert.equal(filters.analyticsQueryFilter(selected, { ...options, identities: [identityB] }).empty, true);
  assert.equal(filters.analyticsQueryFilter(selected, { ...options, models: [] }).filter.model, 'model-a');
});

test('tier filtering works before metadata and clearing removes the constraint', () => {
  for (const tier of ['fast', 'std', 'fast_to_std', 'std_to_fast']) {
    assert.deepEqual(filters.analyticsQueryFilter({ tier }), { filter: { tier_flow: tier }, empty: false });
  }
  assert.deepEqual(filters.analyticsQueryFilter({ tier: undefined }), { filter: {}, empty: false });
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

test('legacy tier filtering respects effective, response and outbound evidence before request intent', () => {
  const records = [
    { effective_service_tier: 'priority', response_service_tier: 'default' },
    { request_service_tier: 'priority', response_service_tier: 'default' },
    { request_service_tier: 'priority', outbound_service_tier: 'standard' },
    { service_tier: 'fast' },
    { effective_service_tier: 'future-tier', request_service_tier: 'priority' },
    {},
  ];
  const usage = { apis: { app: { models: {
    'model-a': { details: records.map((record) => ({
      ...identityA, timestamp: '2026-10-08T00:00:00Z', tokens: {}, failed: false, ...record,
    })) },
  } } } };
  const details = collectUsageDetails(usage);
  const selected = { model: 'model-a', source: sources[0] };
  const matching = (tier) => details.filter((detail) => filters.matchesAnalyticsFilters(detail, { ...selected, tier }));
  assert.deepEqual(matching('fast'), [details[0], details[3]]);
  assert.deepEqual(matching('std'), [details[5]]);
  assert.deepEqual(matching('fast_to_std'), [details[1], details[2], details[4]]);
  assert.deepEqual(matching('std_to_fast'), []);
  assert.equal(matching(undefined).length, records.length);
  assert.equal(filters.matchesAnalyticsFilters(details[0], { model: 'model-b', tier: 'fast' }), false);
  assert.equal(filters.matchesAnalyticsFilters(details[0], { source: sources[1], tier: 'fast' }), false);
});

test('navigation state preserves only supported service tiers', () => {
  for (const tier of ['fast', 'std', 'fast_to_std', 'std_to_fast']) {
    const selected = { model: 'model-a', source: sources[0], tier };
    assert.deepEqual(filters.readAnalyticsNavigationState({ analyticsFilters: selected }), selected);
  }
  for (const tier of ['priority', 'unknown', '', null, 1, {}]) {
    assert.equal(filters.readAnalyticsNavigationState({ analyticsFilters: { tier } }), null);
  }
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

test('effort options and filters preserve missing and custom levels and combine with a tier transition', () => {
  const records = [
    { reasoning_effort: ' HIGH ', request_service_tier: 'priority', response_service_tier: 'default' },
    { reasoning_effort: 'medium', request_service_tier: 'priority', response_service_tier: 'default' },
    { reasoning_effort: 'custom:42', effective_service_tier: 'priority' },
    {},
  ];
  const usage = { apis: { app: { models: { 'model-a': { details: records.map((record) => ({
    ...identityA, timestamp: '2026-10-08T00:00:00Z', tokens: {}, failed: false, ...record,
  })) } } } } };
  const details = collectUsageDetails(usage);
  assert.deepEqual(filters.legacyAnalyticsOptions(usage).efforts, ['', 'custom:42', 'high', 'medium']);
  const selected = { model: 'model-a', source: sources[0], tier: 'fast_to_std', effort: ' HIGH ' };
  assert.deepEqual(filters.analyticsQueryFilter(selected, options).filter, {
    model: 'model-a', identities: [identityA], tier_flow: 'fast_to_std', effort: 'high',
  });
  assert.deepEqual(details.filter((row) => filters.matchesAnalyticsFilters(row, selected)), [details[0]]);
  assert.deepEqual(details.filter((row) => filters.matchesAnalyticsFilters(row, { effort: '' })), [details[3]]);
  assert.deepEqual(filters.analyticsQueryFilter({ effort: '' }).filter, { effort: '' });
  assert.deepEqual(filters.analyticsQueryFilter({ effort: undefined }).filter, {});
  assert.deepEqual(filters.readAnalyticsNavigationState({ analyticsFilters: selected }), selected);
  for (const effort of [null, 1, {}]) assert.equal(filters.readAnalyticsNavigationState({ analyticsFilters: { effort } }), null);
});
