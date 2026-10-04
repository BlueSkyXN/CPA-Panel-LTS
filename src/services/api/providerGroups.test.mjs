import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
const { useConfigStore } = await vite.ssrLoadModule('/src/stores/useConfigStore.ts');
const { useProviderWorkbench } = await vite.ssrLoadModule('/src/features/providers/useProviderWorkbench.ts');
const { codexToResource, code0ToResource, openaiToResource } = await vite.ssrLoadModule('/src/features/providers/adapters.ts');
const { buildCode0Raw } = await vite.ssrLoadModule('/src/features/providers/code0.ts');
function workbench() {
  let result;
  function Harness() { result = useProviderWorkbench(); return null; }
  renderToStaticMarkup(createElement(Harness));
  return result;
}
test.afterEach(() => useConfigStore.getState().clearCache());

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

const revision = `"${'a'.repeat(64)}"`;
const response = (config, data) => ({ config, data, status: 200, statusText: 'OK', headers: { etag: revision } });
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
    }, config);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].baseURL, `https://example.invalid/${v8 ? 'v8' : 'v0'}/management`);
    assert.equal(writes[0].url, v8 ? '/config/api-keys/codex' : '/codex-api-key');
    const payload = JSON.parse(writes[0].data);
    if (v8) {
      assert.equal(writes[0].headers.get('If-Match'), revision);
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
  }, normalized);
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

for (const family of [
  { section: 'gemini-api-key', normalized: 'geminiApiKeys', update: 'updateGeminiKey' },
  { section: 'interactions-api-key', normalized: 'interactionsApiKeys', update: 'updateInteractionsKey' },
  { section: 'codex-api-key', normalized: 'codexApiKeys', update: 'updateCodexConfig' },
  { section: 'xai-api-key', normalized: 'xaiApiKeys', update: 'updateXAIConfig' },
  { section: 'claude-api-key', normalized: 'claudeApiKeys', update: 'updateClaudeConfig' },
  { section: 'vertex-api-key', normalized: 'vertexApiKeys', update: 'updateVertexConfig' },
]) {
  test(`${family.section} rejects an old form after the global store refreshes`, async () => {
    apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
    const before = [{ 'api-key': 'synthetic-one', 'base-url': 'https://example.invalid', priority: 7 }];
    const latest = [{ ...before[0], priority: 9 }];
    const snapshot = normalizeConfigResponse({ [family.section]: before })[family.normalized][0];
    useConfigStore.setState({ config: normalizeConfigResponse({ [family.section]: latest }) });
    let writes = 0;
    apiClient.instance.defaults.adapter = async (config) => {
      if (config.method === 'put') { writes++; return response(config, {}); }
      if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
      if (config.url === '/config') return response(config, { [family.section]: latest });
      throw new Error('stale form must fail before native group lookup');
    };
    await assert.rejects(providersApi[family.update]('synthetic-one', 'https://example.invalid', {
      ...snapshot, proxyUrl: 'http://localhost:7890',
    }, snapshot), /changed/);
    assert.equal(writes, 0);
  });
}

test('OpenAI form snapshot detects changed provider fields after global refresh', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  const before = [{ name: 'synthetic', 'base-url': 'https://example.invalid', priority: 7, 'api-key-entries': [] }];
  const latest = [{ ...before[0], priority: 9 }];
  const snapshot = normalizeConfigResponse({ 'openai-compatibility': before }).openaiCompatibility[0];
  useConfigStore.setState({ config: normalizeConfigResponse({ 'openai-compatibility': latest }) });
  let writes = 0;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.method === 'put') { writes++; return response(config, {}); }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    return response(config, { 'openai-compatibility': latest });
  };
  await assert.rejects(providersApi.updateOpenAIProvider('synthetic', 0, { ...snapshot, prefix: 'new' }, snapshot), /changed/);
  assert.equal(writes, 0);
});

