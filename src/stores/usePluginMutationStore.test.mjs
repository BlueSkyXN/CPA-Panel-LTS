import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

// Behavioural checks for the cross-route plugin mutation lock. The static
// contract test guards the call sites; this one exercises the store itself,
// because the reviewed defects were about lock lifetime, not shape:
// leaving a route must not release an in-flight mutation, coming back must not
// unlock it early, and a connection switch must drop stale registrations.
const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
};
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: createMemoryStorage(),
});
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: createMemoryStorage(),
});

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { usePluginMutationStore } = await vite.ssrLoadModule(
  '/src/stores/usePluginMutationStore.ts'
);
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { pluginsApi, pluginStoreApi } = await vite.ssrLoadModule('/src/services/api/plugins.ts');
const { waitForPluginState, waitForPluginStoreState } = await vite.ssrLoadModule(
  '/src/features/plugins/pluginPolling.ts'
);
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
test.after(async () => {
  await vite.close();
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete globalThis.localStorage;
  if (originalSessionStorage) {
    Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  } else {
    delete globalThis.sessionStorage;
  }
});

const busy = () => {
  const state = usePluginMutationStore.getState();
  const current = apiClient.isCurrentConnection(state.connectionGeneration);
  return {
    installed: current && state.installedTokens.size > 0,
    store: current && state.storeTokens.size > 0,
  };
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

test('401 logout and same-endpoint re-login advance generation and clear stale locks', () => {
  const gen1 = apiClient.setConfig({ apiBase: 'http://core-same', managementKey: 'expired-key' });
  usePluginMutationStore.getState().syncConnection(`${gen1}:p1:http://core-same`);
  const staleStoreToken = usePluginMutationStore.getState().tryBeginStoreMutation();
  assert.ok(staleStoreToken);
  assert.deepEqual(busy(), { installed: false, store: true });

  // Simulate managed-iframe 401 unauthorized logout (no full-page reload).
  useAuthStore.setState({
    isAuthenticated: false,
    profileId: 'p1',
    apiBase: 'http://core-same',
    managementKey: 'expired-key',
    connectionStatus: 'connected',
  });
  useAuthStore.getState().logout('unauthorized');
  assert.deepEqual(busy(), { installed: false, store: false },
    '401 logout must immediately clear stale plugin mutation locks');
  assert.equal(usePluginMutationStore.getState().storeTokens.size, 0);

  // Re-login to the exact same profileId + apiBase with a fresh managementKey.
  const gen2 = apiClient.setConfig({ apiBase: 'http://core-same', managementKey: 'fresh-key' });
  assert.notEqual(gen1, gen2);
  usePluginMutationStore.getState().syncConnection(`${gen2}:p1:http://core-same`);
  assert.deepEqual(busy(), { installed: false, store: false });

  const freshToken = usePluginMutationStore.getState().tryBeginStoreMutation();
  assert.ok(freshToken, 're-authenticated session must not be blocked by the pre-401 lock');
  // Late settle of the pre-401 request must not release the new session's lock.
  usePluginMutationStore.getState().endStoreMutation(staleStoreToken);
  assert.deepEqual(busy(), { installed: false, store: true });
  usePluginMutationStore.getState().endStoreMutation(freshToken);
  assert.deepEqual(busy(), { installed: false, store: false });
});

test('pluginPolling stops immediately and marks results stale when connection generation changes', async (t) => {
  apiClient.setConfig({ apiBase: 'http://core-poll-1', managementKey: 'k1' });
  let storeListCalls = 0;
  t.mock.method(pluginStoreApi, 'list', async () => {
    storeListCalls += 1;
    if (storeListCalls === 1) {
      return {
        pluginsEnabled: true,
        pluginsDir: 'plugins',
        sources: [],
        sourceErrors: [],
        plugins: [{ id: 'demo', sourceId: 'official', installed: false, configured: false }],
      };
    }
    throw new Error('must not issue another store poll after connection generation changes');
  });

  const storePoll = waitForPluginStoreState(
    'demo',
    'official',
    (plugin) => plugin.installed && plugin.configured,
    5_000,
    25
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  apiClient.setConfig({ apiBase: 'http://core-poll-1', managementKey: 'k2' });

  const storeResult = await storePoll;
  assert.equal(storeResult.stale, true, 'superseded store poll must report stale');
  assert.equal(storeResult.timedOut, false);
  assert.equal(storeResult.plugin, null);
  assert.equal(storeListCalls, 1, 'superseded store poll must stop before the next list()');

  let installedListCalls = 0;
  t.mock.method(pluginsApi, 'list', async () => {
    installedListCalls += 1;
    // Simulate connection switch occurring while list() is in flight and rejecting with 401.
    apiClient.clearConfig();
    const unauthorized = new Error('unauthorized');
    unauthorized.status = 401;
    throw unauthorized;
  });

  const installedResult = await waitForPluginState(
    'demo',
    (plugin) => plugin.registered && plugin.effectiveEnabled,
    5_000,
    25
  );
  assert.equal(installedResult.stale, true, 'superseded installed poll rejection must resolve stale');
  assert.equal(installedResult.timedOut, false);
  assert.equal(installedListCalls, 1);
});
