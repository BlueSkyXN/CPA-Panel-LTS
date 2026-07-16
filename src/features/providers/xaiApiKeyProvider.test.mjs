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

const [{ xaiToResource }, { PROVIDER_DESCRIPTORS }, { apiClient }, { providersApi }, transformers] =
  await Promise.all([
    vite.ssrLoadModule('/src/features/providers/adapters.ts'),
    vite.ssrLoadModule('/src/features/providers/descriptors.ts'),
    vite.ssrLoadModule('/src/services/api/client.ts'),
    vite.ssrLoadModule('/src/services/api/providers.ts'),
    vite.ssrLoadModule('/src/services/api/transformers.ts'),
  ]);

const { normalizeConfigResponse } = transformers;
const originalGet = apiClient.get;
const originalPut = apiClient.put;
const originalDelete = apiClient.delete;

test.after(async () => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
  apiClient.delete = originalDelete;
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('normalizes the Core xai-api-key contract into a workbench resource', () => {
  const config = normalizeConfigResponse({
    'xai-api-key': [
      {
        'api-key': 'xai-secret',
        priority: 7,
        prefix: 'team-xai',
        'base-url': 'https://api.x.ai/v1',
        websockets: true,
        'proxy-url': 'http://proxy.local',
        headers: { 'X-Custom': 'value' },
        models: [{ name: 'grok-4.5', alias: 'grok-latest' }],
        'excluded-models': ['grok-3-*'],
        'disable-cooling': true,
        'auth-index': 'xai:apikey:1',
      },
    ],
  });

  assert.deepEqual(config.xaiApiKeys, [
    {
      apiKey: 'xai-secret',
      priority: 7,
      prefix: 'team-xai',
      baseUrl: 'https://api.x.ai/v1',
      websockets: true,
      proxyUrl: 'http://proxy.local',
      headers: { 'X-Custom': 'value' },
      models: [{ name: 'grok-4.5', alias: 'grok-latest' }],
      excludedModels: ['grok-3-*'],
      disableCooling: true,
      authIndex: 'xai:apikey:1',
    },
  ]);

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

test('preserves unknown fields and selects xAI mutations by api-key plus base-url', async () => {
  const calls = [];
  apiClient.get = async (url) => {
    calls.push({ method: 'GET', url });
    return {
      'xai-api-key': [
        {
          'api-key': 'shared-key',
          'base-url': 'https://xai-a.example.test/v1',
          'future-field': 'preserve-a',
          'auth-index': 'response-only-a',
        },
        {
          'api-key': 'shared-key',
          'base-url': 'https://xai-b.example.test/v1',
          'future-field': 'preserve-b',
          'auth-index': 'response-only-b',
        },
      ],
    };
  };
  apiClient.put = async (url, data) => {
    calls.push({ method: 'PUT', url, data });
  };
  apiClient.delete = async (url) => {
    calls.push({ method: 'DELETE', url });
  };

  await providersApi.createXAIConfig({
    apiKey: 'new-key',
    baseUrl: 'https://api.x.ai/v1',
    websockets: true,
  });
  await providersApi.updateXAIConfig('shared-key', 'https://xai-b.example.test/v1', {
    apiKey: 'shared-key',
    baseUrl: 'https://xai-b.example.test/v1',
    priority: 9,
    websockets: false,
  });
  await providersApi.deleteXAIConfig('shared-key', 'https://xai-b.example.test/v1');

  assert.deepEqual(calls, [
    { method: 'GET', url: '/config' },
    {
      method: 'PUT',
      url: '/xai-api-key',
      data: [
        {
          'api-key': 'shared-key',
          'base-url': 'https://xai-a.example.test/v1',
          'future-field': 'preserve-a',
        },
        {
          'api-key': 'shared-key',
          'base-url': 'https://xai-b.example.test/v1',
          'future-field': 'preserve-b',
        },
        {
          'api-key': 'new-key',
          'base-url': 'https://api.x.ai/v1',
          websockets: true,
        },
      ],
    },
    { method: 'GET', url: '/config' },
    {
      method: 'PUT',
      url: '/xai-api-key',
      data: [
        {
          'api-key': 'shared-key',
          'base-url': 'https://xai-a.example.test/v1',
          'future-field': 'preserve-a',
        },
        {
          'future-field': 'preserve-b',
          'api-key': 'shared-key',
          priority: 9,
          'base-url': 'https://xai-b.example.test/v1',
          websockets: false,
        },
      ],
    },
    {
      method: 'DELETE',
      url: '/xai-api-key?api-key=shared-key&base-url=https%3A%2F%2Fxai-b.example.test%2Fv1',
    },
  ]);
});