test('workbench passes the opened form snapshot rather than refreshed global data', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  const before = { 'codex-api-key': [{ 'api-key': 'synthetic', priority: 7 }] };
  const opened = codexToResource(normalizeConfigResponse(before).codexApiKeys[0], 0);
  const latest = { 'codex-api-key': [{ 'api-key': 'synthetic', priority: 9 }] };
  useConfigStore.setState({ config: normalizeConfigResponse(latest) });
  let writes = 0;
  apiClient.instance.defaults.adapter = async config => {
    if (config.method !== 'get') { writes++; return response(config, {}); }
    return response(config, config.url === '/config.yaml' ? 'server: {port: 8317}\n' : latest);
  };
  await assert.rejects(workbench().updateProvider(opened, { apiKey: 'synthetic', priority: 7, headers: [], excludedModelsText: '', prefix: '', baseUrl: '', proxyUrl: '', models: [], disabled: false }), /changed/);
  await assert.rejects(workbench().toggleDisabled(opened, true), /changed/);
  assert.equal(writes, 0);
});

test('sponsor form rejects a changed aggregate before its first protocol write', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  const before = { 'codex-api-key': [{ 'api-key': 'synthetic', 'base-url': 'https://code0.ai/v1', priority: 7 }] };
  const opened = code0ToResource(buildCode0Raw(normalizeConfigResponse(before)));
  assert.ok(opened);
  const latest = { 'codex-api-key': [{ ...before['codex-api-key'][0], priority: 9 }] };
  useConfigStore.setState({ config: normalizeConfigResponse(latest) });
  let writes = 0;
  apiClient.instance.defaults.adapter = async config => {
    if (config.method !== 'get') { writes++; return response(config, {}); }
    return response(config, latest);
  };
  await assert.rejects(workbench().updateProvider(opened, { sponsorKeyEntries: [] }), /changed/);
  assert.equal(writes, 0);
});

test('unchanged provider snapshot saves once with its original document revision', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  const current = normalizeConfigResponse({ 'codex-api-key': effective }).codexApiKeys[0];
  let writes = 0;
  apiClient.instance.defaults.adapter = async config => {
    if (config.method === 'put') {
      writes++;
      assert.equal(config.headers.get('If-Match'), revision);
      const body = JSON.parse(config.data);
      assert.equal(body[0].keys[0]['proxy-url'], 'http://localhost:7890');
      assert.equal(body[0].keys[0].priority, null);
      return response(config, {});
    }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    return response(config, config.url === '/config' ? { 'codex-api-key': effective } : groups);
  };
  await providersApi.updateCodexConfig(current.apiKey, current.baseUrl, { ...current, proxyUrl: 'http://localhost:7890' }, current);
  assert.equal(writes, 1);
});

