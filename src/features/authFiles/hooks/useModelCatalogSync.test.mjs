import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
await i18n.changeLanguage('en');
const { useModelCatalogSync } = await vite.ssrLoadModule(
  '/src/features/authFiles/hooks/useModelCatalogSync.ts'
);
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { modelsApi } = await vite.ssrLoadModule('/src/services/api/models.ts');
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
const { useNotificationStore } = await vite.ssrLoadModule('/src/stores/useNotificationStore.ts');
const { useModelsStore } = await vite.ssrLoadModule('/src/stores/useModelsStore.ts');

function controls(onSynced) {
  let result;
  let syncedArgs = null;
  function Probe() {
    result = useModelCatalogSync((...args) => {
      syncedArgs = args;
      onSynced?.(...args);
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return { result, synced: () => syncedArgs };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test.beforeEach(() => {
  useAuthStore.setState({ connectionStatus: 'connected' });
});

test('a changed catalog clears caches, syncs views and reports providers', async (t) => {
  t.mock.method(modelsApi, 'refreshCatalog', async () => ({
    stale: false,
    changedProviders: ['gemini', 'codex'],
  }));
  const clear = t.mock.method(useModelsStore.getState(), 'clearCache', () => {});
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const { result, synced } = controls();
  assert.equal(result.syncingModelCatalog, false);
  await result.syncModelCatalog();
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(synced() !== null, true);
  assert.equal(notify.mock.callCount(), 1);
  assert.equal(notify.mock.calls[0].arguments[1], 'success');
  assert.match(notify.mock.calls[0].arguments[0], /gemini, codex/);
});

test('an unchanged catalog reports no-change without provider list', async (t) => {
  t.mock.method(modelsApi, 'refreshCatalog', async () => ({ stale: false, changedProviders: [] }));
  t.mock.method(useModelsStore.getState(), 'clearCache', () => {});
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const { result, synced } = controls();
  await result.syncModelCatalog();
  assert.equal(synced() !== null, true);
  assert.equal(notify.mock.callCount(), 1);
  assert.doesNotMatch(notify.mock.calls[0].arguments[0], /gemini/);
});

test('failures surface an error notification and do not sync views', async (t) => {
  t.mock.method(modelsApi, 'refreshCatalog', async () => {
    throw new Error('upstream unavailable');
  });
  const clear = t.mock.method(useModelsStore.getState(), 'clearCache', () => {});
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const { result, synced } = controls();
  await result.syncModelCatalog();
  assert.equal(clear.mock.callCount(), 0);
  assert.equal(synced(), null);
  assert.equal(notify.mock.callCount(), 1);
  assert.equal(notify.mock.calls[0].arguments[1], 'error');
  assert.match(notify.mock.calls[0].arguments[0], /upstream unavailable/);
});

test('a stale response from a superseded connection is dropped entirely', async (t) => {
  t.mock.method(modelsApi, 'refreshCatalog', async () => ({
    stale: true,
    changedProviders: ['gemini'],
  }));
  const clear = t.mock.method(useModelsStore.getState(), 'clearCache', () => {});
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const { result, synced } = controls();
  await result.syncModelCatalog();
  assert.equal(clear.mock.callCount(), 0);
  assert.equal(synced(), null);
  assert.equal(notify.mock.callCount(), 0);
});

test('repeat triggers while in flight issue a single request', async (t) => {
  const response = deferred();
  const refresh = t.mock.method(modelsApi, 'refreshCatalog', () => response.promise);
  t.mock.method(useModelsStore.getState(), 'clearCache', () => {});
  t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const { result } = controls();
  const first = result.syncModelCatalog();
  const second = result.syncModelCatalog();
  response.resolve({ stale: false, changedProviders: [] });
  await Promise.all([first, second]);
  assert.equal(refresh.mock.callCount(), 1);
});

test('a disconnected connection never issues the request', async (t) => {
  useAuthStore.setState({ connectionStatus: 'disconnected' });
  const refresh = t.mock.method(modelsApi, 'refreshCatalog', async () => ({
    stale: false,
    changedProviders: ['gemini'],
  }));
  const { result } = controls();
  await result.syncModelCatalog();
  assert.equal(refresh.mock.callCount(), 0);
});

test('switching connection generation allows a new catalog sync while an older one is still in flight', async (t) => {
  const firstResponse = deferred();
  const secondResponse = deferred();
  let call = 0;
  const refresh = t.mock.method(modelsApi, 'refreshCatalog', () => {
    call += 1;
    return call === 1 ? firstResponse.promise : secondResponse.promise;
  });
  const clear = t.mock.method(useModelsStore.getState(), 'clearCache', () => {});
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});

  apiClient.setConfig({ apiBase: 'http://core-same', managementKey: 'key-1' });
  const { result, synced } = controls();
  const first = result.syncModelCatalog();

  // Switch credentials on the same endpoint while the first sync is still pending.
  apiClient.setConfig({ apiBase: 'http://core-same', managementKey: 'key-2' });
  const second = result.syncModelCatalog();
  assert.equal(refresh.mock.callCount(), 2, 'new connection generation must not be blocked by stale pendingRef');

  // Old request settles late and must not clobber the active second request.
  firstResponse.resolve({ stale: true, changedProviders: ['codex'] });
  await first;
  assert.equal(clear.mock.callCount(), 0);
  assert.equal(notify.mock.callCount(), 0);

  // Repeat trigger on the new connection while second is still in flight is still deduplicated.
  await result.syncModelCatalog();
  assert.equal(refresh.mock.callCount(), 2);

  secondResponse.resolve({ stale: false, changedProviders: ['claude'] });
  await second;
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(synced() !== null, true);
  assert.equal(notify.mock.callCount(), 1);
  assert.match(notify.mock.calls[0].arguments[0], /claude/);
});
