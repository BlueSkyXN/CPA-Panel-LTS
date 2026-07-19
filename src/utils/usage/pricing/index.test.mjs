import assert from 'node:assert/strict';
import test from 'node:test';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: [new URL('./index.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  target: 'es2020',
});
const pricing = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

const tier = (tierName = 'std', evidence = 'effective') => ({
  tier: tierName,
  evidence,
  rawRequest: evidence === 'request' ? 'priority' : null,
  rawResponse: null,
  rawEffective: null,
});

const approx = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `cost = ${actual}, expected ${expected}`);

test('catalog is versioned, self-describing, exact, and keeps Priority long context unsupported', () => {
  const sol = pricing.findCatalogEntry('gpt-5.6-sol');
  assert.equal(pricing.OPENAI_CATALOG_AS_OF, '2026-07-19');
  assert.equal(sol.currency, 'USD');
  assert.deepEqual(sol.aliases, []);
  assert.equal(sol.sourceUrl, 'https://developers.openai.com/api/docs/pricing');
  assert.equal(sol.standard.long.basis, 'inputTokens');
  assert.equal(sol.standard.long.appliesTo, 'entireRequest');
  assert.equal(sol.fast.longSupported, false);
  assert.equal(pricing.findCatalogEntry('gpt-5.6-sol-preview'), null);
  assert.equal(pricing.findCatalogEntry('tenant/gpt-5.6-sol'), null);
});

test('matches direct custom, canonical preset, explicit alias, and unmatched without fuzzy matching', () => {
  const profile = {
    ...pricing.createDefaultPriceProfileV3(),
    aliases: { 'tenant/sol': 'gpt-5.6-sol' },
    overrides: {
      local: { standard: { short: { input: 1, cachedInput: 0.1, output: 2 } } },
    },
  };
  assert.equal(pricing.resolvePriceProfile('local', profile).modelMatch, 'custom');
  assert.equal(pricing.resolvePriceProfile('gpt-5.6-sol', profile).modelMatch, 'preset');
  assert.equal(pricing.resolvePriceProfile('tenant/sol', profile).modelMatch, 'alias');
  assert.equal(pricing.resolvePriceProfile('tenant/gpt-5.6-sol', profile).modelMatch, 'none');
});

test('v2 migration preserves Auto cache-write, explicit zero, and old string values', () => {
  const { profile } = pricing.migrateModelPricesV2ToV3({
    auto: { prompt: '10', completion: '20', cache: '1' },
    zero: { prompt: 10, completion: 20, cache: 1, cacheWrite: 0 },
  });
  assert.deepEqual(profile.overrides.auto.standard.short, {
    input: 10,
    cachedInput: 1,
    output: 20,
  });
  assert.deepEqual(profile.overrides.zero.standard.short, {
    input: 10,
    cachedInput: 1,
    cacheWrite: 0,
    output: 20,
  });
});

test('Fast preset uses explicit rates, custom multiplier scales the current context band, and legacy custom falls back', () => {
  const preset = pricing.estimateUsageCost(
    'gpt-5.4-mini',
    { input_tokens: 1_000_000, output_tokens: 100_000 },
    undefined,
    tier('fast')
  );
  approx(preset.amount, 2.4);

  const multiplierProfile = {
    ...pricing.createDefaultPriceProfileV3(),
    overrides: {
      local: {
        standard: { short: { input: 2, cachedInput: 0.2, output: 4 } },
        fast: { multiplier: 3, longSupported: true },
      },
    },
  };
  const multiplied = pricing.estimateUsageCost(
    'local',
    { input_tokens: 1_000_000, output_tokens: 100_000 },
    multiplierProfile,
    tier('fast')
  );
  approx(multiplied.amount, 7.2);

  const legacy = pricing.migrateModelPricesV2ToV3({
    local: { prompt: 10, completion: 20, cache: 1 },
  }).profile;
  const fallback = pricing.estimateUsageCost(
    'local',
    { input_tokens: 1_000_000, output_tokens: 100_000 },
    legacy,
    tier('fast')
  );
  approx(fallback.amount, 12);
  assert.deepEqual(fallback.warnings, ['fallbackStandard']);
});

test('the full input_tokens count switches the entire request at 271999, 272000, and 272001', () => {
  for (const [inputTokens, expectedBand, expectedInputRate] of [
    [271_999, 'short', 2.5],
    [272_000, 'long', 5],
    [272_001, 'long', 5],
  ]) {
    const estimate = pricing.estimateUsageCost(
      'gpt-5.6-terra',
      { input_tokens: inputTokens, output_tokens: 1 },
      undefined,
      tier()
    );
    assert.equal(estimate.contextBand, expectedBand);
    assert.equal(estimate.rates.input, expectedInputRate);
  }
});

test('Fast long context remains unsupported and evidence warnings stay explicit', () => {
  const unsupported = pricing.estimateUsageCost(
    'gpt-5.5',
    { input_tokens: 272_000 },
    undefined,
    tier('fast', 'request')
  );
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.amount, null);
  assert.deepEqual(unsupported.warnings, ['requestedEstimate']);

  const assumed = pricing.estimateUsageCost(
    'gpt-5.4-mini',
    { input_tokens: 1 },
    undefined,
    tier('std', 'assumed')
  );
  assert.deepEqual(assumed.warnings, ['assumedStandard']);
});