const openaiA = { name: 'synthetic-a', 'base-url': 'https://a.invalid', priority: 7, 'api-key-entries': [{ 'api-key': 'synthetic-a' }] };
const openaiB = { name: 'synthetic-b', 'base-url': 'https://b.invalid', 'api-key-entries': [] };
const openaiC = { name: 'synthetic-c', 'base-url': 'https://c.invalid', 'api-key-entries': [] };
const openaiSnapshot = (items, index) => normalizeConfigResponse({ 'openai-compatibility': items }).openaiCompatibility.find(item => item.sourceIndex === index);
const openaiGroups = items => items.map(({ 'api-key-entries': keys = [], ...item }) => ({ ...item, keys }));
function mockOpenAI(items, { v8 = true, writeError } = {}) {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  useConfigStore.setState({ config: normalizeConfigResponse({ 'openai-compatibility': items }) });
  const writes = [];
  apiClient.instance.defaults.adapter = async config => {
    if (config.method !== 'get') {
      writes.push(config);
      if (writeError) throw writeError;
      return response(config, {});
    }
    if (config.url === '/config.yaml') return response(config, v8 ? 'server: {port: 8317}\n' : 'port: 8317\n');
    if (config.url === '/config') return response(config, { 'openai-compatibility': items });
    if (config.url === '/config/api-keys/openai-compatibility') return response(config, openaiGroups(items));
    if (config.url === '/openai-compatibility') return response(config, { 'openai-compatibility': items });
    if (config.url === '/vertex-api-key') return response(config, []);
    throw new Error(`Unexpected request: ${config.url}`);
  };
  return writes;
}
const openaiActions = {
  delete: (index, snapshot) => providersApi.deleteOpenAIProvider(index, snapshot),
  disable: (index, snapshot) => providersApi.updateOpenAIProviderDisabled(index, true, snapshot),
  enable: (index, snapshot) => providersApi.updateOpenAIProviderDisabled(index, false, snapshot),
};
for (const v8 of [true, false]) {
  for (const [action, mutate] of Object.entries(openaiActions)) {
    for (const [scenario, latest] of Object.entries({
      reorder: [openaiB, openaiA],
      insertion: [openaiC, openaiA, openaiB],
      deletion: [openaiB],
      absent: [],
      renamed: [{ ...openaiA, name: 'renamed' }, openaiB],
      changed: [{ ...openaiA, priority: 9 }, openaiB],
      credentials: [{ ...openaiA, 'api-key-entries': [{ 'api-key': 'synthetic-new' }] }, openaiB],
      ambiguous: [openaiA, { ...openaiB, name: openaiA.name }],
    })) {
      test(`OpenAI ${v8 ? 'v8' : 'legacy'} ${action} rejects ${scenario} with an old target and refreshed store`, async () => {
        const snapshot = openaiSnapshot([openaiA, openaiB], 0);
        const writes = mockOpenAI(latest, { v8 });
        await assert.rejects(mutate(0, snapshot), /changed|ambiguous/);
        assert.equal(writes.length, 0);
      });
    }
    test(`OpenAI ${v8 ? 'v8' : 'legacy'} ${action} accepts an unchanged target`, async () => {
      const snapshot = openaiSnapshot([openaiA, openaiB], 0);
      const writes = mockOpenAI([openaiA, openaiB], { v8 });
      await mutate(0, snapshot);
      assert.equal(writes.length, 1);
      const write = writes[0];
      if (v8) {
        assert.equal(write.method, 'put');
        assert.equal(write.url, '/config/api-keys/openai-compatibility');
        assert.equal(write.headers.get('If-Match'), revision);
        const saved = JSON.parse(write.data);
        assert.deepEqual(saved.map(item => item.name), action === 'delete' ? [openaiB.name] : [openaiA.name, openaiB.name]);
        assert.deepEqual(saved.at(-1), openaiGroups([openaiB])[0]);
        if (action !== 'delete') assert.equal(saved[0].disabled, action === 'disable');
      } else {
        assert.equal(write.method, action === 'delete' ? 'delete' : 'patch');
        if (action === 'delete') assert.equal(write.url, `/openai-compatibility?name=${openaiA.name}`);
        else assert.deepEqual(JSON.parse(write.data), { name: openaiA.name, value: { disabled: action === 'disable' } });
      }
    });
  }
}
for (const [action, mutate] of Object.entries(openaiActions)) {
  test(`OpenAI ${action} does not retry or downgrade a final 412`, async () => {
    const error = Object.assign(new Error('Configuration changed after final read'), { isAxiosError: true, response: { status: 412, data: { error: 'Configuration changed after final read' } } });
    const writes = mockOpenAI([openaiA, openaiB], { writeError: error });
    await assert.rejects(mutate(0, openaiSnapshot([openaiA, openaiB], 0)), actual => actual.status === 412 && actual.message === error.message);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].headers.get('If-Match'), revision);
  });
  test(`workbench ${action} retains the original OpenAI resource after store refresh`, async () => {
    const opened = openaiToResource(openaiSnapshot([openaiA, openaiB], 0), 0);
    const wb = workbench();
    const writes = mockOpenAI([openaiB, openaiA]);
    await assert.rejects(action === 'delete' ? wb.deleteProvider(opened) : wb.toggleDisabled(opened, action === 'disable'), /changed/);
    assert.equal(writes.length, 0);
  });
  test(`sponsor ${action} checks the original OpenAI target`, async () => {
    const sponsor = { ...openaiA, 'base-url': 'https://code0.ai/v1' };
    const opened = code0ToResource(buildCode0Raw(normalizeConfigResponse({ 'openai-compatibility': [sponsor, openaiB] })));
    assert.ok(opened);
    const wb = workbench();
    const writes = mockOpenAI([openaiB, sponsor]);
    await assert.rejects(action === 'delete' ? wb.deleteProvider(opened) : wb.toggleDisabled(opened, action === 'disable'), /changed/);
    assert.equal(writes.length, 0);
  });
}

