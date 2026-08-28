import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

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
  { normalizeOauthModelAlias, serializeOauthModelAliases },
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
