import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

// Behavioural checks for the cross-route plugin mutation lock. The static
// contract test guards the call sites; this one exercises the store itself,
// because the reviewed defects were about lock lifetime, not shape:
// leaving a route must not release an in-flight mutation, coming back must not
// unlock it early, and a connection switch must drop stale registrations.
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { usePluginMutationStore } = await vite.ssrLoadModule(
  '/src/stores/usePluginMutationStore.ts'
);
test.after(() => vite.close());

const busy = () => {
  const state = usePluginMutationStore.getState();
  return { installed: state.installedTokens.size > 0, store: state.storeTokens.size > 0 };
};

test('a mutation keeps the lock until it settles, not until its component unmounts', async () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-lifetime:http://core');
  const token = usePluginMutationStore.getState().tryBeginInstalledMutation();
  assert.deepEqual(busy(), { installed: true, store: false });

  // Route round-trip: no component publishes "not busy" on remount.
  usePluginMutationStore.getState().syncConnection('profile-lifetime:http://core');
  assert.deepEqual(busy(), { installed: true, store: false },
    're-entering the same connection must not clear an in-flight lock');

  await Promise.resolve();
  assert.deepEqual(busy(), { installed: true, store: false },
    'the lock must outlive the component that started it');

  usePluginMutationStore.getState().endInstalledMutation(token);
  assert.deepEqual(busy(), { installed: false, store: false });
});

test('a second synchronous acquire is refused while the first is in flight', () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-sync:http://core');
  // The reviewed defect: two clicks dispatched in one task each got a token,
  // so the delete confirmation issued two DELETE requests.
  const first = usePluginMutationStore.getState().tryBeginInstalledMutation();
  const second = usePluginMutationStore.getState().tryBeginInstalledMutation();
  assert.ok(first, 'the first acquire must succeed');
  assert.equal(second, null, 'the second acquire in the same task must be refused');
  assert.equal(usePluginMutationStore.getState().installedTokens.size, 1,
    'exactly one token may be registered');

  usePluginMutationStore.getState().endInstalledMutation(first);
  assert.deepEqual(busy(), { installed: false, store: false });
  assert.ok(usePluginMutationStore.getState().tryBeginInstalledMutation(),
    'a settled mutation releases the lock for the next attempt');
});

test('the two routes share one lock namespace', () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-shared:http://core');
  const installedToken = usePluginMutationStore.getState().tryBeginInstalledMutation();
  assert.ok(installedToken, 'installed-side acquire must succeed');
  assert.equal(usePluginMutationStore.getState().tryBeginStoreMutation(), null,
    'a store install must be refused while an installed-page mutation runs');
  usePluginMutationStore.getState().endInstalledMutation(installedToken);

  const storeToken = usePluginMutationStore.getState().tryBeginStoreMutation();
  assert.ok(storeToken, 'store-side acquire must succeed once the other side is free');
  assert.equal(usePluginMutationStore.getState().tryBeginInstalledMutation(), null,
    'an installed-page mutation must be refused while a store install runs');
  usePluginMutationStore.getState().endStoreMutation(storeToken);
  assert.deepEqual(busy(), { installed: false, store: false });
});

test('a connection switch drops stale locks and ignores their late release', () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-old:http://core-old');
  const staleToken = usePluginMutationStore.getState().tryBeginStoreMutation();
  assert.deepEqual(busy(), { installed: false, store: true });

  usePluginMutationStore.getState().syncConnection('profile-new:http://core-new');
  assert.deepEqual(busy(), { installed: false, store: false },
    'a new connection must not inherit the previous connection lock');

  // The old request settles after the switch: its release is a no-op.
  usePluginMutationStore.getState().endStoreMutation(staleToken);
  assert.deepEqual(busy(), { installed: false, store: false });

  // And the new connection can start its own mutation immediately.
  const fresh = usePluginMutationStore.getState().tryBeginStoreMutation();
  assert.deepEqual(busy(), { installed: false, store: true });
  usePluginMutationStore.getState().endStoreMutation(fresh);
  assert.deepEqual(busy(), { installed: false, store: false });
});