for (const [action, mutate] of Object.entries(openaiActions)) {
  test(`OpenAI ${action} uses backend source index rather than a filtered row position`, async () => {
    const items = [{ name: 'invalid-without-base-url' }, openaiA, openaiB];
    const snapshot = openaiSnapshot(items, 1);
    const writes = mockOpenAI(items);
    await mutate(1, snapshot);
    assert.equal(writes.length, 1);
    const saved = JSON.parse(writes[0].data);
    assert.equal(saved[0].name, 'invalid-without-base-url');
    assert.equal(saved.at(-1).name, openaiB.name);
  });
  test(`OpenAI ${action} rejects a mismatched source index`, async () => {
    const writes = mockOpenAI([openaiA, openaiB]);
    const snapshot = { ...openaiSnapshot([openaiA, openaiB], 0), sourceIndex: 1 };
    await assert.rejects(mutate(0, snapshot), /changed/);
    assert.equal(writes.length, 0);
  });
  test(`OpenAI ${action} preserves a concurrent change to a different provider`, async () => {
    const snapshot = openaiSnapshot([openaiA, openaiB], 0);
    const changedSibling = { ...openaiB, priority: 42 };
    const writes = mockOpenAI([openaiA, changedSibling]);
    useConfigStore.setState({ config: normalizeConfigResponse({ 'openai-compatibility': [openaiA, openaiB] }) });
    await mutate(0, snapshot);
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].data).at(-1), openaiGroups([changedSibling])[0]);
  });
  test(`sponsor ${action} succeeds for multiple unchanged OpenAI targets`, async () => {
    const first = { ...openaiA, 'base-url': 'https://code0.ai/v1', disabled: action === 'enable' };
    const second = { ...openaiC, 'base-url': 'https://code0.ai/v1', disabled: action === 'enable' };
    let items = [first, openaiB, second];
    const original = normalizeConfigResponse({ 'openai-compatibility': items });
    const opened = code0ToResource(buildCode0Raw(original));
    assert.ok(opened);
    apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
    useConfigStore.setState({ config: original });
    let writes = 0;
    apiClient.instance.defaults.adapter = async config => {
      if (config.method !== 'get') {
        assert.equal(config.method, 'put');
        assert.equal(config.headers.get('If-Match'), `"${String(writes).repeat(64)}"`);
        writes++;
        items = JSON.parse(config.data).map(({ keys, ...item }) => ({ ...item, 'api-key-entries': keys }));
        return response(config, {});
      }
      if (config.url === '/config.yaml') return { ...response(config, 'server: {port: 8317}\n'), headers: { etag: `"${String(writes).repeat(64)}"` } };
      if (config.url === '/config') return response(config, { 'openai-compatibility': items });
      if (config.url === '/config/api-keys/openai-compatibility') return response(config, openaiGroups(items));
      if (config.url === '/openai-compatibility') return response(config, { 'openai-compatibility': items });
      if (config.url === '/vertex-api-key') return response(config, []);
      throw new Error(`Unexpected request: ${config.url}`);
    };
    const wb = workbench();
    await (action === 'delete' ? wb.deleteProvider(opened) : wb.toggleDisabled(opened, action === 'disable'));
    assert.equal(writes, 2);
    assert.deepEqual(items.find(item => item.name === openaiB.name), openaiB);
    if (action === 'delete') assert.deepEqual(items, [openaiB]);
    else assert.deepEqual(items.filter(item => item.name !== openaiB.name).map(item => item.disabled), [action === 'disable', action === 'disable']);
  });
  test(`sponsor ${action} rejects changed OpenAI data before touching other protocols`, async () => {
    const sponsor = { ...openaiA, 'base-url': 'https://code0.ai/v1' };
    const before = { 'openai-compatibility': [sponsor, openaiB], 'codex-api-key': [{ 'api-key': 'synthetic', 'base-url': 'https://code0.ai/v1' }] };
    const opened = code0ToResource(buildCode0Raw(normalizeConfigResponse(before)));
    const latest = { ...before, 'openai-compatibility': [openaiB, sponsor] };
    apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
    useConfigStore.setState({ config: normalizeConfigResponse(latest) });
    let writes = 0;
    apiClient.instance.defaults.adapter = async config => {
      if (config.method !== 'get') writes++;
      return response(config, latest);
    };
    const wb = workbench();
    await assert.rejects(action === 'delete' ? wb.deleteProvider(opened) : wb.toggleDisabled(opened, action === 'disable'), /changed/);
    assert.equal(writes, 0);
  });
}

