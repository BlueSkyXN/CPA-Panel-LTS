import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { installFakeV8Core, authIndexFor } from './testing/fakeV8Core.mjs';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ apiClient }, { providersApi }, { normalizeConfigResponse }, { isConfigRevisionConflict }, { useConfigStore }] =
  await Promise.all([
    vite.ssrLoadModule('/src/services/api/client.ts'),
    vite.ssrLoadModule('/src/services/api/providers.ts'),
    vite.ssrLoadModule('/src/services/api/transformers.ts'),
    vite.ssrLoadModule('/src/services/api/configRevision.ts'),
    vite.ssrLoadModule('/src/stores/useConfigStore.ts'),
  ]);

let core;
test.afterEach(() => core?.restore());
test.after(async () => {
  apiClient.clearConfig();
  await vite.close();
  globalThis.window = originalWindow;
});

const geminiDoc = () => ({
  'config-version': 8,
  'api-keys': {
    gemini: [
      {
        name: 'gemini-1',
        'base-url': 'https://gemini-a.invalid',
        keys: [{ 'api-key': 'synthetic-a', 'future-key-field': 'keep-a' }],
        'future-group-field': { keep: true },
      },
      { name: 'gemini-2', 'base-url': 'https://gemini-b.invalid', keys: [{ 'api-key': 'synthetic-b' }] },
    ],
    codex: [{ name: 'codex-1', 'base-url': 'https://codex.invalid', keys: [{ 'api-key': 'synthetic-codex' }] }],
  },
});

const loadConfig = async () => normalizeConfigResponse(await apiClient.get('/config'));
const writesOf = (calls) => calls.filter((call) => call.method !== 'GET');

test('provider writes send If-Match from the same GET, strip auth indexes, and preserve unknown fields', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const config = await loadConfig();
  const target = config.geminiApiKeys.find((item) => item.apiKey === 'synthetic-b');
  assert.equal(target.authIndex, authIndexFor('gemini', { 'api-key': 'synthetic-b' }));
  core.calls.length = 0;

  await providersApi.updateGeminiKey(target.apiKey, target.baseUrl, { ...target, priority: 3 });

  assert.deepEqual(
    core.calls.map(({ method, url }) => `${method} ${url}`),
    ['GET /config/api-keys/gemini', 'PUT /config/api-keys/gemini']
  );
  const [read, write] = core.calls;
  assert.equal(write.base, 'https://core.invalid/v8/management');
  assert.equal(write.ifMatch, read.etag);
  assert.equal(JSON.stringify(write.data).includes('auth_index'), false);
  assert.equal(JSON.stringify(write.data).includes('auth-index'), false);
  assert.equal(write.data[0].keys[0]['future-key-field'], 'keep-a');
  assert.deepEqual(write.data[0]['future-group-field'], { keep: true });
  assert.equal(write.data[1].keys[0].priority, 3);
});

test('every write re-reads the configuration: a cleared ETag is never reused', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  let config = await loadConfig();
  core.calls.length = 0;
  const a = config.geminiApiKeys[0];
  await providersApi.updateGeminiKey(a.apiKey, a.baseUrl, { ...a, priority: 1 });
  config = await loadConfig();
  const b = config.geminiApiKeys[1];
  await providersApi.updateGeminiKey(b.apiKey, b.baseUrl, { ...b, priority: 2 });
  const methods = core.calls.map(({ method, url }) => `${method} ${url}`);
  assert.deepEqual(methods, [
    'GET /config/api-keys/gemini',
    'PUT /config/api-keys/gemini',
    'GET /config',
    'GET /config/api-keys/gemini',
    'PUT /config/api-keys/gemini',
  ]);
  const puts = core.calls.filter((call) => call.method === 'PUT');
  assert.notEqual(puts[0].ifMatch, puts[1].ifMatch);
  assert.equal(puts[1].ifMatch, core.calls[3].etag);
});

test('412 and 428 surface as revision conflicts and are never retried blindly', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const config = await loadConfig();
  const target = config.geminiApiKeys[0];
  core.calls.length = 0;
  core.onBeforeWrite = (state) =>
    state.concurrentEdit((doc) => {
      doc['api-keys'].codex[0].keys[0].priority = 9;
    });
  const error = await providersApi
    .updateGeminiKey(target.apiKey, target.baseUrl, { ...target, priority: 5 })
    .then(() => null, (reason) => reason);
  assert.equal(error?.status, 412);
  assert.equal(isConfigRevisionConflict(error), true);
  assert.equal(writesOf(core.calls).length, 1);
  assert.equal(core.writes.length, 0);
  assert.equal(isConfigRevisionConflict({ status: 428 }), true);
  assert.equal(isConfigRevisionConflict({ status: 409 }), false);
});

