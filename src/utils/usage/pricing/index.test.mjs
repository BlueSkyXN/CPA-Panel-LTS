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

test('catalog is versioned, self-describing, exact, and keeps provider rate boundaries explicit', () => {
  const sol = pricing.findCatalogEntry('gpt-5.6-sol');
  assert.equal(pricing.PRICE_CATALOG_AS_OF, '2026-07-31');
  assert.equal(sol.currency, 'USD');
  assert.deepEqual(sol.aliases, ['gpt-5.6']);
  assert.equal(sol.sourceUrl, 'https://developers.openai.com/api/docs/pricing');
  assert.equal(sol.pricingNotesUrl, 'https://developers.openai.com/api/docs/models/gpt-5.6-sol');
  assert.equal(sol.standard.long.basis, 'inputTokens');
  assert.equal(sol.standard.long.appliesTo, 'entireRequest');
  assert.equal(sol.fast.multiplier, 2);
  assert.equal(sol.fast.longSupported, false);
  const terra = pricing.findCatalogEntry('gpt-5.6-terra');
  assert.deepEqual(terra.standard.short, {
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    output: 12,
  });
  assert.deepEqual(terra.standard.long.rates, {
    input: 4,
    cachedInput: 0.4,
    cacheWrite: 5,
    output: 18,
  });
  assert.equal(terra.asOf, '2026-07-31');
  const luna = pricing.findCatalogEntry('gpt-5.6-luna');
  assert.deepEqual(luna.standard.short, {
    input: 0.2,
    cachedInput: 0.02,
    cacheWrite: 0.25,
    output: 1.2,
  });
  assert.deepEqual(luna.standard.long.rates, {
    input: 0.4,
    cachedInput: 0.04,
    cacheWrite: 0.5,
    output: 1.8,
  });
  assert.equal(luna.asOf, '2026-07-31');
  const gpt55 = pricing.findCatalogEntry('gpt-5.5');
  assert.equal(gpt55.standard.long.basis, 'inputTokens');
  assert.equal(gpt55.standard.long.appliesTo, 'entireRequest');
  assert.equal(gpt55.fast.multiplier, 2.5);
  assert.equal(pricing.findCatalogEntry('gpt-5.6-sol-preview'), null);
  assert.equal(pricing.findCatalogEntry('tenant/gpt-5.6-sol'), null);
  assert.equal(pricing.findCatalogEntry('gpt-5.6').canonicalModel, 'gpt-5.6-sol');

  const glm = pricing.findCatalogEntry('glm-5.2');
  assert.equal(glm.currency, 'USD');
  assert.deepEqual(glm.aliases, []);
  assert.deepEqual(glm.standard.short, {
    input: 1.4,
    cachedInput: 0.26,
    cacheWrite: 0,
    output: 4.4,
  });
  assert.equal(glm.standard.long, undefined);
  assert.equal(glm.fast, undefined);
  assert.equal(glm.sourceUrl, 'https://docs.z.ai/guides/overview/pricing');
  assert.equal(glm.pricingNotesUrl, 'https://docs.z.ai/guides/llm/glm-5.2');
  assert.equal(glm.asOf, '2026-07-22');

  for (const [modelName, rates, sourceUrl, notesUrl, aliases] of [
    [
      'kimi-k3',
      { input: 3, cachedInput: 0.3, output: 15 },
      'https://platform.kimi.ai/docs/pricing/chat-k3',
      'https://platform.kimi.ai/docs/guide/kimi-k3-quickstart',
      ['k3'],
    ],
    [
      'kimi-k3-256k',
      { input: 1.5, cachedInput: 0.15, output: 7.5 },
      'https://platform.kimi.ai/docs/pricing/chat-k3',
      'https://platform.kimi.ai/docs/guide/kimi-k3-quickstart',
      ['k3-256k'],
    ],
    [
      'kimi-k2.7-code',
      { input: 0.95, cachedInput: 0.19, output: 4 },
      'https://platform.kimi.ai/docs/pricing/chat-k27-code',
      'https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart',
      ['kimi-for-coding'],
    ],
    [
      'kimi-k2.7-code-highspeed',
      { input: 1.9, cachedInput: 0.38, output: 8 },
      'https://platform.kimi.ai/docs/pricing/chat-k27-code',
      'https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart',
      ['kimi-for-coding-highspee', 'kimi-for-coding-highspeed'],
    ],
  ]) {
    const entry = pricing.findCatalogEntry(modelName);
    assert.equal(entry.currency, 'USD');
    assert.deepEqual(entry.aliases, aliases);
    assert.deepEqual(entry.standard.short, rates);
    assert.equal(entry.standard.long, undefined);
    assert.equal(entry.fast, undefined);
    assert.equal(entry.sourceUrl, sourceUrl);
    assert.equal(entry.pricingNotesUrl, notesUrl);
    assert.equal(entry.asOf, '2026-07-28');
  }

  const grok = pricing.findCatalogEntry('grok-4.5');
  assert.equal(grok.currency, 'USD');
  assert.deepEqual(grok.aliases, ['grok-4.5-latest', 'grok-build-latest']);
  assert.deepEqual(grok.standard.short, { input: 2, cachedInput: 0.3, output: 6 });
  assert.deepEqual(grok.standard.long, {
    thresholdTokens: 200_000,
    basis: 'inputTokens',
    appliesTo: 'entireRequest',
    rates: { input: 4, cachedInput: 0.6, output: 12 },
  });
  assert.equal(grok.fast, undefined);
  assert.equal(grok.sourceUrl, 'https://docs.x.ai/developers/models/grok-4.5');
  assert.equal(grok.pricingNotesUrl, undefined);
  assert.equal(grok.asOf, '2026-07-23');
});

