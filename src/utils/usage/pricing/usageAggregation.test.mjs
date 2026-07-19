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

const now = new Date();
const timestamps = [1, 2, 3, 4].map((minutesAgo) =>
  new Date(now.getTime() - minutesAgo * 60_000).toISOString()
);

const fixture = {
  total_requests: 4,
  success_count: 3,
  failure_count: 1,
  total_tokens: 2_272_010,
  apis: {
    'POST /v1/responses': {
      total_requests: 4,
      success_count: 3,
      failure_count: 1,
      total_tokens: 2_272_010,
      models: {
        'gpt-5.4-mini': {
          total_requests: 2,
          success_count: 2,
          failure_count: 0,
          total_tokens: 2_000_000,
          details: [
            {
              timestamp: timestamps[0],
              effective_service_tier: 'standard',
              tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
              failed: false,
            },
            {
              timestamp: timestamps[1],
              effective_service_tier: 'priority',
              tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
              failed: false,
            },
          ],
        },
        'gpt-5.4': {
          total_requests: 1,
          success_count: 0,
          failure_count: 1,
          total_tokens: 272_000,
          details: [
            {
              timestamp: timestamps[2],
              effective_service_tier: 'priority',
              tokens: { input_tokens: 272_000, total_tokens: 272_000 },
              failed: true,
            },
          ],
        },
        'vendor/unmatched-model': {
          total_requests: 1,
          success_count: 1,
          failure_count: 0,
          total_tokens: 10,
          details: [
            {
              timestamp: timestamps[3],
              effective_service_tier: 'standard',
              tokens: { input_tokens: 10, total_tokens: 10 },
              failed: false,
            },
          ],
        },
      },
    },
  },
};

test('total, API, model, hourly, and daily pricing share one amount and coverage contract', () => {
  const coverage = usage.calculatePricingCoverage(fixture);
  assert.equal(coverage.totalRequests, 4);
  assert.equal(coverage.pricedRequests, 2);
  assert.equal(coverage.unmatchedRequests, 1);
  assert.equal(coverage.unsupportedRequests, 1);
  assert.equal(coverage.totalModels, 3);
  assert.equal(coverage.pricedModels, 1);
  assert.equal(coverage.estimatedAmount, 2.25);
  assert.equal(usage.calculateTotalCost(fixture), 2.25);

  const apiStats = usage.getApiStats(fixture);
  assert.equal(apiStats.length, 1);
  assert.deepEqual(apiStats[0].pricingCoverage, coverage);
  assert.equal(apiStats[0].totalCost, 2.25);

  const modelStats = usage.getModelStats(fixture);
  assert.equal(
    modelStats.reduce((sum, item) => sum + item.cost, 0),
    2.25
  );
  assert.equal(
    modelStats.reduce((sum, item) => sum + item.pricingCoverage.pricedRequests, 0),
    coverage.pricedRequests
  );
  assert.equal(
    modelStats.reduce((sum, item) => sum + item.pricingCoverage.unsupportedRequests, 0),
    coverage.unsupportedRequests
  );
  assert.equal(
    modelStats.reduce((sum, item) => sum + item.pricingCoverage.unmatchedRequests, 0),
    coverage.unmatchedRequests
  );

  const hourly = usage.buildHourlyCostSeries(fixture, undefined, 2);
  assert.equal(
    hourly.data.reduce((sum, amount) => sum + amount, 0),
    2.25
  );
  assert.deepEqual(hourly.pricingCoverage, coverage);

  const daily = usage.buildDailyCostSeries(fixture);
  assert.equal(
    daily.data.reduce((sum, amount) => sum + amount, 0),
    2.25
  );
  assert.deepEqual(daily.pricingCoverage, coverage);
});
