import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { installFakeV8Core } from '../../services/api/testing/fakeV8Core.mjs';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [{ xaiToResource }, { PROVIDER_DESCRIPTORS }, { apiClient }, { providersApi }, transformers] =
  await Promise.all([
    vite.ssrLoadModule('/src/features/providers/adapters.ts'),
    vite.ssrLoadModule('/src/features/providers/descriptors.ts'),
    vite.ssrLoadModule('/src/services/api/client.ts'),
    vite.ssrLoadModule('/src/services/api/providers.ts'),
    vite.ssrLoadModule('/src/services/api/transformers.ts'),
  ]);

const { normalizeConfigResponse } = transformers;
let core;

test.after(async () => {
  core?.restore();
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('normalizes the Core v8 xai group contract into a workbench resource', () => {
  const config = normalizeConfigResponse({
    'api-keys': {
      xai: [
        {
          name: 'xai-1',
          'base-url': 'https://api.x.ai/v1',
          prefix: 'team-xai',
          keys: [
            {
              'api-key': 'xai-secret',
              priority: 7,
              websockets: true,
              'proxy-url': 'http://proxy.local',
              headers: { 'X-Custom': 'value' },
              models: [{ name: 'grok-4.5', alias: 'grok-latest' }],
              'excluded-models': ['grok-3-*'],
              'disable-cooling': true,
              auth_index: 'xai:apikey:1',
            },
          ],
        },
      ],
    },
  });

  const { source, ...xai } = config.xaiApiKeys[0];
  assert.deepEqual(xai, {
    apiKey: 'xai-secret',
    priority: 7,
    prefix: 'team-xai',
    baseUrl: 'https://api.x.ai/v1',
    websockets: true,
    proxyUrl: 'http://proxy.local',
    headers: { 'X-Custom': 'value' },
    models: [{ name: 'grok-4.5', alias: 'grok-latest', sourceIndex: 0 }],
    excludedModels: ['grok-3-*'],
    disableCooling: true,
    authIndex: 'xai:apikey:1',
  });
  assert.equal(source.groupIndex, 0);
  assert.equal(source.keyIndex, 0);
  assert.equal(JSON.stringify(source).includes('auth_index'), false);

  const resource = xaiToResource(config.xaiApiKeys[0], 0);
  assert.equal(resource.brand, 'xai');
  assert.equal(resource.baseUrl, 'https://api.x.ai/v1');
  assert.deepEqual(resource.models, ['grok-4.5']);
  assert.equal(resource.flags.websockets, true);
  assert.deepEqual(resource.selector, {
    brand: 'xai',
    apiKey: 'xai-secret',
    baseUrl: 'https://api.x.ai/v1',
    index: 0,
  });
  assert.equal(PROVIDER_DESCRIPTORS.xai.baseUrlRequired, true);
  assert.equal(PROVIDER_DESCRIPTORS.xai.supportsWebsockets, true);
});

test('preserves unknown fields and selects xAI mutations by persisted group identity', async () => {
  core = installFakeV8Core(apiClient, {
    'api-keys': {
      xai: [
        {
          name: 'xai-a',
          'base-url': 'https://xai-a.example.test/v1',
          keys: [{ 'api-key': 'shared-key', 'future-field': 'preserve-a' }],
        },
        {
          name: 'xai-b',
          'base-url': 'https://xai-b.example.test/v1',
          keys: [{ 'api-key': 'shared-key', 'future-field': 'preserve-b' }],
        },
      ],
    },
  });

  await providersApi.createXAIConfig({
    apiKey: 'new-key',
    baseUrl: 'https://api.x.ai/v1',
    websockets: true,
  });
  let config = normalizeConfigResponse(await apiClient.get('/config'));
  const b = config.xaiApiKeys.find((item) => item.baseUrl === 'https://xai-b.example.test/v1');
  await providersApi.updateXAIConfig(b.apiKey, b.baseUrl, { ...b, priority: 9, websockets: false });
  config = normalizeConfigResponse(await apiClient.get('/config'));
  const updated = config.xaiApiKeys.find((item) => item.baseUrl === 'https://xai-b.example.test/v1');
  await providersApi.deleteXAIConfig(updated.apiKey, updated.baseUrl, updated.source);

  assert.deepEqual(
    core.writes.map((write) => `${write.method} ${write.url}`),
    ['PUT /config/api-keys/xai', 'PUT /config/api-keys/xai', 'PUT /config/api-keys/xai']
  );
  assert.deepEqual(core.writes[0].data[2], {
    name: 'xai-3',
    'base-url': 'https://api.x.ai/v1',
    keys: [{ 'api-key': 'new-key', websockets: true }],
  });
  assert.deepEqual(core.writes[1].data[0], {
    name: 'xai-a',
    'base-url': 'https://xai-a.example.test/v1',
    keys: [{ 'api-key': 'shared-key', 'future-field': 'preserve-a' }],
  });
  assert.deepEqual(core.writes[1].data[1].keys[0], {
    'api-key': 'shared-key',
    'future-field': 'preserve-b',
    priority: 9,
  });
  // An omitted WebSocket flag displays as off; editing another field must not materialize it.
  assert.deepEqual(core.doc['api-keys'].xai[1], {
    name: 'xai-b',
    'base-url': 'https://xai-b.example.test/v1',
    keys: [],
  });
  assert.equal(JSON.stringify(core.writes).includes('auth_index'), false);
});
