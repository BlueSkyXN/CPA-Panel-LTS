import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [
  transformers,
  providers,
  adapters,
  code0,
  fennoAI,
  qiniuCloud,
  sponsorDefinitions,
  claudeApi,
] = await Promise.all([
  vite.ssrLoadModule('/src/services/api/transformers.ts'),
  vite.ssrLoadModule('/src/services/api/providers.ts'),
  vite.ssrLoadModule('/src/features/providers/adapters.ts'),
  vite.ssrLoadModule('/src/features/providers/code0.ts'),
  vite.ssrLoadModule('/src/features/providers/fennoAI.ts'),
  vite.ssrLoadModule('/src/features/providers/qiniuCloud.ts'),
  vite.ssrLoadModule('/src/features/providers/sponsorDefinitions.ts'),
  vite.ssrLoadModule('/src/features/providers/claudeApi.ts'),
]);

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('preserves backend indices and keeps custom branded endpoints in the generic group', () => {
  const config = transformers.normalizeConfigResponse({
    'openai-compatibility': [
      { name: 'invalid-without-base-url' },
      {
        name: 'Code0 official',
        'base-url': 'https://code0.ai/v1',
        'api-key-entries': [{ 'api-key': 'official-code0-key' }],
      },
      {
        name: 'code0',
        'base-url': 'https://custom-code0.example.test/v1',
        'api-key-entries': [{ 'api-key': 'custom-code0-key' }],
      },
      {
        name: 'qiniuCloud',
        'base-url': 'https://custom-qiniu.example.test/v1',
        'api-key-entries': [{ 'api-key': 'custom-qiniu-key' }],
      },
      {
        name: 'fennoAI',
        'base-url': 'https://api.fenno.ai/v1',
        'api-key-entries': [{ 'api-key': 'fenno-openai-key' }],
      },
    ],
  });

  assert.deepEqual(
    config.openaiCompatibility.map((item) => item.sourceIndex),
    [1, 2, 3, 4]
  );
  assert.equal(providers.getOpenAIProviderMutationIndex(config.openaiCompatibility[0], 0), 1);

  const code0Raw = code0.buildCode0Raw(config);
  assert.deepEqual(
    code0Raw.openai.map((item) => item.index),
    [1]
  );

  assert.equal(code0.isCode0OpenAIProvider(config.openaiCompatibility[1]), false);
  assert.equal(qiniuCloud.isQiniuCloudOpenAIProvider(config.openaiCompatibility[2]), false);
  assert.deepEqual(fennoAI.buildFennoAIRaw(config).openai, []);

  const customCode0Resource = adapters.openaiToResource(config.openaiCompatibility[1], 0);
  assert.equal(customCode0Resource.originalIndex, 2);
  assert.deepEqual(customCode0Resource.selector, {
    brand: 'openaiCompatibility',
    name: 'code0',
    index: 2,
  });
});

test('deletes sponsor OpenAI entries by unique descending source index', () => {
  const raw = {
    openai: [
      { config: { name: 'a' }, index: 2 },
      { config: { name: 'b' }, index: 5 },
      { config: { name: 'duplicate' }, index: 2 },
    ],
    claude: [],
    codex: [],
    gemini: [],
  };

  assert.deepEqual(sponsorDefinitions.getSponsorOpenAIDeleteIndices(raw), [5, 2]);
});

test('recognizes the current and legacy ClaudeAPI gateways without affiliate metadata', () => {
  assert.equal(claudeApi.CLAUDE_API_BASE_URL, 'https://gw.apito.ai');
  assert.equal(claudeApi.CLAUDE_API_LEGACY_BASE_URL, 'https://gw.claudeapi.com');
  assert.equal(claudeApi.isClaudeApiProvider({ baseUrl: 'https://gw.apito.ai/' }), true);
  assert.equal(claudeApi.isClaudeApiProvider({ baseUrl: 'HTTPS://GW.CLAUDEAPI.COM' }), true);
  assert.equal(
    claudeApi.isClaudeApiProvider({ baseUrl: 'https://custom-claude.example.test' }),
    false
  );
  assert.equal(
    Object.keys(claudeApi).some((key) => key.toLowerCase().includes('affiliate')),
    false
  );
});
