import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
globalThis.window = new EventTarget();
globalThis.window.location = { host: 'query-test.example.test' };
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const api = await vite.ssrLoadModule('/src/services/api/usageQuery.ts');
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
const { useUsageQueryStore } = await vite.ssrLoadModule('/src/stores/useUsageQueryStore.ts');
const get = apiClient.get;
const capabilities = api.usageQueryApi.capabilities;
const session = {
  version: 1,
  bound: 'synthetic-bound',
  now_ms: 1800000000000,
  models: ['test-model'],
  max_page_size: 200,
};
test.after(async () => {
  apiClient.get = get;
  api.usageQueryApi.capabilities = capabilities;
  await vite.close();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

test('capabilities require the supported version and a fixed boundary', () => {
  assert.deepEqual(api.decodeUsageQuerySession(session), session);
  assert.throws(() => api.decodeUsageQuerySession({ ...session, version: 2 }));
  assert.throws(() => api.decodeUsageQuerySession({ ...session, bound: '' }));
});
test('only a missing capability plus a working legacy management endpoint enables fallback', async () => {
  useAuthStore.setState({
    apiBase: 'https://query-test.example.test',
    managementKey: 'synthetic-query-test',
  });
  const paths = [];
  api.usageQueryApi.capabilities = async () => {
    throw Object.assign(new Error('not found'), { status: 404 });
  };
  apiClient.get = async (path) => {
    paths.push(path);
    return { 'usage-statistics-enabled': true };
  };
  await useUsageQueryStore.getState().load(true);
  assert.equal(useUsageQueryStore.getState().mode, 'legacy');
  assert.deepEqual(paths, ['/usage-statistics-enabled']);
  paths.length = 0;
  api.usageQueryApi.capabilities = async () => {
    throw Object.assign(new Error('unavailable'), { status: 503 });
  };
  await assert.rejects(useUsageQueryStore.getState().load(true));
  assert.equal(useUsageQueryStore.getState().mode, 'error');
  assert.deepEqual(paths, []);
  api.usageQueryApi.capabilities = async () => session;
  await useUsageQueryStore.getState().load(true);
  assert.equal(useUsageQueryStore.getState().mode, 'query');
  assert.deepEqual(paths, []);
});

test('an obsolete connection cannot publish its capability response', async () => {
  let finish;
  api.usageQueryApi.capabilities = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  useAuthStore.setState({
    apiBase: 'https://old-query.example.test',
    managementKey: 'synthetic-query-test',
  });
  const old = useUsageQueryStore.getState().load(true);
  useAuthStore.setState({
    apiBase: 'https://new-query.example.test',
    managementKey: 'synthetic-query-test',
  });
  api.usageQueryApi.capabilities = async () => ({ ...session, bound: 'new-bound' });
  await useUsageQueryStore.getState().load(true);
  finish(session);
  await old;
  assert.equal(useUsageQueryStore.getState().session.bound, 'new-bound');
});
