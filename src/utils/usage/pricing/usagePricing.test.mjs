import assert from 'node:assert/strict';
import test from 'node:test';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: [new URL('./usagePricing.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  target: 'es2020',
});
const pricing = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

const profile = {
  schemaVersion: 3,
  currency: 'USD',
  assumptions: { historicalPricing: 'current', unknownServiceTier: 'standard' },
  aliases: {},
  overrides: {},
};

test('detail pricing uses effective tier and remains independent of unrecognized fields', () => {
  const priced = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4-mini',
      request_service_tier: 'priority',
      response_service_tier: 'default',
      legacy_server_field: 'ignored',
      tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(priced.tier.tier, 'std');
  assert.equal(priced.tier.evidence, 'response');
  assert.equal(priced.estimate.amount, 0.75);
  assert.deepEqual(Object.keys(priced.estimate).sort().includes('legacyServerField'), false);
});

test('detail pricing uses outbound tier before request intent when effective data is absent', () => {
  const priced = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4-mini',
      request_service_tier: 'priority',
      outbound_service_tier: 'default',
      tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(priced.tier.tier, 'std');
  assert.equal(priced.tier.evidence, 'outbound');
  assert.equal(priced.estimate.amount, 0.75);
});

test('coverage uses priced and total request, token, and model dimensions only', () => {
  const coverage = pricing.summarizeUsageDetailCosts(
    [
      {
        __modelName: 'gpt-5.4-mini',
        tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
      },
      {
        __modelName: 'unknown-model',
        tokens: { input_tokens: 50, total_tokens: 50 },
      },
    ],
    profile
  );
  assert.deepEqual(coverage, {
    totalRequests: 2,
    pricedRequests: 1,
    unmatchedRequests: 1,
    unsupportedRequests: 0,
    totalTokens: 1_000_050,
    pricedTokens: 1_000_000,
    totalModels: 2,
    pricedModels: 1,
    estimatedAmount: 0.75,
    assumedTierRequests: 1,
    pricedRequestRatio: 0.5,
    pricedTokenRatio: 1_000_000 / 1_000_050,
    pricedModelRatio: 0.5,
  });
});