test('F22: deleting with a stale snapshot after another edit changed the target fails with a conflict', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const stale = (await loadConfig()).geminiApiKeys[1];
  core.concurrentEdit((doc) => {
    doc['api-keys'].gemini[1].keys[0]['proxy-url'] = 'http://changed.invalid';
  });
  core.calls.length = 0;
  await assert.rejects(
    providersApi.deleteGeminiKey(stale.apiKey, stale.baseUrl, stale.source),
    /changed or is ambiguous/
  );
  assert.equal(writesOf(core.calls).length, 0);
  assert.equal(core.doc['api-keys'].gemini[1].keys.length, 1);
});

test('F22: a delete whose read raced another write is rejected by the revision (412)', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const current = (await loadConfig()).geminiApiKeys[1];
  core.onBeforeWrite = (state) =>
    state.concurrentEdit((doc) => {
      doc['api-keys'].gemini[0].keys[0].priority = 4;
    });
  await assert.rejects(
    providersApi.deleteGeminiKey(current.apiKey, current.baseUrl, current.source),
    (error) => error.status === 412
  );
  assert.equal(core.doc['api-keys'].gemini[1].keys.length, 1);
});

test('F24: changing provider B keeps provider A auth index for usage attribution', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const before = await useConfigStore.getState().refreshProviders();
  const authA = before.geminiApiKeys[0].authIndex;
  const codexAuth = before.codexApiKeys[0].authIndex;
  assert.ok(authA);
  const b = before.geminiApiKeys[1];
  await providersApi.updateGeminiKey(b.apiKey, b.baseUrl, { ...b, prefix: 'team-b' });
  const after = await useConfigStore.getState().refreshProviders();
  assert.equal(after.geminiApiKeys[0].authIndex, authA);
  assert.equal(after.codexApiKeys[0].authIndex, codexAuth);
  assert.equal(after.geminiApiKeys[1].prefix, 'team-b');
  assert.ok(after.geminiApiKeys[1].authIndex);
  // A single v8 read: no runtime list merge or snapshot gate.
  assert.deepEqual(
    core.calls.filter((call) => call.method === 'GET').map((call) => call.url),
    ['/config', '/config/api-keys/gemini', '/config']
  );
});

test('F23: renaming a Vertex model keeps force-mapping and unknown model metadata by sourceIndex', async () => {
  core = installFakeV8Core(apiClient, {
    'api-keys': {
      vertex: [
        {
          name: 'vertex-1',
          'base-url': 'https://vertex.invalid',
          keys: [
            {
              'api-key': 'synthetic-vertex',
              models: [
                { name: 'gemini-old', alias: 'pro', 'force-mapping': true, 'future-model': 'keep' },
                { name: 'gemini-other', alias: 'flash' },
              ],
            },
          ],
        },
      ],
    },
  });
  const vertex = (await loadConfig()).vertexApiKeys[0];
  assert.equal(vertex.models[0].forceMapping, true);
  assert.equal(vertex.models[0].sourceIndex, 0);
  await providersApi.updateVertexConfig(vertex.apiKey, vertex.baseUrl, {
    ...vertex,
    models: [vertex.models[1], { ...vertex.models[0], name: 'gemini-new' }],
  });
  const written = core.writes[0].data[0].keys[0].models;
  assert.deepEqual(written[0], { name: 'gemini-other', alias: 'flash' });
  assert.equal(written[1].name, 'gemini-new');
  assert.equal(written[1]['force-mapping'], true);
  assert.equal(written[1]['future-model'], 'keep');
});

