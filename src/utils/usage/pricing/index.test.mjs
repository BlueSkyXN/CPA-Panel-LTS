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
  assert.equal(pricing.OPENAI_CATALOG_AS_OF, '2026-07-20');
  assert.equal(sol.currency, 'USD');
  assert.deepEqual(sol.aliases, ['gpt-5.6']);
  assert.equal(sol.sourceUrl, 'https://developers.openai.com/api/docs/pricing');
  assert.equal(sol.pricingNotesUrl, 'https://developers.openai.com/api/docs/models/gpt-5.6-sol');
  assert.equal(sol.standard.long.basis, 'inputTokens');
  assert.equal(sol.standard.long.appliesTo, 'entireRequest');
  assert.equal(sol.fast.multiplier, 2);
  assert.equal(sol.fast.longSupported, false);
  const gpt55 = pricing.findCatalogEntry('gpt-5.5');
  assert.equal(gpt55.standard.long.basis, 'inputTokens');
  assert.equal(gpt55.standard.long.appliesTo, 'entireRequest');
  assert.equal(gpt55.fast.multiplier, 2.5);
  assert.equal(pricing.findChatGptCreditPolicy('gpt-5.6-sol').fastMultiplier, 2.5);
  assert.equal(pricing.findChatGptCreditPolicy('gpt-5.6').fastMultiplier, 2.5);
  assert.equal(pricing.findChatGptCreditPolicy('gpt-5.4').fastMultiplier, 2);
  assert.equal(pricing.findChatGptCreditPolicy('gpt-5.4-mini'), null);
  assert.equal(pricing.findCatalogEntry('gpt-5.6-sol-preview'), null);
  assert.equal(pricing.findCatalogEntry('tenant/gpt-5.6-sol'), null);
  assert.equal(pricing.findCatalogEntry('gpt-5.6').canonicalModel, 'gpt-5.6-sol');
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

test('v2 migration preserves matching rates until the user explicitly restores complete presets', () => {
  const { profile } = pricing.migrateModelPricesV2ToV3({
    'gpt-5.6-sol': {
      prompt: 5,
      completion: 30,
      cache: 0.5,
      cacheWrite: 6.25,
    },
    'gpt-5.4': {
      prompt: 2.5,
      completion: 15,
      cache: 0.25,
      cacheWrite: 2.5,
    },
    'gpt-5.6-terra': {
      prompt: 2.75,
      completion: 15,
      cache: 0.25,
      cacheWrite: 3.125,
    },
  });

  assert.ok(profile.overrides['gpt-5.6-sol']);
  assert.ok(profile.overrides['gpt-5.4']);
  assert.equal(profile.overrides['gpt-5.6-terra'].standard.short.input, 2.75);
  assert.equal(pricing.resolvePriceProfile('gpt-5.6-sol', profile).modelMatch, 'custom');

  const recovery = pricing.restorePresetEquivalentOverrides(profile);
  assert.deepEqual(recovery.restoredModels, ['gpt-5.6-sol', 'gpt-5.4']);
  assert.equal(pricing.resolvePriceProfile('gpt-5.6-sol', recovery.profile).modelMatch, 'preset');
  assert.equal(pricing.resolvePriceProfile('gpt-5.6-sol', recovery.profile).fast.multiplier, 2);
  assert.equal(
    pricing.resolvePriceProfile('gpt-5.6-sol', recovery.profile).standard.long.rates.output,
    45
  );
});

test('preset-equivalent v3 recovery is opt-in and preserves real custom overrides', () => {
  const profile = {
    ...pricing.createDefaultPriceProfileV3(),
    aliases: { 'tenant/sol': 'gpt-5.6-sol' },
    overrides: {
      'gpt-5.6-sol': {
        standard: {
          short: { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 },
        },
      },
      'gpt-5.6-terra': {
        standard: {
          short: { input: 2.75, cachedInput: 0.25, cacheWrite: 3.125, output: 15 },
        },
      },
      'gpt-5.4': {
        standard: {
          short: { input: 2.5, cachedInput: 0.25, output: 15 },
          long: {
            thresholdTokens: 300_000,
            basis: 'inputTokens',
            appliesTo: 'entireRequest',
            rates: { input: 6, cachedInput: 0.6, output: 24 },
          },
        },
      },
      'gpt-5.6-luna': {
        standard: {
          short: { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 6 },
        },
        fast: { multiplier: 3, longSupported: true },
      },
      'grok-4.5': {
        standard: { short: { input: 2, cachedInput: 0, output: 6 } },
      },
    },
  };

  const recovery = pricing.restorePresetEquivalentOverrides(profile);
  assert.deepEqual(recovery.restoredModels, ['gpt-5.6-sol']);
  assert.equal(recovery.profile.overrides['gpt-5.6-sol'], undefined);
  assert.ok(recovery.profile.overrides['gpt-5.6-terra']);
  assert.ok(recovery.profile.overrides['gpt-5.4']);
  assert.ok(recovery.profile.overrides['gpt-5.6-luna']);
  assert.ok(recovery.profile.overrides['grok-4.5']);
  assert.equal(recovery.profile.aliases['tenant/sol'], 'gpt-5.6-sol');
  assert.equal(pricing.resolvePriceProfile('tenant/sol', recovery.profile).modelMatch, 'alias');
  assert.equal(pricing.resolvePriceProfile('tenant/sol', recovery.profile).fast.multiplier, 2);
  assert.ok(profile.overrides['gpt-5.6-sol']);
});

