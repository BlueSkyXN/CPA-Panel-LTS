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
const [{ OAuthExcludedCard }, { OAuthModelAliasCard }, { canWriteOAuthConfig }] = await Promise.all(
  [
    vite.ssrLoadModule('/src/features/authFiles/components/OAuthExcludedCard.tsx'),
    vite.ssrLoadModule('/src/features/authFiles/components/OAuthModelAliasCard.tsx'),
    vite.ssrLoadModule('/src/features/authFiles/constants.ts'),
  ]
);

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
