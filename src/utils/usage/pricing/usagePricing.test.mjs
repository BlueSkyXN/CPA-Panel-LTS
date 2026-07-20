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
      billing_basis: 'api-token-usd',
      tokens: { input_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(responseWins.tier.tier, 'std');
  assert.equal(responseWins.tier.evidence, 'response');
  assert.equal(responseWins.estimate.amount, 0.75);

  const assumed = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4-mini',
      billing_basis: 'api-token-usd',
      tokens: { input_tokens: 1 },
    },
    profile
  );
  assert.equal(assumed.tier.evidence, 'assumed');
  assert.deepEqual(assumed.estimate.warnings, ['assumedStandard']);
});

test('coverage includes failed token-bearing requests and keeps gaps incomplete', () => {
  const details = [
    {
      __modelName: 'gpt-5.4-mini',
      billing_basis: 'api-token-usd',
      failed: true,
      tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
    },
    {
      __modelName: 'unknown-model',
      billing_basis: 'api-token-usd',
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

test('missing and explicit unknown billing_basis both fail closed without an API USD amount', () => {
  const missing = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4-mini',
      tokens: { input_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(missing.estimate.billingBasis, 'unknown');
  assert.equal(missing.estimate.status, 'billing-unknown');
  assert.equal(missing.estimate.amount, null);

  const explicitUnknown = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4-mini',
      billing_basis: 'unknown',
      tokens: { input_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(explicitUnknown.estimate.billingBasis, 'unknown');
  assert.equal(explicitUnknown.estimate.status, 'billing-unknown');
  assert.equal(explicitUnknown.estimate.amount, null);
});

test('ChatGPT credits and explicit unknown billing never become API USD amounts', () => {
  const creditFast = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.6-sol',
      billing_basis: 'chatgpt-credits',
      effective_service_tier: 'priority',
      tokens: { input_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(creditFast.estimate.status, 'credit-rated');
  assert.equal(creditFast.estimate.amount, null);
  assert.equal(creditFast.estimate.creditMultiplier, 2.5);

  const unknown = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.6-sol',
      billing_basis: 'unknown',
      tokens: { input_tokens: 1_000_000 },
    },
    profile
  );
  assert.equal(unknown.estimate.status, 'billing-unknown');
  assert.equal(unknown.estimate.amount, null);

  const coverage = pricing.summarizeUsageDetailCosts(
    [
      {
        __modelName: 'gpt-5.6-sol',
        billing_basis: 'chatgpt-credits',
        effective_service_tier: 'priority',
        tokens: { input_tokens: 1_000_000 },
      },
      {
        __modelName: 'gpt-5.6-sol',
        billing_basis: 'unknown',
        tokens: { input_tokens: 2_000_000 },
      },
    ],
    profile
  );
  assert.equal(coverage.estimatedAmount, 0);
  assert.equal(coverage.apiTokenUsdRequests, 0);
  assert.equal(coverage.chatGptCreditRequests, 1);
  assert.equal(coverage.creditRatedRequests, 1);
  assert.equal(coverage.creditFastRequests, 1);
  assert.equal(coverage.unknownBillingRequests, 1);
  assert.equal(coverage.unmatchedRequests, 0);
  assert.equal(coverage.creditRatedRequestRatio, 1);
  assert.equal(coverage.apiPricedRequestRatio, 0);
});

test('only actual Fast long-context usage is unsupported', () => {
  const standardLong = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4',
      billing_basis: 'api-token-usd',
      effective_service_tier: 'standard',
      tokens: { input_tokens: 272_000 },
    },
    profile
  );
  assert.equal(standardLong.estimate.contextBand, 'long');
  assert.equal(standardLong.estimate.status, 'priced');

  const fastLong = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4',
      billing_basis: 'api-token-usd',
      effective_service_tier: 'priority',
      tokens: { input_tokens: 272_000 },
    },
    profile
  );
  assert.equal(fastLong.estimate.contextBand, 'long');
  assert.equal(fastLong.estimate.status, 'unsupported');

  const coverage = pricing.summarizeUsageDetailCosts(
    [
      {
        __modelName: 'gpt-5.4',
        billing_basis: 'api-token-usd',
        effective_service_tier: 'standard',
        tokens: { input_tokens: 272_000 },
      },
      {
        __modelName: 'gpt-5.4',
        billing_basis: 'api-token-usd',
        effective_service_tier: 'priority',
        tokens: { input_tokens: 272_000 },
      },
    ],
    profile
  );
  assert.equal(coverage.pricedRequests, 1);
  assert.equal(coverage.unsupportedRequests, 1);
});

test('browser-local API aliases cannot grant an official ChatGPT credit rate', () => {
  const aliasedProfile = {
    ...profile,
    aliases: { 'vendor/unmatched-model': 'gpt-5.4' },
  };
  const estimate = pricing.estimateUsageDetailCost(
    {
      __modelName: 'vendor/unmatched-model',
      billing_basis: 'chatgpt-credits',
      effective_service_tier: 'priority',
      tokens: { input_tokens: 1_000 },
    },
    aliasedProfile
  );
  assert.equal(estimate.estimate.billingBasis, 'chatgpt-credits');
  assert.equal(estimate.estimate.status, 'unmatched');
  assert.equal(estimate.estimate.creditMultiplier, null);
  assert.equal(estimate.estimate.amount, null);

  const standard = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.4',
      billing_basis: 'chatgpt-credits',
      effective_service_tier: 'standard',
      tokens: { input_tokens: 1_000 },
    },
    aliasedProfile
  );
  assert.equal(standard.estimate.status, 'credit-rated');
  assert.equal(standard.estimate.creditMultiplier, 1);

  const officialAlias = pricing.estimateUsageDetailCost(
    {
      __modelName: 'gpt-5.6',
      billing_basis: 'chatgpt-credits',
      effective_service_tier: 'priority',
      tokens: { input_tokens: 1_000 },
    },
    aliasedProfile
  );
  assert.equal(officialAlias.estimate.status, 'credit-rated');
  assert.equal(officialAlias.estimate.creditMultiplier, 2.5);
});