test('API coverage display treats absent denominators as unavailable, not zero percent', () => {
  assert.deepEqual(
    pricing.getApiCoverageDisplay({
      apiTokenUsdRequests: 0,
      pricedRequests: 0,
      apiTokenUsdTokens: 0,
      pricedTokens: 0,
    }),
    { requestPercent: null, tokenPercent: null }
  );
  assert.deepEqual(
    pricing.getApiCoverageDisplay({
      apiTokenUsdRequests: 5,
      pricedRequests: 3,
      apiTokenUsdTokens: 200,
      pricedTokens: 50,
    }),
    { requestPercent: 60, tokenPercent: 25 }
  );
  assert.deepEqual(
    pricing.getApiCoverageDisplay({
      apiTokenUsdRequests: 0,
      pricedRequests: 0,
      apiTokenUsdTokens: 100,
      pricedTokens: 0,
    }),
    { requestPercent: null, tokenPercent: 0 }
  );
  assert.deepEqual(
    pricing.getApiCoverageDisplay({
      apiTokenUsdRequests: 1,
      pricedRequests: 1,
      apiTokenUsdTokens: 0,
      pricedTokens: 0,
    }),
    { requestPercent: 100, tokenPercent: null }
  );
});

test('Fast preset and custom profiles derive rates from the selected Standard context band', () => {
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

test('the full input_tokens count switches GPT-5.5 at 271999, 272000, and 272001', () => {
  for (const [inputTokens, expectedBand, expectedInputRate] of [
    [271_999, 'short', 5],
    [272_000, 'long', 10],
    [272_001, 'long', 10],
  ]) {
    const estimate = pricing.estimateUsageCost(
      'gpt-5.5',
      { input_tokens: inputTokens, output_tokens: 1 },
      undefined,
      tier()
    );
    assert.equal(estimate.contextBand, expectedBand);
    assert.equal(estimate.rates.input, expectedInputRate);
  }

  const gpt56 = pricing.estimateUsageCost(
    'gpt-5.6-terra',
    { input_tokens: 300_000, output_tokens: 1 },
    undefined,
    tier()
  );
  assert.equal(gpt56.contextBand, 'long');
  assert.equal(gpt56.rates.input, 5);
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
      apiTokenUsdRequests: 3,
      chatGptCreditRequests: 0,
      pricedRequests: 1,
      creditRatedRequests: 0,
      creditFastRequests: 0,
      unknownBillingRequests: 0,
      unmatchedRequests: 1,
      unsupportedRequests: 1,
      totalTokens: 1_272_020,
      apiTokenUsdTokens: 1_272_020,
      chatGptCreditTokens: 0,
      pricedTokens: 1_000_000,
      creditRatedTokens: 0,
      unknownBillingTokens: 0,
      totalModels: 3,
      pricedModels: 1,
      apiTokenUsdModels: 3,
      apiPricedModels: 1,
      chatGptCreditModels: 0,
      creditRatedModels: 0,
      unknownBillingModels: 0,
      estimatedAmount: 0.75,
      assumedTierRequests: 0,
      pricedRequestRatio: 1 / 3,
      pricedTokenRatio: 1_000_000 / 1_272_020,
      pricedModelRatio: 1 / 3,
      apiPricedRequestRatio: 1 / 3,
      apiPricedTokenRatio: 1_000_000 / 1_272_020,
      apiPricedModelRatio: 1 / 3,
      creditRatedRequestRatio: 0,
      creditRatedTokenRatio: 0,
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

test('token-only unknown usage makes the API USD estimate incomplete without changing API-domain ratios', () => {
  const priced = pricing.estimateUsageCost(
    'gpt-5.4-mini',
    { input_tokens: 1_000_000 },
    undefined,
    tier()
  );
  const complete = pricing.aggregateCostEstimateCoverage([
    { modelName: 'gpt-5.4-mini', tokenCount: 1_000_000, estimate: priced },
  ]);
  const tokenGap = {
    ...complete,
    totalTokens: 2_000_000,
    unknownBillingTokens: 1_000_000,
    unknownBillingModels: 1,
    pricedModels: 0,
    pricedModelRatio: 0,
  };

  assert.equal(tokenGap.apiPricedRequestRatio, 1);
  assert.equal(tokenGap.apiPricedTokenRatio, 1);
  assert.equal(pricing.hasUnknownBillingUsage(tokenGap), true);
  assert.equal(pricing.isApiUsdEstimateComplete(tokenGap), false);
  assert.equal(pricing.hasPricingAnomaly(tokenGap), true);
});

test('Fast policy display distinguishes official and custom multipliers from explicit rates', () => {
  const defaults = pricing.createDefaultPriceProfileV3();
  assert.deepEqual(
    pricing.getApiFastPolicyDisplay(pricing.resolvePriceProfile('gpt-5.6-sol', defaults)),
    { kind: 'official-multiplier', multiplier: 2 }
  );

  const customMultiplier = {
    ...defaults,
    overrides: {
      local: {
        standard: { short: { input: 2, cachedInput: 0.2, output: 4 } },
        fast: { multiplier: 3, longSupported: true },
      },
    },
  };
  assert.deepEqual(
    pricing.getApiFastPolicyDisplay(pricing.resolvePriceProfile('local', customMultiplier)),
    { kind: 'custom-multiplier', multiplier: 3 }
  );

  const explicitRates = {
    ...defaults,
    overrides: {
      local: {
        standard: { short: { input: 2, cachedInput: 0.2, output: 4 } },
        fast: {
          short: { input: 6, cachedInput: 0.4, output: 10 },
          longSupported: true,
        },
      },
    },
  };
  assert.deepEqual(
    pricing.getApiFastPolicyDisplay(pricing.resolvePriceProfile('local', explicitRates)),
    { kind: 'explicit-rates', multiplier: null }
  );
});
