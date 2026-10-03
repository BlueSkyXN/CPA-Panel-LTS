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
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { reconcileProviderGroups, mutateProviderConfig } = await vite.ssrLoadModule(
  '/src/services/api/providerGroups.ts'
);
const { providersApi } = await vite.ssrLoadModule('/src/services/api/providers.ts');
const { normalizeConfigResponse } = await vite.ssrLoadModule('/src/services/api/transformers.ts');
const { mergeDiscoveredModels } = await vite.ssrLoadModule(
  '/src/features/providers/modelEntries.ts'
);
const adapter = apiClient.instance.defaults.adapter;

test('discovery never drops existing same-name aliases or a configured placeholder', () => {
  const original = [
    { sourceIndex: 0, name: 'm', alias: 'a' },
    { sourceIndex: 1, name: 'm', alias: 'b' },
    { name: '', displayName: 'keep-label' },
  ];
  const result = mergeDiscoveredModels(original, [{ name: 'm' }, { name: 'new' }, { name: 'new' }]);
  assert.deepEqual(result.slice(0, 3), original);
  assert.equal(result.length, 4);
  assert.equal(result[3].sourceIndex, null);
});
test.after(async () => {
  apiClient.instance.defaults.adapter = adapter;
  apiClient.clearConfig();
  globalThis.window = oldWindow;
  await vite.close();
});

const groups = [
  {
    name: 'shared',
    'base-url': 'https://example.invalid',
    priority: 7,
    headers: { 'auth-index': 'a-literal-header', 'X-Policy': 'keep' },
    models: [{ name: 'm', alias: 'a' }],
    'disable-cooling': true,
    keys: [
      { 'api-key': 'synthetic-one', priority: null, 'auth-index': 'read-only-one' },
      { 'api-key': 'synthetic-two', 'request-retry': -1 },
    ],
  },
];
const effective = groups[0].keys.map((key) => ({
  priority: 7,
  headers: groups[0].headers,
  models: groups[0].models,
  'disable-cooling': true,
  'base-url': groups[0]['base-url'],
  ...Object.fromEntries(Object.entries(key).filter(([, value]) => value !== null)),
}));

test('one-key edit preserves group names, inherited nulls, sibling credentials and literal header keys', () => {
  const output = reconcileProviderGroups(
    'codex',
    groups,
    effective,
    effective.map((key, i) => (i ? key : { ...key, 'proxy-url': 'http://localhost:7890' }))
  );
  assert.equal(output.length, 1);
  assert.equal(output[0].name, 'shared');
  assert.equal(output[0].keys[0].priority, null);
  assert.equal(output[0].keys[0]['proxy-url'], 'http://localhost:7890');
  assert.equal(output[0].keys[0]['auth-index'], undefined);
  assert.equal(output[0].keys[0].headers, undefined);
  assert.deepEqual(output[0].headers, groups[0].headers);
  assert.deepEqual(output[0].keys[1], groups[0].keys[1]);
});

test('clearing inherited values creates explicit overrides without changing group policy', () => {
  const next = { ...effective[0] };
  delete next.models;
  delete next['disable-cooling'];
  const output = reconcileProviderGroups('codex', groups, effective, [next, effective[1]]);
  assert.deepEqual(output[0].keys[0].models, []);
  assert.equal(output[0].keys[0]['disable-cooling'], false);
  assert.equal(output[0]['disable-cooling'], true);
  assert.deepEqual(output[0].models, groups[0].models);
});

test('deletion keeps sibling groups and append does not regroup old keys', () => {
  const removed = reconcileProviderGroups('codex', groups, effective, [effective[1]]);
  assert.equal(removed[0].name, 'shared');
  assert.deepEqual(removed[0].keys, [groups[0].keys[1]]);
  const appended = reconcileProviderGroups('codex', groups, effective, [
    ...effective,
    { 'api-key': 'synthetic-new', 'base-url': 'https://new.invalid' },
  ]);
  assert.equal(appended.length, 2);
  assert.equal(appended[0].keys.length, 2);
  assert.equal(appended[1]['base-url'], 'https://new.invalid');
});

test('ambiguous identities and shared base URL edits fail before writing', () => {
  assert.throws(
    () =>
      reconcileProviderGroups(
        'codex',
        [...groups, groups[0]],
        [...effective, ...effective],
        effective
      ),
    /ambiguous/
  );
  assert.throws(
    () =>
      reconcileProviderGroups('codex', groups, effective, [
        { ...effective[0], 'base-url': 'https://other.invalid' },
        effective[1],
      ]),
    /shared provider group/
  );
});

const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: {} });
for (const v8 of [false, true]) {
  test(`provider mutation writes ${v8 ? 'only native grouped v8' : 'legacy v0'} and preserves attribution`, async () => {
    apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
    const writes = [];
    apiClient.instance.defaults.adapter = async (config) => {
      if (config.method === 'put') {
        writes.push(config);
        return response(config, {});
      }
      if (config.url === '/config.yaml')
        return response(config, v8 ? 'server: {port: 8317}\n' : 'port: 8317\n');
      if (config.url === '/config') return response(config, { 'codex-api-key': effective });
      if (config.url === '/config/api-keys/codex') return response(config, groups);
      throw new Error('Unexpected request');
    };
    const config = normalizeConfigResponse({ 'codex-api-key': effective }).codexApiKeys[0];
    await providersApi.updateCodexConfig('synthetic-one', 'https://example.invalid', {
      ...config,
      proxyUrl: 'http://localhost:7890',
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].baseURL, `https://example.invalid/${v8 ? 'v8' : 'v0'}/management`);
    assert.equal(writes[0].url, v8 ? '/config/api-keys/codex' : '/codex-api-key');
    const payload = JSON.parse(writes[0].data);
    if (v8) {
      assert.equal(payload[0].name, 'shared');
      assert.equal(payload[0].keys[0].priority, null);
    }
  });
}

