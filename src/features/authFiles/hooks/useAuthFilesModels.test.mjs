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
const { useAuthFilesModels } = await vite.ssrLoadModule(
  '/src/features/authFiles/hooks/useAuthFilesModels.ts'
);
const { authFilesApi } = await vite.ssrLoadModule('/src/services/api/authFiles.ts');
const { useNotificationStore } = await vite.ssrLoadModule('/src/stores/useNotificationStore.ts');
const item = { name: 'fixture-auth.json', type: 'qoder' };

// 无需新增 DOM 依赖：使用真实 hook 的回调和 ref 验证请求与缓存生命周期。
function controls() {
  let result;
  function Probe() {
    result = useAuthFilesModels();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return result;
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

test('nonempty model snapshots are cached without requesting discovery', async (t) => {
  const read = t.mock.method(authFilesApi, 'getModelsForAuthFile', async () => [{ id: 'model-a' }]);
  const refresh = t.mock.method(authFilesApi, 'refreshModelsForAuthFile', async () => []);
  const hook = controls();
  await hook.showModels(item);
  await hook.showModels(item);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(refresh.mock.callCount(), 0);
});

test('empty snapshots request discovery once and cache the recovered models', async (t) => {
  const read = t.mock.method(authFilesApi, 'getModelsForAuthFile', async () => []);
  const refresh = t.mock.method(authFilesApi, 'refreshModelsForAuthFile', async () => [{ id: 'model-a' }]);
  const hook = controls();
  await hook.showModels(item);
  await hook.showModels(item);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(refresh.mock.callCount(), 1);
  assert.deepEqual(refresh.mock.calls[0].arguments, [item.name]);
});

test('older Core without the refresh route keeps the empty snapshot', async (t) => {
  const read = t.mock.method(authFilesApi, 'getModelsForAuthFile', async () => []);
  t.mock.method(authFilesApi, 'refreshModelsForAuthFile', async () => {
    throw Object.assign(new Error('Not Found'), { status: 404 });
  });
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const hook = controls();
  await hook.showModels(item);
  await hook.showModels(item);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(notify.mock.callCount(), 0);
});

test('discovery failures remain visible and do not cache an empty result', async (t) => {
  const read = t.mock.method(authFilesApi, 'getModelsForAuthFile', async () => []);
  t.mock.method(authFilesApi, 'refreshModelsForAuthFile', async () => {
    throw Object.assign(new Error('Discovery unavailable'), { status: 503 });
  });
  const notify = t.mock.method(useNotificationStore.getState(), 'showNotification', () => {});
  const hook = controls();
  await hook.showModels(item);
  await hook.showModels(item);
  assert.equal(read.mock.callCount(), 2);
  assert.equal(notify.mock.callCount(), 2);
  assert.match(notify.mock.calls[0].arguments[0], /Discovery unavailable/);
});

for (const scope of ['file', 'all']) {
  test(`a refresh completing after ${scope} invalidation cannot repopulate the cache`, async (t) => {
    let reads = 0;
    t.mock.method(authFilesApi, 'getModelsForAuthFile', async () =>
      ++reads === 1 ? [] : [{ id: 'fresh-model' }]
    );
    const started = deferred();
    const response = deferred();
    t.mock.method(authFilesApi, 'refreshModelsForAuthFile', () => {
      started.resolve();
      return response.promise;
    });
    const hook = controls();
    const loading = hook.showModels(item);
    await started.promise;
    hook.invalidateModels(scope === 'file' ? [item.name] : undefined);
    response.resolve([{ id: 'stale-model' }]);
    await loading;
    await hook.showModels(item);
    assert.equal(reads, 2);
  });
}