test('GPT-5.3 Codex Spark is a free preset across every billable token category', () => {
  const spark = pricing.findCatalogEntry('gpt-5.3-codex-spark');
  assert.equal(spark.currency, 'USD');
  assert.deepEqual(spark.standard.short, {
    input: 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: 0,
  });

  const estimate = pricing.estimateUsageCost(
    'gpt-5.3-codex-spark',
    {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 200_000,
      cache_creation_tokens: 300_000,
    },
    undefined,
    tier()
  );
  assert.equal(estimate.status, 'priced');
  assert.equal(estimate.amount, 0);
  assert.deepEqual(estimate.rates, spark.standard.short);
});

test('Claude 4.5+ presets use official standard rates, exact aliases, and 5-minute cache writes', () => {
  const sourceUrl = 'https://platform.claude.com/docs/en/about-claude/pricing';
  const notesUrl = 'https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions';
  const models = [
    ['claude-haiku-4-5-20251001', ['claude-haiku-4-5'], [1, 0.1, 1.25, 5]],
    ['claude-sonnet-4-5-20250929', ['claude-sonnet-4-5'], [3, 0.3, 3.75, 15]],
    ['claude-sonnet-4-6', [], [3, 0.3, 3.75, 15]],
    ['claude-sonnet-5', [], [3, 0.3, 3.75, 15]],
    ['claude-opus-4-5-20251101', ['claude-opus-4-5'], [5, 0.5, 6.25, 25]],
    ['claude-opus-4-6', [], [5, 0.5, 6.25, 25]],
    ['claude-opus-4-7', [], [5, 0.5, 6.25, 25]],
    ['claude-opus-4-8', [], [5, 0.5, 6.25, 25]],
    ['claude-opus-5', [], [5, 0.5, 6.25, 25]],
    ['claude-fable-5', [], [10, 1, 12.5, 50]],
  ];

  for (const [modelName, aliases, [input, cachedInput, cacheWrite, output]] of models) {
    const entry = pricing.findCatalogEntry(modelName);
    assert.equal(entry.canonicalModel, modelName);
    assert.deepEqual(entry.aliases, aliases);
    assert.deepEqual(entry.standard.short, { input, cachedInput, cacheWrite, output });
    assert.equal(entry.standard.long, undefined);
    assert.equal(entry.fast, undefined);
    assert.equal(entry.sourceUrl, sourceUrl);
    assert.equal(entry.pricingNotesUrl, notesUrl);
    assert.equal(entry.asOf, '2026-07-26');

    for (const alias of aliases) {
      assert.equal(pricing.findCatalogEntry(alias).canonicalModel, modelName);
    }
  }

  assert.equal(pricing.findCatalogEntry('tenant/claude-sonnet-4-6'), null);
});