test('server conflict after final reads is surfaced without retry or legacy fallback', async () => {
  apiClient.setConfig({ apiBase: 'https://example.invalid', managementKey: 'synthetic' });
  let writes = 0;
  apiClient.instance.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      writes++;
      assert.equal(config.headers.get('If-Match'), revision);
      throw Object.assign(new Error('Configuration changed after final read'), { status: 412 });
    }
    if (config.url === '/config.yaml') return response(config, 'server: {port: 8317}\n');
    if (config.url === '/config') return response(config, { 'codex-api-key': effective });
    return response(config, groups);
  };
  await assert.rejects(mutateProviderConfig('codex-api-key', (items) => items), /changed after final read/);
  assert.equal(writes, 1);
});

// These endpoints intentionally differ as they do in Core: config omits false and runtime indexes.
function statefulProviders(raw, { v8 = true } = {}) {
  apiClient.setConfig({ apiBase: 'https://stateful.invalid', managementKey: 'synthetic' });
  useConfigStore.getState().clearCache();
  let current = structuredClone(raw);
  let version = 0;
  const writes = [];
  const etag = () => `"${String(version).padStart(64, '0')}"`;
  const openaiView = () => (current['openai-compatibility'] ?? []).map(item => ({
    ...item, disabled: item.disabled ?? false,
    'api-key-entries': (item['api-key-entries'] ?? []).map(key => ({ ...key, 'auth-index': 'synthetic-runtime' })),
  }));
  apiClient.instance.defaults.adapter = async config => {
    const reply = data => ({ ...response(config, structuredClone(data)), headers: { etag: etag() } });
    const family = config.url.split('/').at(-1);
    const section = family === 'openai-compatibility' ? family : `${family}-api-key`;
    if (config.method !== 'get') {
      writes.push(config);
      if (config.method === 'put') {
        assert.equal(config.headers.get('If-Match'), etag());
        const groups = JSON.parse(config.data);
        current[section] = family === 'openai-compatibility'
          ? groups.map(({ keys, ...item }) => {
              if (item.disabled === false) delete item.disabled;
              return { ...item, 'api-key-entries': keys };
            })
          : groups.flatMap(({ name, keys, ...group }) => keys.map(key => ({ ...group, ...key })));
      } else if (config.method === 'patch') {
        const body = JSON.parse(config.data);
        const target = current['openai-compatibility'].find(item => item.name === body.name);
        if (body.value.disabled) target.disabled = true;
        else delete target.disabled;
      } else if (config.method === 'delete') {
        const name = new URL(`https://stateful.invalid${config.url}`).searchParams.get('name');
        current['openai-compatibility'] = current['openai-compatibility'].filter(item => item.name !== name);
      }
      version++;
      return reply({});
    }
    if (config.url === '/config.yaml') return reply(v8 ? 'server: {port: 8317}\n' : 'port: 8317\n');
    if (config.url === '/config') return reply(current);
    if (config.url === '/openai-compatibility') return reply({ 'openai-compatibility': openaiView() });
    if (config.url === '/vertex-api-key') return reply({ 'vertex-api-key': current['vertex-api-key'] ?? [] });
    if (config.url === '/config/api-keys/openai-compatibility') return reply(openaiGroups(current['openai-compatibility'] ?? []));
    if (config.url.startsWith('/config/api-keys/')) return reply((current[section] ?? []).map(({ 'base-url': url, ...key }, index) => ({ name: `group-${index}`, 'base-url': url, keys: [key] })));
    throw new Error(`Unexpected request: ${config.url}`);
  };
  return { writes, get raw() { return current; }, replace(next) { current = structuredClone(next); version++; } };
}

