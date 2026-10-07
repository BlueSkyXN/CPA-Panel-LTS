import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError } from 'axios';
import { createServer } from 'vite';
import { installFakeV8Core } from './testing/fakeV8Core.mjs';
import { localizedMessages } from './testing/localizedMessages.mjs';

const previousWindow = globalThis.window;
globalThis.window = new EventTarget();
const storage = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key), clear: () => data.clear() }; };
globalThis.sessionStorage = storage();
globalThis.localStorage = storage();
globalThis.window.location = { reload() {}, protocol: 'https:', host: 'core.invalid', origin: 'https://core.invalid' };
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ apiClient }, { configApi }, { useConfigStore }, { useAuthStore }, { providersApi }] = await Promise.all([
  vite.ssrLoadModule('/src/services/api/client.ts'),
  vite.ssrLoadModule('/src/services/api/config.ts'),
  vite.ssrLoadModule('/src/stores/useConfigStore.ts'),
  vite.ssrLoadModule('/src/stores/useAuthStore.ts'),
  vite.ssrLoadModule('/src/services/api/providers.ts'),
]);
let core;
test.afterEach(() => { core?.restore(); useConfigStore.getState().clearCache(); });
test.after(async () => { apiClient.clearConfig(); await vite.close(); globalThis.window = previousWindow; });

const document = () => ({
  'config-version': 8,
  observability: { usage: { 'usage-statistics-enabled': true }, logs: { debug: true } },
  routing: { strategy: 'round-robin', retry: { 'request-retry': 2 } },
  access: { 'api-keys': ['synthetic-client'] },
  'api-keys': { codex: [{ name: 'shared', 'base-url': 'https://example.invalid', keys: [{ 'api-key': 'synthetic-a' }, { 'api-key': 'synthetic-b' }] }] },
  plugins: { enabled: true, configs: { sample: { table: 'opaque-placeholder' } } },
});
function opaqueCore(status = 422, code = 'config_not_json_compatible') {
  core = installFakeV8Core(apiClient, document());
  const adapter = apiClient.instance.defaults.adapter;
  const calls = [];
  apiClient.instance.defaults.adapter = async (config) => {
    calls.push(config.url);
    if (config.url === '/config' || config.url === '/config/plugins') {
      throw new AxiosError('Configuration view unavailable', 'ERR_BAD_RESPONSE', config, null, {
        config, status, statusText: String(status), headers: { etag: core.etag() }, data: { error: code },
      });
    }
    return adapter(config);
  };
  return calls;
}

test('opaque plugin JSON does not block the typed config view or provider attribution', async () => {
  const calls = opaqueCore();
  const config = await configApi.getConfig();
  assert.equal(config.debug, true);
  assert.equal(config.usageStatisticsEnabled, true);
  assert.equal(config.requestRetry, 2);
  assert.equal(config.pluginsEnabled, true);
  assert.equal(config.codexApiKeys.length, 2);
  assert.equal(config.codexApiKeys[0].authIndex, 'codex:synthetic-a');
  assert.equal(config.raw, undefined, 'partial projection is not a full writable document');
  assert.equal(calls.includes('/config/plugins'), false);
  assert.equal(calls.includes('/config/plugins/configs'), false);
});

test('provider updates read a revisioned provider subtree, not the opaque document', async () => {
  const calls = opaqueCore();
  const config = await configApi.getConfig();
  calls.length = 0;
  const key = config.codexApiKeys[0];
  await providersApi.updateCodexConfig(key.apiKey, key.baseUrl, { ...key, priority: 3 });
  assert.equal(calls.includes('/config'), false);
  assert.equal(core.doc['api-keys'].codex[0].keys[0].priority, 3);
  assert.equal(core.doc['api-keys'].codex[0].keys[1].priority, undefined);
});

test('projection fails closed when node reads span different revisions', async () => {
  opaqueCore();
  const adapter = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.url === '/config/routing') core.concurrentEdit((doc) => { doc.routing.strategy = 'fill-first'; });
    return adapter(config);
  };
  await assert.rejects(configApi.getConfig(), localizedMessages('config_management.read_conflict'));
  assert.equal(useConfigStore.getState().config, null);
});

for (const [status, code] of [[401, 'unauthorized'], [500, 'decode_failed'], [422, 'invalid_config']]) {
  test(`config ${status}/${code} is not an opaque fallback`, async () => {
    const calls = opaqueCore(status, code);
    await assert.rejects(configApi.getConfig(), (error) => error.status === status);
    assert.deepEqual(calls, ['/config']);
  });
}

test('an optional node is absent only for revisioned not_found, not a missing route', async () => {
  opaqueCore();
  const adapter = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.url === '/config/ampcode') throw new AxiosError('Missing route', 'ERR_BAD_REQUEST', config, null, {
      config, status: 404, statusText: 'Not Found', headers: { etag: core.etag() }, data: '404 page not found',
    });
    return adapter(config);
  };
  await assert.rejects(configApi.getConfig(), (error) => error.status === 404);
});

test('an obsolete projection cannot populate the current connection', async () => {
  opaqueCore();
  const adapter = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async (config) => {
    const response = await adapter(config);
    if (config.url === '/config/access/api-keys') apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'synthetic-new' });
    return response;
  };
  await assert.rejects(configApi.getConfig(), /connection changed/i);
});

test('connection checking authenticates through YAML before loading the config projection', async () => {
  opaqueCore();
  const adapter = apiClient.instance.defaults.adapter;
  const calls = [];
  apiClient.instance.defaults.adapter = async (config) => {
    calls.push(config.url);
    if (!config.url.startsWith('/config')) return { config, status: 200, statusText: 'OK', headers: {}, data: {} };
    return adapter(config);
  };
  useAuthStore.setState({ apiBase: 'https://core.invalid', managementKey: 'synthetic-key', isAuthenticated: true, serverRuntimeKind: 'cpa' });
  assert.equal(await useAuthStore.getState().checkAuth(), true);
  assert.equal(calls[0], '/config.yaml');
  assert.ok(calls.includes('/config/api-keys'));
});
