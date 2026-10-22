import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { installFakeV8Core } from '../../services/api/testing/fakeV8Core.mjs';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
await i18n.changeLanguage('en');
const [
  { OAuthExcludedCard },
  { OAuthModelAliasCard },
  { canWriteOAuthConfig },
  { normalizeOauthModelAlias, serializeOauthModelAliases, normalizeOauthModelPolicy, authFilesApi },
  excludedRules,
  editorState,
] = await Promise.all([
  vite.ssrLoadModule('/src/features/authFiles/components/OAuthExcludedCard.tsx'),
  vite.ssrLoadModule('/src/features/authFiles/components/OAuthModelAliasCard.tsx'),
  vite.ssrLoadModule('/src/features/authFiles/constants.ts'),
  vite.ssrLoadModule('/src/services/api/authFiles.ts'),
  vite.ssrLoadModule('/src/features/authFiles/oauthExcludedRules.ts'),
  vite.ssrLoadModule('/src/features/authFiles/oauthEditorState.ts'),
]);

const noop = () => {};
const noopAsync = async () => {};

test('model policy preserves disabled lists and enabled empty allowlists', () => {
  assert.deepEqual(normalizeOauthModelPolicy({ 'oauth-model-policy': {
    Codex: { allowlist: { enabled: true, models: [] }, denylist: { enabled: false, models: ['GPT-*', 'gpt-*'] } },
  }}), { codex: { allowlist: { enabled: true, models: [] }, denylist: { enabled: false, models: ['GPT-*'] } } });
  assert.deepEqual(normalizeOauthModelPolicy({ 'oauth-model-policy': null }), {});
});

