import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const oldWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { modelsApi } = await vite.ssrLoadModule('/src/services/api/models.ts');
const { apiCallApi } = await vite.ssrLoadModule('/src/services/api/apiCall.ts');
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const original = apiCallApi.request;
test.after(async () => {
  apiCallApi.request = original;
  globalThis.window = oldWindow;
  await vite.close();
});
test('model probes retain explicit proxy and direct choices', async () => {
  const calls = [];
  apiCallApi.request = async (payload) => {
    calls.push(payload);
    return { statusCode: 200, body: { data: [{ id: 'synthetic-model' }] } };
  };
  await modelsApi.fetchV1ModelsViaApiCall(
    'https://example.invalid',
    undefined,
    {},
    'synthetic-index',
    'direct'
  );
  await modelsApi.fetchModelsViaApiCall(
    'https://example.invalid/v1',
    undefined,
    {},
    undefined,
    'http://localhost:7890'
  );
  assert.equal(calls[0].proxy_url, 'direct');
  assert.equal(calls[1].proxy_url, 'http://localhost:7890');
});
test('in-flight deduplication never crosses proxy or connection generation', async () => {
  const pending = [];
  apiCallApi.request = (payload) => new Promise((resolve) => pending.push({ payload, resolve }));
  apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'synthetic' });
  const first = modelsApi.fetchClaudeModelsViaApiCall(
    'https://example.invalid',
    undefined,
    {},
    'i',
    'direct'
  );
  const same = modelsApi.fetchClaudeModelsViaApiCall(
    'https://example.invalid',
    undefined,
    {},
    'i',
    'direct'
  );
  const proxy = modelsApi.fetchClaudeModelsViaApiCall(
    'https://example.invalid',
    undefined,
    {},
    'i',
    'http://localhost:7890'
  );
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'synthetic' });
  const other = modelsApi.fetchClaudeModelsViaApiCall(
    'https://example.invalid',
    undefined,
    {},
    'i',
    'direct'
  );
  assert.equal(pending.length, 3);
  pending.forEach(({ resolve }) => resolve({ statusCode: 200, body: { data: [] } }));
  await Promise.all([first, same, proxy, other]);
});
