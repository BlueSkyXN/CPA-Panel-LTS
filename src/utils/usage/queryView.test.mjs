import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./queryView.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const query = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);
const pricingBundle = await build({
  entryPoints: [new URL('./pricing/index.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const pricing = await import(
  `data:text/javascript;base64,${Buffer.from(pricingBundle.outputFiles[0].contents).toString('base64')}`
);

test('query price classes preserve dynamic prices, thresholds, Auto versus zero and unknown tiers', () => {
  const profile = pricing.createDefaultPriceProfileV3();
  profile.overrides['gpt-query-test'] = {
    standard: {
      short: { input: 3, cachedInput: 0.3, output: 5, cacheWrite: 0 },
      long: {
        thresholdTokens: 1000,
        basis: 'inputTokens',
        appliesTo: 'entireRequest',
        rates: { input: 6, cachedInput: 0.6, output: 10 },
      },
    },
    fast: { multiplier: 2, longSupported: false },
  };
  const groups = [];
  const expected = [];
  for (const model of ['gpt-query-test', 'unmatched-query-test']) {
    for (const input of [100, 1000, 5000]) {
      for (const tier of ['std', 'fast']) {
        for (const evidence of ['assumed', 'request', 'response']) {
          const tokens = {
            input_tokens: input,
            output_tokens: 100,
            cache_read_tokens: 10,
            cache_creation_tokens: 20,
          };
          const estimate = pricing.estimateUsageCost(model, tokens, profile, {
            tier,
            evidence,
            rawRequest: null,
            rawOutbound: null,
            rawResponse: null,
            rawEffective: null,
          });
          const count = 7;
          groups.push({
            model,
            tier,
            evidence,
            band: estimate.contextBand,
            requests: count,
            tokens: (input + 100) * count,
            prompt: Math.max(input - 30, 0) * count,
            cache_read: 10 * count,
            cache_write: 20 * count,
            output: 100 * count,
          });
          for (let i = 0; i < count; i++)
            expected.push({ modelName: model, tokenCount: input + 100, estimate });
        }
      }
    }
  }
  const actual = query.queryCoverage({ prices: groups }, profile);
  const legacy = pricing.aggregateCostEstimateCoverage(expected);
  assert.ok(Math.abs(actual.estimatedAmount - legacy.estimatedAmount) < 1e-10);
  assert.deepEqual({ ...actual, estimatedAmount: 0 }, { ...legacy, estimatedAmount: 0 });
  profile.overrides['gpt-query-test'].standard.short.input = 30;
  assert.notEqual(
    query.queryCoverage({ prices: groups }, profile).estimatedAmount,
    actual.estimatedAmount
  );
  assert.equal(
    query.buildQueryPriceRules(['gpt-query-test'], profile)['gpt-query-test'].long_threshold,
    1000
  );
  profile.assumptions.gptLongContext = 'shortOnly';
  assert.deepEqual(query.buildQueryPriceRules(['gpt-query-test'], profile), {
    'gpt-query-test': {},
  });
});

test('prepared pricing is a separate immutable configuration with reusable per-model results', () => {
  const profile = pricing.createDefaultPriceProfileV3();
  const prepared = pricing.preparePriceProfile(profile);
  assert.notEqual(profile, prepared);
  assert.equal(pricing.preparePriceProfile(prepared), prepared);
  assert.equal(
    pricing.resolvePriceProfile('gpt-5.6-sol', prepared),
    pricing.resolvePriceProfile('gpt-5.6-sol', prepared)
  );
  assert.ok(Object.isFrozen(prepared.overrides));
  assert.ok(!Object.isFrozen(profile));
});

test('query views are tagged summaries, never full snapshots or synthetic request records', () => {
  const view = query.makeUsageQueryView({
    version: 1,
    bound: 'test',
    now_ms: Date.now(),
    totals: { requests: 10000, success: 9000, failure: 1000, tokens: 100000 },
    groups: {},
  });
  assert.equal(view.kind, 'usage-query-v1');
  assert.equal(view.total_requests, 10000);
  assert.equal('apis' in view, false);
  assert.equal('details' in view, false);
});