test('V8 model policy uses the original snapshot and moves exclusions in one conditional write', async () => {
  const { apiClient, ltsExtensionClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
  const originalGet = ltsExtensionClient.get;
  const core = installFakeV8Core(apiClient, { oauth: {
    'auth-dir': 'fixture',
    'model-alias': { kimi: [{ name: 'real', alias: 'public' }] },
    'excluded-models': { codex: ['old'], kimi: ['keep'] },
    'model-policy': { kimi: { denylist: { enabled: true, models: ['keep'] } } },
  }});
  try {
    ltsExtensionClient.get = async (path) => {
      if (path === '/oauth-model-policy') return {};
      assert.match(path, /^\/auth-files\/models\/policy-preview/);
      return { auth_id: 'fixture', provider: 'codex', catalog_status: 'snapshot', evaluations: [] };
    };
    assert.equal((await authFilesApi.getModelPolicyPreview('fixture')).catalog_status, 'snapshot');
    const stale = await authFilesApi.getOauthModelPolicySnapshot();
    core.concurrentEdit((doc) => { doc.oauth['auth-dir'] = 'changed'; });
    await assert.rejects(authFilesApi.saveOauthModelPolicy('codex', { allowlist: { enabled: true, models: [] } }, stale), (e) => e.status === 412);
    assert.equal(core.writes.length, 0);
    const fresh = await authFilesApi.getOauthModelPolicySnapshot();
    await authFilesApi.saveOauthModelPolicy('Codex', { allowlist: { enabled: true, models: [] }, denylist: { enabled: true, models: ['old'] } }, fresh, true);
    assert.equal(core.writes.length, 1);
    assert.equal(core.writes[0].url, '/config/oauth');
    assert.deepEqual(core.doc.oauth['model-policy'].codex.allowlist, { enabled: true, models: [] });
    assert.deepEqual(core.doc.oauth['excluded-models'], { kimi: ['keep'] });
    assert.deepEqual(core.doc.oauth['model-policy'].kimi, fresh.raw['model-policy'].kimi);
    assert.deepEqual(core.doc.oauth['model-alias'], fresh.raw['model-alias']);
    assert.equal(core.doc.oauth['auth-dir'], 'changed');
    assert.equal(core.calls.filter((c) => c.method === 'PUT').every((c) => c.base.endsWith('/v8/management')), true);
    const oldConnection = await authFilesApi.getOauthModelPolicySnapshot();
    apiClient.setConfig({ apiBase: 'https://another.invalid', managementKey: 'synthetic' });
    await assert.rejects(authFilesApi.saveOauthModelPolicy('codex', null, oldConnection), { name: 'AbortError' });
    assert.equal(core.writes.length, 1);
    ltsExtensionClient.get = async () => { throw Object.assign(new Error('unsupported'), { status: 404 }); };
    await assert.rejects(authFilesApi.getOauthModelPolicySnapshot(), (e) => e.status === 404);
  } finally {
    ltsExtensionClient.get = originalGet;
    core.restore();
    apiClient.clearConfig();
  }
});

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('requires a successfully loaded baseline before an OAuth editor can write', () => {
  assert.equal(
    canWriteOAuthConfig({ baselineReady: true, loadError: null, unsupported: false }),
    true
  );
  assert.equal(
    canWriteOAuthConfig({ baselineReady: false, loadError: null, unsupported: false }),
    false
  );
  assert.equal(
    canWriteOAuthConfig({ baselineReady: true, loadError: 'network failed', unsupported: false }),
    false
  );
  assert.equal(
    canWriteOAuthConfig({ baselineReady: true, loadError: null, unsupported: true }),
    false
  );
});

test('disables OAuth card writes and exposes retry after a load failure', () => {
  const excludedMarkup = renderToStaticMarkup(
    createElement(OAuthExcludedCard, {
      disableControls: false,
      excludedError: 'load',
      excluded: {},
      onRetry: noop,
      onAdd: noop,
      onEdit: noop,
      onDelete: noop,
    })
  );
  const aliasMarkup = renderToStaticMarkup(
    createElement(OAuthModelAliasCard, {
      disableControls: false,
      viewMode: 'list',
      onViewModeChange: noop,
      onRetry: noop,
      onAdd: noop,
      onEditProvider: noop,
      onDeleteProvider: noop,
      modelAliasError: 'load',
      modelAlias: {},
      allProviderModels: {},
      onUpdate: noopAsync,
      onDeleteLink: noop,
      onToggleFork: noopAsync,
      onRenameAlias: noopAsync,
      onDeleteAlias: noop,
    })
  );

  for (const markup of [excludedMarkup, aliasMarkup]) {
    assert.match(markup, /disabled=""/);
    assert.match(markup, />Refresh</);
  }
});

test('preserves OAuth model-alias force mapping in both wire variants', () => {
  const normalized = normalizeOauthModelAlias({
    'oauth-model-alias': {
      codex: [
        { name: 'gpt-source', alias: 'gpt-alias', 'force-mapping': true },
        { name: 'gpt-source-2', alias: 'gpt-alias-2', forceMapping: false },
      ],
    },
  });

  assert.deepEqual(normalized.codex, [
    { name: 'gpt-source', alias: 'gpt-alias', forceMapping: true },
    { name: 'gpt-source-2', alias: 'gpt-alias-2', forceMapping: false },
  ]);
  assert.deepEqual(serializeOauthModelAliases(normalized.codex), [
    { name: 'gpt-source', alias: 'gpt-alias', 'force-mapping': true },
    { name: 'gpt-source-2', alias: 'gpt-alias-2', 'force-mapping': false },
  ]);
});

test('normalizes and toggles OAuth excluded rules without dropping custom patterns', () => {
  assert.deepEqual(
    excludedRules.normalizeOAuthExcludedRules([' gpt-* ', 'GPT-*', '', 'claude-3']),
    ['gpt-*', 'claude-3']
  );
  assert.equal(excludedRules.hasOAuthExcludedRule(['GPT-4o'], 'gpt-4O'), true);
  assert.deepEqual(excludedRules.updateOAuthExcludedRule(['GPT-4o'], ' gpt-4O ', false), []);
  assert.deepEqual(excludedRules.updateOAuthExcludedRule(['gpt-4o'], ' gpt-* ', true), [
    'gpt-4o',
    'gpt-*',
  ]);
  assert.deepEqual(
    excludedRules.getCustomOAuthExcludedRules(
      ['gpt-4o', 'gpt-*', 'retired-model', 'CLAUDE-3'],
      ['GPT-4O', 'claude-3']
    ),
    ['gpt-*', 'retired-model']
  );
});

test('keeps OAuth dirty signatures stable while detecting partial edits', () => {
  assert.equal(
    editorState.getStringSetSignature(['b', 'a']),
    editorState.getStringSetSignature(['a', 'b'])
  );
  assert.equal(
    editorState.getModelAliasDraftSignature([{ id: 'one', name: '', alias: '', fork: true }]),
    editorState.getModelAliasDraftSignature([])
  );
  assert.notEqual(
    editorState.getModelAliasDraftSignature([
      { id: 'one', name: 'partial', alias: '', fork: true },
    ]),
    editorState.getModelAliasDraftSignature([])
  );
  assert.equal(editorState.isOAuthEditorDirty('codex', 'codex', 'same', 'same'), false);
  assert.equal(editorState.isOAuthEditorDirty('codex', 'claude', 'same', 'same'), true);
  assert.equal(editorState.isOAuthEditorDirty('codex', 'codex', 'before', 'after'), true);
});