test('Claude 4.6+ keeps one standard rate card across the full 1M context window', () => {
  for (const [modelName, inputRate] of [
    ['claude-sonnet-4-6', 3],
    ['claude-sonnet-5', 3],
    ['claude-opus-4-6', 5],
    ['claude-opus-4-7', 5],
    ['claude-opus-4-8', 5],
    ['claude-opus-5', 5],
    ['claude-fable-5', 10],
  ]) {
    const estimate = pricing.estimateUsageCost(
      modelName,
      { input_tokens: 900_000 },
      undefined,
      tier()
    );
    assert.equal(estimate.status, 'priced');
    assert.equal(estimate.contextBand, 'short');
    approx(estimate.amount, inputRate * 0.9);
  }
});

test('Claude cost estimates apply cache hit and explicit 5-minute cache write rates', () => {
  const estimate = pricing.estimateUsageCost(
    'claude-sonnet-4-6',
    {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 200_000,
      cache_creation_tokens: 300_000,
    },
    undefined,
    tier()
  );
  assert.equal(estimate.status, 'priced');
  assert.deepEqual(estimate.rates, {
    input: 3,
    cachedInput: 0.3,
    cacheWrite: 3.75,
    output: 15,
  });
  approx(estimate.amount, 17.685);
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

  for (const [alias, canonicalModel] of [
    ['k3', 'kimi-k3'],
    ['k3-256k', 'kimi-k3-256k'],
    ['kimi-for-coding', 'kimi-k2.7-code'],
    ['kimi-for-coding-highspee', 'kimi-k2.7-code-highspeed'],
    ['kimi-for-coding-highspeed', 'kimi-k2.7-code-highspeed'],
    ['grok-4.5-latest', 'grok-4.5'],
    ['grok-build-latest', 'grok-4.5'],
  ]) {
    const resolved = pricing.resolvePriceProfile(alias, profile);
    assert.equal(resolved.modelMatch, 'alias');
    assert.equal(resolved.resolvedModel, canonicalModel);
  }
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
  assert.equal(gpt56.rates.input, 4);
});

test('GLM-5.2 keeps official Standard rates and explicit free cache write', () => {
  const estimate = pricing.estimateUsageCost(
    'glm-5.2',
    {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 200_000,
      cache_creation_tokens: 300_000,
    },
    undefined,
    tier()
  );

  assert.equal(estimate.status, 'priced');
  assert.equal(estimate.contextBand, 'short');
  assert.deepEqual(estimate.rates, {
    input: 1.4,
    cachedInput: 0.26,
    cacheWrite: 0,
    output: 4.4,
  });
  approx(estimate.amount, 5.152);
});

test('GLM-5.2 Fast is unsupported and excluded from priced coverage', () => {
  const estimate = pricing.estimateUsageCost(
    'glm-5.2',
    { input_tokens: 1_000_000, total_tokens: 1_000_000 },
    undefined,
    tier('fast', 'request')
  );

  assert.equal(estimate.status, 'unsupported');
  assert.equal(estimate.amount, null);
  assert.equal(estimate.rates, null);
  assert.deepEqual(estimate.warnings, ['requestedEstimate']);

  const coverage = pricing.aggregateCostEstimateCoverage([
    { modelName: 'glm-5.2', tokenCount: 1_000_000, estimate },
  ]);
  assert.equal(coverage.totalRequests, 1);
  assert.equal(coverage.pricedRequests, 0);
  assert.equal(coverage.unsupportedRequests, 1);
  assert.equal(coverage.totalTokens, 1_000_000);
  assert.equal(coverage.pricedTokens, 0);
  assert.equal(coverage.totalModels, 1);
  assert.equal(coverage.pricedModels, 0);
  assert.equal(coverage.estimatedAmount, 0);
});

