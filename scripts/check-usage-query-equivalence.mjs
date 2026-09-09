import assert from 'node:assert/strict';
import { build } from 'esbuild';

const entry = `export * from './src/utils/usage.ts'; export * from './src/utils/usage/queryView.ts';`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const utils = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);
let input = '';
for await (const chunk of process.stdin) input += chunk;
const data = JSON.parse(input);
const profile = data.profile ?? utils.createDefaultPriceProfileV3();
if (process.argv.includes('--rules')) {
  process.stdout.write(JSON.stringify(utils.buildQueryPriceRules(data.models, profile)));
} else {
  const now = data.summary.now_ms;
  const raw = data.window
    ? utils.filterUsageByTimeRange(data.snapshot, data.window, now)
    : data.snapshot;
  const view = utils.makeUsageQueryView(data.summary, data.pricing);
  const close = (actual, expected, path = 'result') => {
    if (typeof expected === 'number') {
      assert.ok(
        Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-12),
        `${path}: ${actual} != ${expected}`
      );
    } else if (Array.isArray(expected)) {
      assert.equal(actual.length, expected.length, `${path}.length`);
      expected.forEach((v, i) => close(actual[i], v, `${path}[${i}]`));
    } else if (expected && typeof expected === 'object') {
      for (const [k, v] of Object.entries(expected)) close(actual[k], v, `${path}.${k}`);
    } else assert.equal(actual, expected, path);
  };
  close(view.total_requests, raw.total_requests);
  close(utils.calculateTokenBreakdown(view), utils.calculateTokenBreakdown(raw));
  close(utils.calculateLatencyStats(view), utils.calculateLatencyStats(raw));
  close(
    utils.calculatePricingCoverage(view, profile),
    utils.calculatePricingCoverage(raw, profile)
  );
  const sorted = (rows, key) => rows.sort((a, b) => a[key].localeCompare(b[key]));
  close(
    sorted(utils.getApiStats(view, profile), 'endpoint'),
    sorted(utils.getApiStats(raw, profile), 'endpoint')
  );
  close(
    sorted(utils.getModelStats(view, profile), 'model'),
    sorted(utils.getModelStats(raw, profile), 'model')
  );
  close(
    sorted(utils.getPricingModelSummaries(view, profile), 'modelName'),
    sorted(utils.getPricingModelSummaries(raw, profile), 'modelName')
  );
  close(utils.buildDailyTokenBreakdown(view), utils.buildDailyTokenBreakdown(raw));
  close(utils.buildDailyCostSeries(view, profile), utils.buildDailyCostSeries(raw, profile));
  if (data.window) {
    close(
      utils.buildHourlyTokenBreakdown(view, data.window),
      utils.buildHourlyTokenBreakdown(raw, data.window)
    );
    close(
      utils.buildHourlyCostSeries(view, profile, data.window),
      utils.buildHourlyCostSeries(raw, profile, data.window)
    );
  }
  close(
    utils.queryKeyStats(data.summary),
    utils.computeKeyStatsFromDetails(utils.collectUsageDetails(raw))
  );
  process.stdout.write(JSON.stringify({ requests: view.total_requests, equivalent: true }));
}