test('runtime policy intent: inherit keeps an explicit null, override writes the key value', async () => {
  const { buildRuntimePolicy, readRuntimePolicy } = await vite.ssrLoadModule(
    '/src/features/providers/runtimePolicy.ts'
  );
  core = installFakeV8Core(apiClient, {
    'api-keys': {
      codex: [
        {
          name: 'codex-1',
          'base-url': 'https://codex.invalid',
          'request-retry': 3,
          keys: [{ 'api-key': 'synthetic-codex', 'request-retry': null, 'alpha-search': true }],
        },
      ],
    },
  });
  let codex = (await loadConfig()).codexApiKeys[0];
  const draft = readRuntimePolicy(codex);
  assert.equal(draft.retry, '');
  assert.equal(codex.alphaSearch, true);
  await providersApi.updateCodexConfig(codex.apiKey, codex.baseUrl, {
    ...codex,
    priority: 2,
    ...buildRuntimePolicy(draft),
  });
  assert.equal(core.writes[0].data[0].keys[0]['request-retry'], null);
  assert.equal(core.writes[0].data[0].keys[0]['alpha-search'], true);

  codex = (await loadConfig()).codexApiKeys[0];
  await providersApi.updateCodexConfig(codex.apiKey, codex.baseUrl, {
    ...codex,
    ...buildRuntimePolicy({ ...readRuntimePolicy(codex), retry: '5' }),
  });
  assert.equal(core.writes[1].data[0].keys[0]['request-retry'], 5);
  assert.equal(core.writes[1].data[0]['request-retry'], 3);
});

test('configPatch binds its first write to the caller revision and re-reads for later steps', async () => {
  const { applyConfigPatch } = await vite.ssrLoadModule('/src/services/api/configPatch.ts');
  core = installFakeV8Core(apiClient, { routing: { strategy: 'round-robin' }, debug: true });
  // PATCH is not modelled by the fake; exercise PUT/DELETE steps only.
  const plan = { patch: {}, deletions: [['debug']], emptyMaps: [['routing']] };
  const revision = core.etag();
  await applyConfigPatch(plan, apiClient.getConnectionRevision(), revision);
  const writes = core.calls.filter((call) => call.method !== 'GET');
  assert.equal(writes[0].ifMatch, revision);
  assert.equal(core.calls[1].url, '/config.yaml');
  assert.equal(writes[1].ifMatch, core.calls[1].etag);
  assert.deepEqual(core.doc, { routing: {} });
  core.concurrentEdit((doc) => {
    doc.debug = false;
  });
  await assert.rejects(
    applyConfigPatch({ patch: {}, deletions: [['debug']] }, apiClient.getConnectionRevision(), revision),
    (error) => error.status === 412
  );
});

test('key edits cannot implicitly change a shared group endpoint', async () => {
  const doc = geminiDoc();
  doc['api-keys'].gemini[0].keys.push({ 'api-key': 'synthetic-sibling' });
  core = installFakeV8Core(apiClient, doc);
  const key = (await loadConfig()).geminiApiKeys[0];
  await assert.rejects(
    providersApi.updateGeminiKey(key.apiKey, key.baseUrl, { ...key, baseUrl: 'https://changed.invalid' }),
    /group/i
  );
  assert.equal(core.writes.length, 0);
  assert.equal(core.doc['api-keys'].gemini[0]['base-url'], 'https://gemini-a.invalid');
});

test('explicit group edits preserve keys and unknown fields and bind the current revision', async () => {
  const doc = geminiDoc();
  doc['api-keys'].gemini[0].keys.push({ 'api-key': 'synthetic-sibling', 'request-retry': 7 });
  core = installFakeV8Core(apiClient, doc);
  const key = (await loadConfig()).geminiApiKeys[0];
  const originalKeys = structuredClone(core.doc['api-keys'].gemini[0].keys);
  await providersApi.updateGroup('gemini', key.source, {
    name: 'renamed', baseUrl: 'https://changed.invalid', requestRetry: 4,
  });
  const group = core.doc['api-keys'].gemini[0];
  assert.deepEqual(group.keys, originalKeys);
  assert.equal(group.name, 'renamed');
  assert.equal(group['base-url'], 'https://changed.invalid');
  assert.equal(group['request-retry'], 4);
  assert.deepEqual(group['future-group-field'], { keep: true });
  const writeIndex = core.calls.findIndex((call) => call.method === 'PUT');
  assert.equal(core.calls[writeIndex].ifMatch, core.calls[writeIndex - 1].etag);
  assert.equal(core.calls.at(-1).method, 'GET');
});

test('group editing refuses a changed member list even if the selected key is unchanged', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const key = (await loadConfig()).geminiApiKeys[0];
  core.concurrentEdit((doc) => doc['api-keys'].gemini[0].keys.push({ 'api-key': 'new-sibling' }));
  await assert.rejects(
    providersApi.updateGroup('gemini', key.source, { name: 'gemini-1', baseUrl: 'https://changed.invalid' }),
    /changed|ambiguous/
  );
  assert.equal(core.writes.length, 0);
});