test('Kimi presets map cache hit and miss rates without inventing Fast pricing', () => {
  for (const [modelName, expectedRates, expectedAmount] of [
    ['kimi-k3', { input: 3, cachedInput: 0.3, output: 15 }, 17.46],
    ['kimi-k3-256k', { input: 1.5, cachedInput: 0.15, output: 7.5 }, 8.73],
    ['kimi-k2.7-code', { input: 0.95, cachedInput: 0.19, output: 4 }, 4.798],
    ['kimi-k2.7-code-highspeed', { input: 1.9, cachedInput: 0.38, output: 8 }, 9.596],
  ]) {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 200_000,
      cache_creation_tokens: 300_000,
    };
    const standard = pricing.estimateUsageCost(modelName, usage, undefined, tier());
    assert.equal(standard.status, 'priced');
    assert.equal(standard.contextBand, 'short');
    assert.deepEqual(standard.rates, expectedRates);
    approx(standard.amount, expectedAmount);

    const fast = pricing.estimateUsageCost(modelName, usage, undefined, tier('fast', 'request'));
    assert.equal(fast.status, 'unsupported');
    assert.equal(fast.amount, null);
    assert.equal(fast.rates, null);
  }
});

test('Grok 4.5 switches the entire request to long-context rates at 200K prompt tokens', () => {
  for (const [inputTokens, contextBand, rates] of [
    [199_999, 'short', { input: 2, cachedInput: 0.3, output: 6 }],
    [200_000, 'long', { input: 4, cachedInput: 0.6, output: 12 }],
    [200_001, 'long', { input: 4, cachedInput: 0.6, output: 12 }],
  ]) {
    const estimate = pricing.estimateUsageCost(
      'grok-4.5',
      { input_tokens: inputTokens, cache_read_tokens: 1_000, output_tokens: 10_000 },
      undefined,
      tier()
    );
    assert.equal(estimate.status, 'priced');
    assert.equal(estimate.contextBand, contextBand);
    assert.deepEqual(estimate.rates, rates);
  }

  const alias = pricing.estimateUsageCost(
    'grok-4.5-latest',
    { input_tokens: 1_000 },
    undefined,
    tier()
  );
  assert.equal(alias.status, 'priced');
  assert.equal(alias.resolvedModel, 'grok-4.5');

  const fast = pricing.estimateUsageCost(
    'grok-4.5',
    { input_tokens: 1_000 },
    undefined,
    tier('fast', 'request')
  );
  assert.equal(fast.status, 'unsupported');
  assert.equal(fast.amount, null);
  assert.equal(fast.rates, null);
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

test('cost uses the normalized cache split and honors Auto versus explicit free cache write', () => {
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
  approx(pricing.estimateUsageCost('local', usage, auto, tier()).amount, 3.73);
  approx(pricing.estimateUsageCost('local', usage, free, tier()).amount, 3.33);
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
      assumedTierRequests: 0,
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

test('local estimate completeness remains false when aggregate totals exceed priced details', () => {
  const complete = pricing.aggregateCostEstimateCoverage([
    {
      modelName: 'gpt-5.4-mini',
      tokenCount: 1_000_000,
      estimate: pricing.estimateUsageCost(
        'gpt-5.4-mini',
        { input_tokens: 1_000_000 },
        undefined,
        tier()
      ),
    },
  ]);
  const gap = { ...complete, totalTokens: 2_000_000, pricedModels: 0, pricedModelRatio: 0 };
  assert.equal(pricing.isLocalEstimateComplete(gap), false);
  assert.equal(pricing.hasPricingAnomaly(gap), true);
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