for (const v8 of [true, false]) {
  test(`real endpoint shapes permit sequential OpenAI operations after readback (${v8 ? 'v8' : 'legacy'})`, async () => {
    const fixture = statefulProviders({ 'openai-compatibility': [openaiA, openaiB] }, { v8 });
    await workbench().refetch();
    const selected = useConfigStore.getState().config.openaiCompatibility[0];
    assert.equal(selected.disabled, false);
    assert.equal(selected.apiKeyEntries[0].authIndex, 'synthetic-runtime');
    fixture.replace({ 'openai-compatibility': [openaiA, { ...openaiB, priority: 42 }] });
    await workbench().deleteProvider(openaiToResource(selected, 0));
    let remaining = useConfigStore.getState().config.openaiCompatibility[0];
    assert.equal(remaining.priority, 42);
    assert.equal(remaining.sourceIndex, 0);
    await workbench().toggleDisabled(openaiToResource(remaining, 0), true);
    remaining = useConfigStore.getState().config.openaiCompatibility[0];
    assert.equal(remaining.disabled, true);
    await workbench().toggleDisabled(openaiToResource(remaining, 0), false);
    remaining = useConfigStore.getState().config.openaiCompatibility[0];
    assert.equal(remaining.disabled, false);
    await workbench().deleteProvider(openaiToResource(remaining, 0));
    assert.deepEqual(useConfigStore.getState().config.openaiCompatibility, []);
    assert.equal(fixture.writes.length, 4);
  });
}

test('provider refresh keeps wire raw; explicit full-list baseline cannot be replaced by store refresh', async () => {
  const fixture = statefulProviders({ 'openai-compatibility': [openaiA, openaiB] });
  await workbench().refetch();
  const store = useConfigStore.getState();
  assert.deepEqual(store.config.raw, fixture.raw);
  const baseline = structuredClone(store.config.openaiCompatibility);
  store.updateConfigValue('openai-compatibility', baseline);
  assert.deepEqual(useConfigStore.getState().config.raw, fixture.raw);
  await providersApi.saveOpenAIProviders([{ ...baseline[0], priority: 9 }, baseline[1]], baseline);
  assert.equal(fixture.raw['openai-compatibility'][0].priority, 9);
  await workbench().refetch();
  await assert.rejects(providersApi.saveOpenAIProviders(baseline, baseline), /changed/);
  const latest = useConfigStore.getState().config.openaiCompatibility;
  await providersApi.updateOpenAIProvider(latest[0].name, 0, { ...latest[0], priority: 10 }, latest[0]);
  await providersApi.createOpenAIProvider({ name: 'new', baseUrl: 'https://new.invalid', apiKeyEntries: [] });
  assert.equal(fixture.writes.length, 3);
});

