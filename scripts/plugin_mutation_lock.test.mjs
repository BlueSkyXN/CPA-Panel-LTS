import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static contract checks for the cross-route plugin mutation lock
// (port of upstream 1e29f88f adapted to the LTS two-route architecture).
const storeSrc = readFileSync('src/stores/usePluginMutationStore.ts', 'utf8');
const pluginsSrc = readFileSync('src/features/plugins/PluginsPage.tsx', 'utf8');
const storePageSrc = readFileSync('src/features/plugins/PluginStorePage.tsx', 'utf8');

test('shared store exposes both busy directions', () => {
  assert.match(storeSrc, /installedBusy: boolean/, 'store must track installed-page mutations');
  assert.match(storeSrc, /storeBusy: boolean/, 'store must track store-page installs');
});

test('PluginsPage publishes installed mutations and gates on storeBusy', () => {
  assert.match(pluginsSrc, /setInstalledBusy\(Boolean\(mutatingID \|\| openingConfigID \|\| deletingID\)\)/,
    'installed-page trio must publish to the shared store');
  const gated = pluginsSrc.match(/storeBusy\) return;/g) ?? [];
  assert.ok(gated.length >= 3, `mutation guards must include storeBusy (found ${gated.length})`);
});

test('PluginStorePage publishes installs and blocks on installedBusy', () => {
  assert.match(storePageSrc, /setStoreBusy\(Boolean\(installingKey\)\)/,
    'installingKey must publish to the shared store');
  assert.match(storePageSrc, /const installBlocked = !connected \|\| installedBusy \|\| Boolean\(installingKey\)/,
    'install entry must be blocked while installed-page mutations run');
  for (const anchor of [
    'if (installBlocked) return;',
    'if (installBlocked || !installOptionsEntry) return;',
    'if (installBlocked || !gateEntry) return;',
  ]) {
    assert.ok(storePageSrc.includes(anchor), `missing gate: ${anchor}`);
  }
  assert.match(storePageSrc, /installedBusy \|\| \(hasPendingInstall && !isInstalling\)/,
    'row action must disable during installed-page mutations');
});
