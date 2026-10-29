import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const previousWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { apiClient, ltsExtensionClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { configFileApi } = await vite.ssrLoadModule('/src/services/api/configFile.ts');
const instance = apiClient.instance;
const previousAdapter = instance.defaults.adapter;
const canonical = 'config-version: 8\nserver: {port: 8317}\naccess: {api-keys: [synthetic-client]}\n';
const revision = `"${'a'.repeat(64)}"`;
const response = (config, data, etag = revision) => ({ config, data, status: 200, statusText: 'OK', headers: etag ? { etag } : {} });

test.after(async () => {
  instance.defaults.adapter = previousAdapter;
  apiClient.clearConfig();
  await vite.close();
  globalThis.window = previousWindow;
});

test('configuration YAML always uses v8 revisioned writes; usage stays on the LTS extension', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid/prefix', managementKey: 'synthetic' });
  const calls = [];
  instance.defaults.adapter = async config => {
    calls.push({ method: config.method, base: config.baseURL, path: config.url, match: config.headers.get('If-Match') });
    return response(config, config.method === 'get' ? canonical : {});
  };
  const snapshot = await configFileApi.fetchConfigYaml();
  assert.equal(snapshot.content, canonical);
  assert.ok(Object.isFrozen(snapshot));
  assert.equal('v8' in snapshot, false);
  await configFileApi.saveConfigYaml(snapshot.content, snapshot);
  await ltsExtensionClient.get('/usage');
  assert.equal(calls.filter(c => c.method === 'get' && c.path === '/config.yaml').length, 1);
  const write = calls.find(c => c.method === 'put');
  assert.equal(write.base, 'https://example.invalid/prefix/v8/management');
  assert.equal(write.match, revision);
  assert.equal(calls.at(-1).base, 'https://example.invalid/prefix/v0/management');
});

test('late config response cannot authorize a write on another connection', async () => {
  apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'synthetic' });
  instance.defaults.adapter = async config => response(config, canonical);
  const snapshot = await configFileApi.fetchConfigYaml();
  let finish;
  let writes = 0;
  instance.defaults.adapter = config => new Promise(resolve => {
    if (config.method === 'put') writes++;
    finish = () => resolve(response(config, canonical));
  });
  const pending = configFileApi.fetchConfigYaml();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'synthetic' });
  finish();
  await assert.rejects(pending, /connection changed/);
  await assert.rejects(configFileApi.saveConfigYaml(canonical, snapshot), /connection changed/);
  assert.equal(writes, 0);
});

test('a failed v8 write is never retried, on v8 or the LTS extension', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  let writes = 0;
  instance.defaults.adapter = async config => {
    if (config.method === 'put') { writes++; throw new Error('synthetic write failure'); }
    return response(config, canonical);
  };
  const snapshot = await configFileApi.fetchConfigYaml();
  await assert.rejects(configFileApi.saveConfigYaml(canonical, snapshot), /synthetic write failure/);
  assert.equal(writes, 1);
});

test('another editor read cannot replace a draft revision and stale writes are not replayed', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  let current = revision;
  let writes = 0;
  instance.defaults.adapter = async config => {
    if (config.method === 'put') {
      writes++;
      assert.equal(config.headers.get('If-Match'), revision);
      throw Object.assign(new Error('Configuration changed'), { status: 412 });
    }
    return response(config, canonical, current);
  };
  const original = await configFileApi.fetchConfigYaml();
  current = `"${'b'.repeat(64)}"`;
  const otherEditor = await configFileApi.fetchConfigYaml();
  assert.notEqual(original.revision, otherEditor.revision);
  await assert.rejects(configFileApi.saveConfigYaml(canonical, original), /changed/);
  assert.equal(writes, 1);
});

test('configuration without a revision fails closed (no unconditional write path)', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  let writes = 0;
  instance.defaults.adapter = async config => {
    if (config.method === 'put') writes++;
    return response(config, canonical, '');
  };
  await assert.rejects(configFileApi.fetchConfigYaml(), /revision unavailable/);
  await assert.rejects(
    configFileApi.saveConfigYaml(canonical, { content: canonical, generation: apiClient.getConnectionGeneration(), revision: '' }),
    /revision unavailable/
  );
  assert.equal(writes, 0);
});