test('Sponsor aggregate ignores runtime attribution but retains configuration fields', async () => {
  const fixture = statefulProviders({ 'openai-compatibility': [{ ...openaiA, 'base-url': 'https://code0.ai/v1' }] });
  await workbench().refetch();
  let selected = code0ToResource(buildCode0Raw(useConfigStore.getState().config));
  await workbench().toggleDisabled(selected, true);
  selected = code0ToResource(buildCode0Raw(useConfigStore.getState().config));
  await workbench().deleteProvider(selected);
  assert.deepEqual(fixture.raw['openai-compatibility'], []);
  assert.equal(fixture.writes.length, 2);
});

test('Sponsor same-family sequences advance without accepting a changed later target', async () => {
  for (const family of ['codex', 'gemini', 'claude']) {
    const section = `${family}-api-key`;
    const original = [1, 2].map(index => ({ 'api-key': `synthetic-${index}`, 'base-url': family === 'codex' ? 'https://code0.ai/v1' : 'https://code0.ai' }));
    const fixture = statefulProviders({ [section]: original });
    await workbench().refetch();
    const resource = () => code0ToResource(buildCode0Raw(useConfigStore.getState().config));
    await workbench().toggleDisabled(resource(), true);
    assert.ok(fixture.raw[section].every(item => item['excluded-models'].includes('*')));
    await workbench().toggleDisabled(resource(), false);
    assert.ok(fixture.raw[section].every(item => !item['excluded-models']?.includes('*')));
    await workbench().deleteProvider(resource());
    assert.deepEqual(fixture.raw[section], []);
    assert.equal(fixture.writes.length, 6);
  }
  const section = 'codex-api-key';
  const rows = [1, 2].map(index => ({ 'api-key': `synthetic-${index}`, 'base-url': 'https://code0.ai/v1' }));
  const fixture = statefulProviders({ [section]: rows });
  const transport = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async config => {
    const result = await transport(config);
    if (config.method === 'put' && fixture.writes.length === 1)
      fixture.replace({ [section]: [fixture.raw[section][0], { ...rows[1], priority: 42 }] });
    return result;
  };
  await workbench().refetch();
  const selected = code0ToResource(buildCode0Raw(useConfigStore.getState().config));
  await assert.rejects(workbench().toggleDisabled(selected, true), error => error.name === 'SponsorPartialMutationError');
  assert.equal(fixture.writes.length, 1);
  assert.equal(useConfigStore.getState().config.codexApiKeys[1].priority, 42);
});

test('late provider readback cannot overwrite a newer store refresh or another connection', async () => {
  const fixture = statefulProviders({ 'openai-compatibility': [openaiA] });
  const transport = apiClient.instance.defaults.adapter;
  let release;
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  let held = false;
  apiClient.instance.defaults.adapter = async config => {
    const result = await transport(config);
    if (config.url === '/config' && !held) {
      held = true;
      started();
      await new Promise(resolve => { release = resolve; });
    }
    return result;
  };
  const old = useConfigStore.getState().refreshProviders();
  await pending;
  fixture.replace({ 'openai-compatibility': [{ ...openaiA, priority: 42 }] });
  await useConfigStore.getState().refreshProviders();
  release();
  assert.equal(await old, null);
  assert.equal(useConfigStore.getState().config.openaiCompatibility[0].priority, 42);
  held = false;
  const pendingConnection = new Promise(resolve => { started = resolve; });
  const obsolete = useConfigStore.getState().refreshProviders();
  await pendingConnection;
  apiClient.setConfig({ apiBase: 'https://other.invalid', managementKey: 'synthetic' });
  useConfigStore.getState().clearCache();
  release();
  assert.equal(await obsolete, null);
  assert.equal(useConfigStore.getState().config, null);
});