test('group updates find the original group after sibling reordering', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const key = (await loadConfig()).geminiApiKeys[0];
  core.concurrentEdit((doc) => doc['api-keys'].gemini.reverse());
  await providersApi.updateGroup('gemini', key.source, { name: 'target', baseUrl: 'https://changed.invalid' });
  assert.equal(core.doc['api-keys'].gemini[0].name, 'gemini-2');
  assert.equal(core.doc['api-keys'].gemini[1].name, 'target');
});

test('group updates reject ambiguous duplicates and changes racing the write', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const key = (await loadConfig()).geminiApiKeys[0];
  core.concurrentEdit((doc) => doc['api-keys'].gemini.push(structuredClone(doc['api-keys'].gemini[0])));
  await assert.rejects(providersApi.updateGroup('gemini', key.source, { name: 'target', baseUrl: '' }), /ambiguous/);
  assert.equal(core.writes.length, 0);
  core.restore();
  core = installFakeV8Core(apiClient, geminiDoc());
  const current = (await loadConfig()).geminiApiKeys[0];
  core.onBeforeWrite = (state) => state.concurrentEdit((doc) => { doc['api-keys'].gemini[0].keys.push({ 'api-key': 'late-key' }); });
  await assert.rejects(providersApi.updateGroup('gemini', current.source, { name: 'target', baseUrl: '' }), (error) => error.status === 412);
  assert.equal(core.writes.length, 0);
});

test('group inherit intent removes overrides without materializing null defaults', async () => {
  const doc = geminiDoc();
  Object.assign(doc['api-keys'].gemini[0], { 'base-url': null, 'request-retry': 3, 'disable-cooling': null });
  core = installFakeV8Core(apiClient, doc);
  const key = (await loadConfig()).geminiApiKeys[0];
  await providersApi.updateGroup('gemini', key.source, {
    name: 'renamed', baseUrl: '', inheritFields: ['request-retry', 'disable-cooling', 'request-scoped-errors'],
  });
  const group = core.doc['api-keys'].gemini[0];
  assert.equal('request-retry' in group, false);
  assert.equal(group['disable-cooling'], null);
  assert.equal(group['base-url'], null);
});

test('a successful group PUT without matching readback is not reported as success', async () => {
  core = installFakeV8Core(apiClient, geminiDoc());
  const key = (await loadConfig()).geminiApiKeys[0];
  const adapter = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async (config) => {
    const result = await adapter(config);
    if (config.method === 'put') core.concurrentEdit((doc) => { doc['api-keys'].gemini[0].name = 'changed-again'; });
    return result;
  };
  await assert.rejects(providersApi.updateGroup('gemini', key.source, { name: 'target', baseUrl: key.baseUrl }), /changed|ambiguous/);
});

test('legacy display_name/displayName routing aliases are read as aliases and persisted canonically', async () => {
  core = installFakeV8Core(apiClient, {
    'config-version': 8,
    'api-keys': {
      'openai-compatibility': [
        {
          name: 'synthetic-openai',
          'base-url': 'https://openai.invalid/v1',
          keys: [{ 'api-key': 'synthetic-openai-key' }],
          models: [
            { name: 'm-snake', display_name: 'snake-alias', 'x-model-note': 'keep-snake' },
            { name: 'm-camel', displayName: 'camel-alias' },
            { name: 'm-label', alias: 'label-alias', 'display-name': 'Catalog Label' },
          ],
        },
      ],
    },
  });
  const config = await loadConfig();
  const provider = config.openaiCompatibility[0];
  assert.deepEqual(
    provider.models.map((model) => [model.name, model.alias, model.displayName]),
    [
      ['m-snake', 'snake-alias', undefined],
      ['m-camel', 'camel-alias', undefined],
      ['m-label', 'label-alias', 'Catalog Label'],
    ]
  );
  const models = provider.models.map((model) =>
    model.name === 'm-label' ? { ...model, displayName: 'Catalog Label Updated' } : model
  );
  await providersApi.updateOpenAIProvider(provider.name, 0, { ...provider, models });
  const written = writesOf(core.calls)[0].data[0].models;
  assert.deepEqual(written[0], { name: 'm-snake', alias: 'snake-alias', 'x-model-note': 'keep-snake' });
  assert.deepEqual(written[1], { name: 'm-camel', alias: 'camel-alias' });
  assert.equal(written[2]['display-name'], 'Catalog Label Updated');
  assert.equal(written[2].alias, 'label-alias');
});
