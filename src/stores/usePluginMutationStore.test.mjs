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
  store.syncConnection('profile-a:http://core-a');
  const token = usePluginMutationStore.getState().beginInstalledMutation();
  assert.deepEqual(busy(), { installed: true, store: false });

  // Route round-trip: no component publishes "not busy" on remount.
  usePluginMutationStore.getState().syncConnection('profile-a:http://core-a');
  assert.deepEqual(busy(), { installed: true, store: false },
    're-entering the same connection must not clear an in-flight lock');

  await Promise.resolve();
  assert.deepEqual(busy(), { installed: true, store: false },
    'the lock must outlive the component that started it');

  usePluginMutationStore.getState().endInstalledMutation(token);
  assert.deepEqual(busy(), { installed: false, store: false });
});

test('concurrent mutations each hold their own token', () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-a:http://core-a');
  const first = usePluginMutationStore.getState().beginInstalledMutation();
  const second = usePluginMutationStore.getState().beginInstalledMutation();
  usePluginMutationStore.getState().endInstalledMutation(first);
  assert.deepEqual(busy(), { installed: true, store: false },
    'finishing one mutation must not unlock the other');
  usePluginMutationStore.getState().endInstalledMutation(second);
  assert.deepEqual(busy(), { installed: false, store: false });
});

test('the two routes share one lock namespace', () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-a:http://core-a');
  const installedToken = usePluginMutationStore.getState().beginInstalledMutation();
  const storeToken = usePluginMutationStore.getState().beginStoreMutation();
  assert.deepEqual(busy(), { installed: true, store: true },
    'both directions must be observable at once so each page can gate the other');
  usePluginMutationStore.getState().endStoreMutation(storeToken);
  assert.deepEqual(busy(), { installed: true, store: false });
  usePluginMutationStore.getState().endInstalledMutation(installedToken);
  assert.deepEqual(busy(), { installed: false, store: false });
});

test('a connection switch drops stale locks and ignores their late release', () => {
  const store = usePluginMutationStore.getState();
  store.syncConnection('profile-a:http://core-a');
  const staleToken = usePluginMutationStore.getState().beginStoreMutation();
  assert.deepEqual(busy(), { installed: false, store: true });

  usePluginMutationStore.getState().syncConnection('profile-b:http://core-b');
  assert.deepEqual(busy(), { installed: false, store: false },
    'a new connection must not inherit the previous connection lock');

  // The old request settles after the switch: its release is a no-op.
  usePluginMutationStore.getState().endStoreMutation(staleToken);
  assert.deepEqual(busy(), { installed: false, store: false });

  // And the new connection can start its own mutation immediately.
  const fresh = usePluginMutationStore.getState().beginStoreMutation();
  assert.deepEqual(busy(), { installed: false, store: true });
  usePluginMutationStore.getState().endStoreMutation(fresh);
  assert.deepEqual(busy(), { installed: false, store: false });
});
