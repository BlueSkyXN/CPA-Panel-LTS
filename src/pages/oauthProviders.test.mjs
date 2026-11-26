import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const {
  getGeminiProviderScopeActions,
  getVisibleOAuthProviders,
  isGeminiCliOAuthPluginAvailable,
} = await vite.ssrLoadModule('/src/pages/oauthProviders.ts');
test.after(() => vite.close());

test('P1-09: isGeminiCliOAuthPluginAvailable fails closed when disconnected, unsupported, or missing plugin', () => {
  const enabledGeminiPlugin = [
    {
      id: 'gemini-plugin',
      effectiveEnabled: true,
      supportsOAuth: true,
      oauthProviders: ['other', 'gemini-cli'],
    },
  ];

  assert.equal(
    isGeminiCliOAuthPluginAvailable(enabledGeminiPlugin, {
      connected: false,
      supportsPlugin: true,
    }),
    false
  );
  assert.equal(
    isGeminiCliOAuthPluginAvailable(enabledGeminiPlugin, {
      connected: true,
      supportsPlugin: false,
    }),
    false
  );
  assert.equal(
    isGeminiCliOAuthPluginAvailable(null, {
      connected: true,
      supportsPlugin: true,
    }),
    false
  );
  assert.equal(
    isGeminiCliOAuthPluginAvailable(
      [
        {
          id: 'disabled-plugin',
          effectiveEnabled: false,
          supportsOAuth: true,
          oauthProvider: 'gemini-cli',
        },
      ],
      { connected: true, supportsPlugin: true }
    ),
    false
  );
  assert.equal(
    isGeminiCliOAuthPluginAvailable(enabledGeminiPlugin, {
      connected: true,
      supportsPlugin: true,
    }),
    true
  );
});

test('P1-09: getVisibleOAuthProviders gates gemini-cli card and inserts it after antigravity when supported', () => {
  const builtin = [{ id: 'codex' }, { id: 'antigravity' }, { id: 'kimi' }];
  const gemini = { id: 'gemini-cli' };

  assert.deepEqual(
    getVisibleOAuthProviders(builtin, gemini, false).map((item) => item.id),
    ['codex', 'antigravity', 'kimi']
  );
  assert.deepEqual(
    getVisibleOAuthProviders(builtin, gemini, true).map((item) => item.id),
    ['codex', 'antigravity', 'gemini-cli', 'kimi']
  );
});

test('P1-09: getGeminiProviderScopeActions includes /oauth?provider=gemini-cli only when plugin supported', () => {
  const labels = {
    oauth: 'OAuth',
    credentials: 'Credentials',
    apiKeys: 'API Keys',
    quota: 'Quota',
  };

  assert.deepEqual(
    getGeminiProviderScopeActions(false, labels).map((item) => item.path),
    ['/auth-files?provider=gemini-cli', '/ai-providers?provider=gemini', '/quota?provider=gemini-cli']
  );
  assert.deepEqual(
    getGeminiProviderScopeActions(true, labels).map((item) => item.path),
    [
      '/oauth?provider=gemini-cli',
      '/auth-files?provider=gemini-cli',
      '/ai-providers?provider=gemini',
      '/quota?provider=gemini-cli',
    ]
  );
});
