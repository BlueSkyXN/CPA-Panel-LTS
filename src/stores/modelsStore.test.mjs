import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { modelsApi } = await vite.ssrLoadModule('/src/services/api/models.ts');
const { useModelsStore: store } = await vite.ssrLoadModule('/src/stores/useModelsStore.ts');
const originalFetch = modelsApi.fetchModels;
test.afterEach(() => { modelsApi.fetchModels = originalFetch; store.getState().clearCache(); });
test.after(() => vite.close());

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('clear invalidates pending success without changing its caller result', async () => {
  const request = deferred();
  modelsApi.fetchModels = () => request.promise;
  const pending = store.getState().fetchModels('https://old.invalid');
  store.getState().clearCache();
  request.resolve([{ name: 'old' }]);
  assert.deepEqual(await pending, [{ name: 'old' }]);
  const { models, cache, loading, error } = store.getState();
  assert.deepEqual({ models, cache, loading, error }, { models: [], cache: null, loading: false, error: null });
});

for (const fails of [false, true]) {
  test(`older ${fails ? 'failure' : 'success'} cannot overwrite the current request`, async () => {
    const old = deferred(), current = deferred();
    let calls = 0;
    modelsApi.fetchModels = () => (++calls === 1 ? old.promise : current.promise);
    const pending = store.getState().fetchModels('https://old.invalid');
    const next = store.getState().fetchModels('https://new.invalid');
    if (fails) {
      const rejected = assert.rejects(pending, /old failure/);
      old.reject(new Error('old failure'));
      await rejected;
    } else {
      old.resolve([{ name: 'old' }]);
      await pending;
    }
    assert.equal(store.getState().loading, true);
    assert.equal(store.getState().error, null);
    current.resolve([{ name: 'new' }]);
    await next;
    assert.deepEqual(store.getState().models, [{ name: 'new' }]);
    assert.equal(store.getState().cache.apiBase, 'https://new.invalid');
  });
}

test('cache hit supersedes pending refresh and clears loading', async () => {
  const request = deferred();
  let calls = 0;
  modelsApi.fetchModels = () => ++calls === 1 ? Promise.resolve([{ name: 'cached' }]) : request.promise;
  await store.getState().fetchModels('https://cache.invalid');
  const pending = store.getState().fetchModels('https://cache.invalid', undefined, true);
  await store.getState().fetchModels('https://cache.invalid');
  assert.equal(store.getState().loading, false);
  request.resolve([{ name: 'stale' }]);
  await pending;
  assert.deepEqual(store.getState().models, [{ name: 'cached' }]);
});

test('current failure remains observable and clear resets it', async () => {
  modelsApi.fetchModels = async () => { throw new Error('active failure'); };
  await assert.rejects(store.getState().fetchModels('https://test.invalid'), /active failure/);
  assert.equal(store.getState().error, 'active failure');
  store.getState().clearCache();
  assert.equal(store.getState().error, null);
});
