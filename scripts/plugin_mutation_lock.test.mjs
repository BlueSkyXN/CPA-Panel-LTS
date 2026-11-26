import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static contract checks for the cross-route plugin mutation lock
// (port of upstream 1e29f88f adapted to the LTS two-route architecture).
const storeSrc = readFileSync('src/stores/usePluginMutationStore.ts', 'utf8');
const authStoreSrc = readFileSync('src/stores/useAuthStore.ts', 'utf8');
const pollingSrc = readFileSync('src/features/plugins/pluginPolling.ts', 'utf8');
const pluginsSrc = readFileSync('src/features/plugins/PluginsPage.tsx', 'utf8');
const storePageSrc = readFileSync('src/features/plugins/PluginStorePage.tsx', 'utf8');

test('shared store keeps token registries for both directions', () => {
  assert.match(storeSrc, /installedTokens: ReadonlySet<string>/, 'installed locks must be token-based');
  assert.match(storeSrc, /storeTokens: ReadonlySet<string>/, 'store locks must be token-based');
  // Acquire must be check+register in one synchronous step, so a second
  // trigger in the same task is refused instead of getting its own token.
  assert.match(storeSrc, /tryBeginInstalledMutation: \(\) => string \| null/,
    'installed-side acquire must be able to refuse');
  assert.match(storeSrc, /tryBeginStoreMutation: \(\) => string \| null/,
    'store-side acquire must be able to refuse');
  assert.match(storeSrc, /endInstalledMutation/, 'installed locks must be released by the mutation');
  assert.match(storeSrc, /endStoreMutation/, 'store locks must be released by the mutation');
});

test('connection switch and 401 logout clear both registries instead of leaving stale locks', () => {
  assert.match(storeSrc, /syncConnection: \(connectionKey = ''\) =>/, 'store must expose connection sync');
  assert.match(
    storeSrc,
    /state\.connectionKey === connectionKey &&\s*state\.connectionGeneration === currentGeneration/,
    'sync must stay idempotent only when both connectionKey and connectionGeneration match'
  );
  assert.ok(
    /installedTokens: new Set<string>\(\),\s*storeTokens: new Set<string>\(\),/.test(storeSrc),
    'connection change must drop both token sets'
  );
  assert.match(authStoreSrc, /usePluginMutationStore\.getState\(\)\.clearLocks\(\);/,
    'auth logout/login must clear plugin mutation locks so managed-iframe 401 re-login starts clean');
  assert.match(pollingSrc, /apiClient\.isCurrentConnection\(expectedGeneration\)/,
    'plugin polling must fence every iteration by connection generation');
});

test('no page publishes lock state from component state', () => {
  for (const [name, src] of [
    ['PluginsPage', pluginsSrc],
    ['PluginStorePage', storePageSrc],
  ]) {
    assert.doesNotMatch(src, /setInstalledBusy|setStoreBusy/,
      `${name} must not mirror component state into the shared lock`);
    assert.match(src, /const connectionKey = `\$\{connectionGeneration\}:\$\{profileId\}:\$\{apiBase\}`;/,
      `${name} must bind connectionKey to connectionGeneration`);
    assert.match(src, /syncPluginMutationConnection\(connectionKey\)/,
      `${name} must sync the shared lock to the current connection`);
  }
});

test('every installed mutation acquires the lock and bails out when refused', () => {
  const acquires = pluginsSrc.match(/const token = acquireInstalledMutation\(\);/g) ?? [];
  assert.ok(acquires.length >= 4,
    `delete/toggle/config-open/config-save must all acquire the lock (found ${acquires.length})`);
  const refusals = pluginsSrc.match(/if \(!token\) return;/g) ?? [];
  assert.ok(refusals.length >= acquires.length,
    'every acquire site must return without sending a request when refused');
  assert.match(pluginsSrc,
    /const handleTogglePlugin = async[\s\S]{0,240}?if \(!connected \|\| mutatingID \|\| openingConfigID \|\| deletingID \|\| storeBusy\) return;/,
    'toggle must share the full mutation guard');
  // The delete confirmation must take the lock BEFORE touching busy state,
  // otherwise the refused second click still clears the first one's UI state.
  assert.match(pluginsSrc,
    /onConfirm: async \(\) => \{[\s\S]{0,300}?const token = acquireInstalledMutation\(\);\s*if \(!token\) return;\s*setDeletingID/,
    'delete confirmation must acquire before setting busy state');
});

test('PluginStorePage blocks installs on both shared locks and keeps modals open when refused', () => {
  assert.match(storePageSrc, /const installBlocked = !connected \|\| installedBusy \|\| storeBusy/,
    'install entry must be blocked by installed mutations and by an in-flight store install');
  assert.match(storePageSrc, /const mutationToken = tryBeginStoreMutation\(\);/,
    'the store install must acquire the shared lock and be able to refuse');
  assert.match(storePageSrc, /if \(!mutationToken\) return false;/,
    'a refused store install must return false without sending the request');
  assert.match(storePageSrc, /endStoreMutation\(mutationToken\);/,
    'the token must be released only when the install settles');
  for (const anchor of [
    'if (installBlocked) return false;',
    'if (installBlocked) return;',
    'if (installBlocked || !installOptionsEntry) return;',
    'if (installBlocked || !gateEntry) return;',
    'if (!completed) return;',
  ]) {
    assert.ok(storePageSrc.includes(anchor), `missing gate: ${anchor}`);
  }
  assert.equal(
    (storePageSrc.match(/if \(!completed\) return;/g) ?? []).length,
    2,
    'both install options modal and gate modal must only close when runInstall returns true'
  );
  assert.match(storePageSrc, /const hasPendingInstall = Boolean\(installingKey\) \|\| storeBusy;/,
    'row actions must treat an in-flight store install as pending even after remount');
});