test('grouped model rename and reorder retain per-row metadata hidden by the runtime view', async () => {
  apiClient.setConfig({ apiBase: 'https://models.invalid', managementKey: 'synthetic' });
  const rawModels = [
    { name: 'm', alias: 'a', future: 'first' },
    { name: 'm', alias: 'b', future: 'second' },
  ];
  const rawGroups = [
    {
      name: 'models',
      'base-url': 'https://upstream.invalid',
      models: rawModels,
      keys: [{ 'api-key': 'synthetic' }],
    },
  ];
  const flat = [
    {
      'api-key': 'synthetic',
      'base-url': 'https://upstream.invalid',
      models: rawModels.map(({ name, alias }) => ({ name, alias })),
    },
  ];
  let saved;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      saved = JSON.parse(config.data);
      return response(config, {});
    }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    if (config.url === '/config') return response(config, { 'codex-api-key': flat });
    return response(config, rawGroups);
  };
  const normalized = normalizeConfigResponse({ 'codex-api-key': flat }).codexApiKeys[0];
  await providersApi.updateCodexConfig('synthetic', 'https://upstream.invalid', {
    ...normalized,
    models: [{ ...normalized.models[1], name: 'renamed' }, normalized.models[0]],
  });
  assert.deepEqual(saved[0].models, rawModels);
  assert.deepEqual(saved[0].keys[0].models, [
    { name: 'renamed', alias: 'b', future: 'second' },
    { name: 'm', alias: 'a', future: 'first' },
  ]);
  assert.ok(!JSON.stringify(saved).includes('sourceIndex'));
});

test('late reads cannot write to another connection and grouped writes never fallback', async () => {
  apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'synthetic' });
  let finish;
  let writes = 0;
  apiClient.instance.defaults.adapter = (config) =>
    new Promise((resolve) => {
      if (config.method === 'put') writes++;
      finish = () => resolve(response(config, 'server: {port: 8317}\n'));
    });
  const pending = mutateProviderConfig('codex-api-key', (items) => items);
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'synthetic' });
  finish();
  await assert.rejects(pending, /changed/);
  assert.equal(writes, 0);
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      writes++;
      throw new Error('synthetic failure');
    }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    if (config.url === '/config') return response(config, { 'codex-api-key': effective });
    return response(config, groups);
  };
  await assert.rejects(
    mutateProviderConfig('codex-api-key', (items) => items),
    /synthetic failure/
  );
  assert.equal(writes, 1);
});

test('a concurrent grouped policy change is rejected instead of overwritten', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  let groupReads = 0;
  let writes = 0;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      writes++;
      return response(config, {});
    }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    if (config.url === '/config') return response(config, { 'codex-api-key': effective });
    return response(config, ++groupReads === 1 ? groups : [{ ...groups[0], priority: 9 }]);
  };
  await assert.rejects(
    mutateProviderConfig('codex-api-key', (items) => items),
    /changed/
  );
  assert.equal(writes, 0);
});

test('OpenAI key edits retain native per-key metadata and explicit null inheritance', () => {
  const raw = [
    {
      name: 'openai',
      priority: 9,
      keys: [
        { 'api-key': 'synthetic-a', priority: null, future: 'keep' },
        { 'api-key': 'synthetic-b' },
      ],
    },
  ];
  const before = [
    {
      name: 'openai',
      priority: 9,
      'api-key-entries': [{ 'api-key': 'synthetic-a' }, { 'api-key': 'synthetic-b' }],
    },
  ];
  const after = [
    {
      ...before[0],
      'api-key-entries': [
        { 'api-key': 'synthetic-a', 'proxy-url': 'direct' },
        { 'api-key': 'synthetic-b' },
      ],
    },
  ];
  const saved = reconcileProviderGroups('openai-compatibility', raw, before, after);
  assert.equal(saved[0].keys[0].priority, null);
  assert.equal(saved[0].keys[0].future, 'keep');
  assert.equal(saved[0].keys[0]['proxy-url'], 'direct');
});

test('concurrent creation in an initially empty family is detected', async () => {
  apiClient.setConfig({ apiBase: 'https://empty.invalid', managementKey: 'synthetic' });
  let reads = 0,
    writes = 0;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      writes++;
      return response(config, {});
    }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    if (config.url === '/config') return response(config, {});
    return response(
      config,
      ++reads === 1 ? [] : [{ name: 'empty-but-configured', keys: [], priority: 2 }]
    );
  };
  await assert.rejects(
    mutateProviderConfig('codex-api-key', () => [{ 'api-key': 'synthetic-new' }]),
    /changed/
  );
  assert.equal(writes, 0);
});
