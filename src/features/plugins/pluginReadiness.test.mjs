import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const { parsePluginReadiness, readinessAccounts } = await vite.ssrLoadModule(
  '/src/features/plugins/pluginReadiness.ts'
);
const { apiClient, ltsExtensionClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { pluginsApi } = await vite.ssrLoadModule('/src/services/api/plugins.ts');
const { buildPluginConfigDraft, buildPluginConfigPatch } = await vite.ssrLoadModule(
  '/src/features/plugins/pluginConfigDraft.ts'
);

test('boolean configuration distinguishes inheritance from explicit false', () => {
  const fields = [{ name: 'override', type: 'boolean', enumValues: [], description: '' }];
  const draft = buildPluginConfigDraft({ enabled: true, configFields: fields }, {});
  assert.equal(draft.values.override, '');
  assert.deepEqual(buildPluginConfigPatch(draft, fields, (x) => x).patch, {});
  draft.touchedFields.override = true;
  assert.deepEqual(buildPluginConfigPatch(draft, fields, (x) => x).patch, { override: null });
  draft.values.override = false;
  assert.deepEqual(buildPluginConfigPatch(draft, fields, (x) => x).patch, { override: false });
});

test('enum inheritance clears only the touched override', () => {
  const fields = [{ name: 'mode', type: 'enum', enumValues: ['preserve', 'replace'], description: '' }];
  const draft = buildPluginConfigDraft({ enabled: true, configFields: fields }, { mode: 'replace', untouched: 'keep' });
  assert.deepEqual(buildPluginConfigPatch(draft, fields, (x) => x).patch, {});
  draft.values.mode = '';
  draft.touchedFields.mode = true;
  assert.deepEqual(buildPluginConfigPatch(draft, fields, (x) => x).patch, { mode: null });
});

test('unknown readiness never becomes success', () => {
  assert.equal(parsePluginReadiness({ Ready: 'true' }).ready, false);
  assert.equal(
    parsePluginReadiness({
      Ready: true,
      Checks: [{ Level: 'auth_ready', State: 'future', Message: 'safe' }],
    }).checks[0].state,
    'unknown'
  );
  assert.equal(
    parsePluginReadiness({ Ready: true, Checks: [{ Level: 'auth_ready', State: 'ready' }] }).ready,
    true
  );
  assert.equal(parsePluginReadiness({ storage: 'secret' }).checks.length, 0);
});
test('only enabled accounts of the executor provider are selectable', () => {
  const files = [
    { name: 'one', provider: 'fixture', authIndex: 'a' },
    { name: 'other', provider: 'other', authIndex: 'b' },
    { name: 'disabled', provider: 'fixture', authIndex: 'c', disabled: true },
    { name: 'no-index', provider: 'fixture' },
  ];
  assert.deepEqual(
    readinessAccounts(files, 'fixture').map((x) => x.name),
    ['one']
  );
});
test('list preserves additive capabilities and old hosts fail closed', async () => {
  const saved = apiClient.get;
  try {
    apiClient.get = async () => ({
      plugins: [
        {
          id: 'new',
          supports_auth: true,
          auth_provider: 'manual',
          supports_oauth: false,
          supports_readiness: true,
          executor_provider: 'manual',
        },
        { id: 'old' },
      ],
    });
    const { plugins } = await pluginsApi.list();
    assert.equal(plugins[0].supportsReadiness, true);
    assert.equal(plugins[0].supportsAuth, true);
    assert.equal(plugins[0].supportsOAuth, false);
    assert.equal(plugins[0].executorProvider, 'manual');
    assert.equal(plugins[1].supportsReadiness, false);
  } finally {
    apiClient.get = saved;
  }
});
test('diagnostic request sends only account index and encodes plugin id', async () => {
  // Readiness has no v8 route; it stays on the LTS extension client.
  const saved = ltsExtensionClient.get;
  let call;
  try {
    ltsExtensionClient.get = async (...args) => {
      call = args;
      return { Ready: false };
    };
    await pluginsApi.readiness('a/b', 'index');
    assert.equal(call[0], '/plugins/a%2Fb/readiness');
    assert.deepEqual(call[1].params, { auth_index: 'index' });
  } finally {
    ltsExtensionClient.get = saved;
  }
});
