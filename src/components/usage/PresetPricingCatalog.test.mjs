import assert from 'node:assert/strict';
import test from 'node:test';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: [new URL('./presetPricingCatalogUtils.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  target: 'es2020',
});
const catalogUi = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

const explicitRates = {
  input: 10,
  cachedInput: 1,
  cacheWrite: 12.5,
  output: 40,
};

const entry = (longSupported) => ({
  canonicalModel: 'synthetic-explicit-fast',
  aliases: [],
  currency: 'USD',
  standard: {
    short: { input: 5, cachedInput: 0.5, output: 20 },
    long: {
      thresholdTokens: 272_000,
      basis: 'inputTokens',
      appliesTo: 'entireRequest',
      rates: { input: 10, cachedInput: 1, output: 30 },
    },
  },
  fast: { short: explicitRates, longSupported },
  sourceUrl: 'https://example.invalid/pricing',
  asOf: '2026-07-20',
});

test('explicit Fast catalog cards expose every rate in each supported context band', () => {
  assert.deepEqual(catalogUi.getCatalogExplicitFastRates(entry(true), 'short'), explicitRates);
  assert.deepEqual(catalogUi.getCatalogExplicitFastRates(entry(true), 'long'), explicitRates);
  assert.equal(catalogUi.getCatalogExplicitFastRates(entry(false), 'long'), null);
});

test('multiplier Fast catalog cards do not masquerade as explicit rates', () => {
  const multiplierEntry = {
    ...entry(false),
    fast: { multiplier: 2, longSupported: false },
  };
  assert.equal(catalogUi.getCatalogExplicitFastRates(multiplierEntry, 'short'), null);
});
