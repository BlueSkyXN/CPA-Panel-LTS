import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadTypeScript } from './testTypeScript.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pricing = loadTypeScript(path.join(root, 'src/utils/usage/pricing/index.ts'));
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/usage-pricing-smoke.json', import.meta.url), 'utf8'));

for (const [name, fixture] of Object.entries(fixtures)) {
  test(`browser pricing fixture ${name}: matching and preserved overrides agree with the actual catalog`, () => {
    const inputBefore = JSON.stringify(fixture.profile);
    const { profile, warnings } = name === 'v2'
      ? pricing.migrateModelPricesV2ToV3(fixture.profile)
      : pricing.normalizePriceProfileV3(fixture.profile);
    assert.deepEqual(warnings ?? [], [], `${name}: fixture must not need repairs`);
    const before = JSON.stringify(profile);
    const recovery = pricing.restorePresetEquivalentOverrides(profile);
    assert.deepEqual(recovery.restoredModels.sort(), [...fixture.matchingModels].sort(),
      `${name}: smoke recovery fixture is stale relative to catalog; update its rates or expected models`);
    assert.deepEqual(Object.keys(recovery.profile.overrides).sort(), [...fixture.preservedModels].sort());
    for (const model of fixture.preservedModels) {
      assert.deepEqual(recovery.profile.overrides[model], profile.overrides[model]);
      assert.equal(pricing.resolvePriceProfile(model, recovery.profile).modelMatch, 'custom');
    }
    for (const model of fixture.matchingModels) {
      const resolved = pricing.resolvePriceProfile(model, recovery.profile);
      const catalog = pricing.findCatalogEntry(model);
      assert.equal(resolved.modelMatch, 'preset');
      assert.deepEqual(resolved.standard, catalog.standard);
      assert.deepEqual(resolved.fast, catalog.fast);
    }
    assert.equal(JSON.stringify(profile), before, 'Discovery/cancellation must not mutate the saved profile');
    assert.equal(JSON.stringify(fixture.profile), inputBefore, 'Migration must not mutate the fixture');
  });
}

test('Sol V2 Auto cache-write is not equivalent to an explicit preset cache-write rate', () => {
  const { profile } = pricing.migrateModelPricesV2ToV3(fixtures.v2.profile);
  const rates = profile.overrides['gpt-5.6-sol'].standard.short;
  const preset = pricing.findCatalogEntry('gpt-5.6-sol').standard.short;
  assert.equal(rates.cacheWrite, undefined);
  assert.notEqual(rates.input, preset.cacheWrite);
});

test('saved pre-update Sol rates remain unchanged and explicitly custom', () => {
  const { profile } = pricing.normalizePriceProfileV3(fixtures.savedOldSol.profile);
  assert.deepEqual(profile.overrides['gpt-5.6-sol'].standard.short,
    { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 });
  assert.equal(pricing.restorePresetEquivalentOverrides(profile).profile, profile);
});
