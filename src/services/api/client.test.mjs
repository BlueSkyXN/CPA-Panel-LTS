import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');

test.after(async () => {
  apiClient.clearConfig();
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('binds connection details when the request is created', async () => {
  const initialGeneration = apiClient.setConfig({
    apiBase: 'https://old-core.example.test',
    managementKey: 'old-management-key',
  });

  let capturedConfig;
  const pending = apiClient.get('/probe', {
    adapter: async (config) => {
      capturedConfig = config;
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    },
  });

  apiClient.setConfig({
    apiBase: 'https://new-core.example.test',
    managementKey: 'new-management-key',
  });

  await pending;

  assert.equal(capturedConfig.baseURL, 'https://old-core.example.test/v0/management');
  assert.equal(capturedConfig.headers.get('Authorization'), 'Bearer old-management-key');
  assert.equal(capturedConfig.__cpaConnectionGeneration, initialGeneration);
});
