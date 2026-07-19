import assert from 'node:assert/strict';
import test from 'node:test';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: [new URL('./storage.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  target: 'es2020',
});
const pricingStorage = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    values,
  };
};

test('v3 profile wins and corrupt v3 never falls back to v2', () => {
  const validV3 = {
    schemaVersion: 3,
    currency: 'USD',
    assumptions: { historicalPricing: 'current', unknownServiceTier: 'standard' },
    aliases: {},
    overrides: {
      custom: { standard: { short: { input: 1, cachedInput: 0.1, output: 2 } } },
    },
  };
  const legacyV2 = JSON.stringify({ legacy: { prompt: 10, completion: 20, cache: 1 } });
  const validStorage = createStorage({
    [pricingStorage.PRICE_PROFILE_STORAGE_KEY]: JSON.stringify(validV3),
    [pricingStorage.LEGACY_MODEL_PRICE_STORAGE_KEY]: legacyV2,
  });

  const loaded = pricingStorage.loadPriceProfileV3(validStorage);
  assert.equal(loaded.source, 'v3');
  assert.ok(loaded.profile.overrides.custom);
  assert.equal(loaded.profile.overrides.legacy, undefined);

  const corruptStorage = createStorage({
    [pricingStorage.PRICE_PROFILE_STORAGE_KEY]: '{not-json',
    [pricingStorage.LEGACY_MODEL_PRICE_STORAGE_KEY]: legacyV2,
  });
  const corrupt = pricingStorage.loadPriceProfileV3(corruptStorage);
  assert.equal(corrupt.source, 'v3');
  assert.deepEqual(corrupt.profile.overrides, {});
  assert.deepEqual(corrupt.warnings, ['profile-json-invalid']);
});

test('v2 profile migrates in memory without eagerly writing the v3 key', () => {
  const storage = createStorage({
    [pricingStorage.LEGACY_MODEL_PRICE_STORAGE_KEY]: JSON.stringify({
      auto: { prompt: 10, completion: 20, cache: 1 },
      free: { prompt: 10, completion: 20, cache: 1, cacheWrite: 0 },
    }),
  });

  const loaded = pricingStorage.loadPriceProfileV3(storage);
  assert.equal(loaded.source, 'v2');
  assert.equal(storage.getItem(pricingStorage.PRICE_PROFILE_STORAGE_KEY), null);
  assert.equal(Object.hasOwn(loaded.profile.overrides.auto.standard.short, 'cacheWrite'), false);
  assert.equal(loaded.profile.overrides.free.standard.short.cacheWrite, 0);
});

test('save and reset write only v3 and preserve the v2 rollback copy', () => {
  const legacy = JSON.stringify({ legacy: { prompt: 10, completion: 20, cache: 1 } });
  const storage = createStorage({ [pricingStorage.LEGACY_MODEL_PRICE_STORAGE_KEY]: legacy });
  const migrated = pricingStorage.loadPriceProfileV3(storage).profile;

  assert.equal(pricingStorage.savePriceProfileV3(migrated, storage), true);
  assert.ok(storage.getItem(pricingStorage.PRICE_PROFILE_STORAGE_KEY));
  assert.equal(storage.getItem(pricingStorage.LEGACY_MODEL_PRICE_STORAGE_KEY), legacy);

  const reset = pricingStorage.resetPriceProfileV3(storage);
  assert.deepEqual(reset.overrides, {});
  assert.deepEqual(reset.aliases, {});
  assert.equal(storage.getItem(pricingStorage.LEGACY_MODEL_PRICE_STORAGE_KEY), legacy);
  assert.deepEqual(
    JSON.parse(storage.getItem(pricingStorage.PRICE_PROFILE_STORAGE_KEY)).overrides,
    {}
  );
});
