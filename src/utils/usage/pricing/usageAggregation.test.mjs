import assert from 'node:assert/strict';
import test from 'node:test';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: [new URL('../../usage.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  target: 'es2020',
});
const usage = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

test('usage parsing ignores legacy server metadata and prices complete token records', () => {
  const ignoredLegacyField = ['billing', 'basis'].join('_');
  const fixture = {
    total_requests: 2,
    total_tokens: 2_000,
    apis: {
      'POST /v1/responses': {
        total_requests: 2,
        total_tokens: 2_000,
        models: {
          'gpt-5.6-sol': {
            total_requests: 2,
            total_tokens: 2_000,
            details: [
              {
                timestamp: '2026-07-21T00:00:00Z',
                effective_service_tier: 'standard',
                [ignoredLegacyField]: 'legacy-value',
                tokens: { input_tokens: 1_000, total_tokens: 1_000 },
              },
              {
                timestamp: '2026-07-21T00:01:00Z',
                effective_service_tier: 'priority',
                tokens: { input_tokens: 1_000, total_tokens: 1_000 },
              },
            ],
          },
        },
      },
    },
  };

  const details = usage.collectUsageDetails(fixture);
  assert.equal(details.length, 2);
  assert.equal(ignoredLegacyField in details[0], false);
  const coverage = usage.calculatePricingCoverage(fixture);
  assert.equal(coverage.totalRequests, 2);
  assert.equal(coverage.pricedRequests, 2);
  assert.equal(coverage.pricedTokens, 2_000);
  assert.equal(coverage.pricedRequestRatio, 1);
  assert.equal(usage.isLocalEstimateComplete(coverage), true);
});

test('aggregate-only gaps remain incomplete without inventing a second pricing domain', () => {
  const fixture = {
    total_requests: 2,
    total_tokens: 2_000_000,
    apis: {
      'POST /v1/responses': {
        total_requests: 2,
        total_tokens: 2_000_000,
        models: {
          'gpt-5.4-mini': {
            total_requests: 2,
            total_tokens: 2_000_000,
            details: [
              {
                timestamp: '2026-07-21T00:00:00Z',
                tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
              },
            ],
          },
        },
      },
    },
  };
  const coverage = usage.calculatePricingCoverage(fixture);
  assert.equal(coverage.totalRequests, 2);
  assert.equal(coverage.pricedRequests, 1);
  assert.equal(coverage.totalTokens, 2_000_000);
  assert.equal(coverage.pricedTokens, 1_000_000);
  assert.equal(usage.isLocalEstimateComplete(coverage), false);
  assert.equal(usage.hasPricingAnomaly(coverage), true);
});

test('hourly, and daily pricing share one amount derived from the same token records', () => {
  const now = new Date();
  const current = now.toISOString();
  const previous = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const fixture = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.4-mini': {
            details: [
              {
                timestamp: previous,
                tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
              },
              {
                timestamp: current,
                effective_service_tier: 'priority',
                tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
              },
            ],
          },
        },
      },
    },
  };
  const total = usage.calculateTotalCost(fixture);
  const hourly = usage.buildHourlyCostSeries(fixture, undefined, 2);
  const daily = usage.buildDailyCostSeries(fixture);
  assert.equal(hourly.data.reduce((sum, amount) => sum + amount, 0), total);
  assert.equal(daily.data.reduce((sum, amount) => sum + amount, 0), total);
});
