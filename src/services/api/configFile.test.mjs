import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const previousWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { configFileApi } = await vite.ssrLoadModule('/src/services/api/configFile.ts');
const instance = apiClient.instance;
const previousAdapter = instance.defaults.adapter;
const legacy = 'port: 8317\napi-keys: [synthetic-client]\n';
const canonical = 'config-version: 8\nserver: {port: 8317}\naccess: {api-keys: [synthetic-client]}\n';
const revision = `"${'a'.repeat(64)}"`;
const response = (config, data, etag = revision) => ({ config, data, status: 200, statusText: 'OK', headers: etag ? { etag } : {} });

test.after(async () => {
  instance.defaults.adapter = previousAdapter;
  apiClient.clearConfig();
  await vite.close();
  globalThis.window = previousWindow;
});

for (const v8 of [false, true]) {
  test(`configuration YAML uses ${v8 ? 'v8 canonical' : 'legacy'} writes without moving usage`, async () => {
    apiClient.setConfig({ apiBase: 'https://example.invalid/prefix', managementKey: 'synthetic' });
    const calls = [];
    instance.defaults.adapter = async config => {
      calls.push({ method: config.method, base: config.baseURL, path: config.url, match: config.headers.get('If-Match') });
      return response(config, config.method === 'get' ? (v8 ? canonical : legacy) : {});
    };
    const snapshot = await configFileApi.fetchConfigYaml();
    assert.equal(snapshot.content, v8 ? canonical : legacy);
    assert.ok(Object.isFrozen(snapshot));
    await configFileApi.saveConfigYaml(snapshot.content, snapshot);
    await apiClient.get('/usage');
    const write = calls.find(c => c.method === 'put');
    assert.equal(write.base, `https://example.invalid/prefix/${v8 ? 'v8' : 'v0'}/management`);
    assert.equal(write.match, revision);
    assert.equal(calls.at(-1).base, 'https://example.invalid/prefix/v0/management');
  });
}

test('late config response cannot authorize a write on another connection', async () => {
  apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'synthetic' });
  instance.defaults.adapter = async config => response(config, legacy);
  const snapshot = await configFileApi.fetchConfigYaml();
  let finish;
  let writes = 0;
  instance.defaults.adapter = config => new Promise(resolve => {
    if (config.method === 'put') writes++;
    finish = () => resolve(response(config, legacy));
  });
  const pending = configFileApi.fetchConfigYaml();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'synthetic' });
  finish();
  await assert.rejects(pending, /connection changed/);
  await assert.rejects(configFileApi.saveConfigYaml(legacy, snapshot), /connection changed/);
  assert.equal(writes, 0);
});

test('a failed v8 write is never retried against v0', async () => {
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

test('v8 fails closed without revision support while old v7 remains compatible', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  instance.defaults.adapter = async config => response(config, canonical, '');
  await assert.rejects(configFileApi.fetchConfigYaml(), /revision unavailable/);
  let writes = 0;
  instance.defaults.adapter = async config => {
    if (config.method === 'put') {
      writes++;
      assert.equal(config.headers.get('If-Match'), undefined);
    }
    return response(config, legacy, '');
  };
  const snapshot = await configFileApi.fetchConfigYaml();
  await configFileApi.saveConfigYaml(legacy, snapshot);
  assert.equal(writes, 1);
});
