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

test('detail pricing uses the canonical tier resolver and preserves assumed evidence', () => {
  const responseWins = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4-mini',
      request_service_tier: 'priority',
      response_service_tier: 'default',
      tokens: { input_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(responseWins.tier.tier, 'std');
  assert.equal(responseWins.tier.evidence, 'response');
  assert.equal(responseWins.estimate.amount, 0.75);

  const assumed = pricing.estimateUsageDetailCost(
    { __modelName: 'gpt-5.4-mini', tokens: { input_tokens: 1 } },
    profile
  );
  assert.equal(assumed.tier.evidence, 'assumed');
  assert.deepEqual(assumed.estimate.warnings, ['assumedStandard']);
});

test('coverage includes failed token-bearing requests and keeps gaps incomplete', () => {
  const details = [
    {
      __modelName: 'gpt-5.4-mini',
      failed: true,
      tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
    },
    {
      __modelName: 'unknown-model',
      failed: false,
      tokens: { input_tokens: 50, total_tokens: 50 },
    },
  ];
  const coverage = pricing.summarizeUsageDetailCosts(details, profile);
  assert.equal(coverage.totalRequests, 2);
  assert.equal(coverage.pricedRequests, 1);
  assert.equal(coverage.unmatchedRequests, 1);
  assert.equal(coverage.estimatedAmount, 0.75);
  assert.equal(coverage.pricedRequestRatio, 0.5);
  assert.equal(coverage.pricedTokens, 1_000_000);
  assert.equal(coverage.totalTokens, 1_000_050);
});