test('cost uses the existing GPT-5.6 cache split and honors Auto versus explicit free cache write', () => {
  const usage = {
    input_tokens: 200_000,
    output_tokens: 100_000,
    cache_read_tokens: 30_000,
    cache_creation_tokens: 40_000,
  };
  const preset = pricing.estimateUsageCost('gpt-5.6-sol', usage, undefined, tier());
  assert.deepEqual(preset.tokenSplit, {
    inputTokens: 200_000,
    outputTokens: 100_000,
    cacheReadTokens: 30_000,
    cacheWriteTokens: 40_000,
    promptTokens: 130_000,
  });
  approx(preset.amount, 3.915);

  const auto = pricing.migrateModelPricesV2ToV3({
    local: { prompt: 10, completion: 20, cache: 1 },
  }).profile;
  const free = pricing.migrateModelPricesV2ToV3({
    local: { prompt: 10, completion: 20, cache: 1, cacheWrite: 0 },
  }).profile;
  approx(pricing.estimateUsageCost('local', usage, auto, tier()).amount, 4.13);
  approx(pricing.estimateUsageCost('local', usage, free, tier()).amount, 3.73);
});

test('strict import preflight rejects damaged data, alias collisions, and invalid targets; roundtrip stays valid', () => {
  const valid = {
    ...pricing.createDefaultPriceProfileV3(),
    aliases: { tenant: 'gpt-5.6-sol' },
    overrides: { local: { standard: { short: { input: 1, cachedInput: 0, output: 2 } } } },
  };
  const serialized = pricing.serializePriceProfileV3(valid);
  assert.equal(pricing.importPriceProfileV3(serialized).valid, true);
  assert.equal(pricing.preflightPriceProfileImportV3({ ...valid, currency: 'EUR' }).valid, false);
  assert.equal(
    pricing.preflightPriceProfileImportV3({ ...valid, aliases: { LOOP: 'loop' } }).valid,
    false
  );
  assert.equal(
    pricing.preflightPriceProfileImportV3({
      ...valid,
      aliases: { Tenant: 'gpt-5.6-sol', tenant: 'gpt-5.6-terra' },
    }).valid,
    false
  );
  assert.equal(
    pricing.preflightPriceProfileImportV3({ ...valid, aliases: { local: 'gpt-5.6-sol' } }).valid,
    false
  );
  assert.equal(
    pricing.preflightPriceProfileImportV3({ ...valid, aliases: { unknown: 'not-a-model' } }).valid,
    false
  );
  assert.equal(
    pricing.preflightPriceProfileImportV3({
      ...valid,
      overrides: { bad: { standard: { short: { input: -1, cachedInput: 0, output: 1 } } } },
    }).valid,
    false
  );
  assert.equal(
    pricing.preflightPriceProfileImportV3({
      ...valid,
      overrides: {
        bad: {
          standard: { short: { input: 1, cachedInput: 0, output: 1 } },
          fast: { multiplier: 0, longSupported: true },
        },
      },
    }).valid,
    false
  );
});

test('coverage reports request, token, model, amount, and assumed-tier completeness without turning gaps into zero', () => {
  const priced = pricing.estimateUsageCost(
    'gpt-5.4-mini',
    { input_tokens: 1_000_000 },
    undefined,
    tier()
  );
  const unmatched = pricing.estimateUsageCost(
    'unknown',
    { input_tokens: 20 },
    undefined,
    tier('std', 'assumed')
  );
  const unsupported = pricing.estimateUsageCost(
    'gpt-5.5',
    { input_tokens: 272_000 },
    undefined,
    tier('fast')
  );
  assert.deepEqual(
    pricing.aggregateCostEstimateCoverage([
      { modelName: 'gpt-5.4-mini', tokenCount: 1_000_000, estimate: priced },
      { modelName: 'unknown', tokenCount: 20, estimate: unmatched },
      { modelName: 'gpt-5.5', tokenCount: 272_000, estimate: unsupported },
    ]),
    {
      totalRequests: 3,
      pricedRequests: 1,
      unmatchedRequests: 1,
      unsupportedRequests: 1,
      totalTokens: 1_272_020,
      pricedTokens: 1_000_000,
      totalModels: 3,
      pricedModels: 1,
      estimatedAmount: 0.75,
      assumedTierRequests: 1,
      pricedRequestRatio: 1 / 3,
      pricedTokenRatio: 1_000_000 / 1_272_020,
      pricedModelRatio: 1 / 3,
    }
  );
});

test('a model is covered only when every request for that model is priced', () => {
  const priced = pricing.estimateUsageCost('gpt-5.4', { input_tokens: 1_000 }, undefined, tier());
  const unsupported = pricing.estimateUsageCost(
    'gpt-5.4',
    { input_tokens: 272_000 },
    undefined,
    tier('fast')
  );
  const coverage = pricing.aggregateCostEstimateCoverage([
    { modelName: 'gpt-5.4', tokenCount: 1_000, estimate: priced },
    { modelName: 'gpt-5.4', tokenCount: 272_000, estimate: unsupported },
  ]);
  assert.equal(coverage.totalModels, 1);
  assert.equal(coverage.pricedModels, 0);
  assert.equal(coverage.pricedModelRatio, 0);
  assert.equal(coverage.pricedRequests, 1);
  assert.equal(coverage.unsupportedRequests, 1);
});
