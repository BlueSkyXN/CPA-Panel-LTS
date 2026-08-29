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
  client,
  adapters,
  code0,
  fennoAI,
  qiniuCloud,
  infistar,
  sponsorDefinitions,
  descriptors,
  brandLogos,
  claudeApi,
  thinkingLevels,
  modelInputListUtils,
] = await Promise.all([
  vite.ssrLoadModule('/src/services/api/transformers.ts'),
  vite.ssrLoadModule('/src/services/api/providers.ts'),
  vite.ssrLoadModule('/src/services/api/client.ts'),
  vite.ssrLoadModule('/src/features/providers/adapters.ts'),
  vite.ssrLoadModule('/src/features/providers/code0.ts'),
  vite.ssrLoadModule('/src/features/providers/fennoAI.ts'),
  vite.ssrLoadModule('/src/features/providers/qiniuCloud.ts'),
  vite.ssrLoadModule('/src/features/providers/infistar.ts'),
  vite.ssrLoadModule('/src/features/providers/sponsorDefinitions.ts'),
  vite.ssrLoadModule('/src/features/providers/descriptors.ts'),
  vite.ssrLoadModule('/src/features/providers/brandLogos.ts'),
  vite.ssrLoadModule('/src/features/providers/claudeApi.ts'),
  vite.ssrLoadModule('/src/features/providers/thinkingLevels.ts'),
  vite.ssrLoadModule('/src/components/ui/modelInputListUtils.ts'),
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

test('adapts configured Infistar endpoints without promotional metadata', () => {
  const config = {
    openaiCompatibility: [
      {
        name: 'Infistar official',
        baseUrl: infistar.INFISTAR_DOMESTIC_BASE_URL,
        apiKeyEntries: [{ apiKey: 'openai-key' }],
        sourceIndex: 4,
      },
      {
        name: 'infistar-custom',
        baseUrl: 'https://gateway.example.test/v1',
        apiKeyEntries: [{ apiKey: 'custom-key' }],
        sourceIndex: 7,
      },
    ],
    claudeApiKeys: [{ apiKey: 'claude-key', baseUrl: infistar.INFISTAR_DOMESTIC_ROOT_URL }],
    codexApiKeys: [{ apiKey: 'codex-key', baseUrl: infistar.INFISTAR_GLOBAL_BASE_URL }],
    geminiApiKeys: [{ apiKey: 'gemini-key', baseUrl: infistar.INFISTAR_GLOBAL_ROOT_URL }],
  };

  const raw = infistar.buildInfistarRaw(config);
  assert.deepEqual(
    raw.openai.map((item) => item.index),
    [4]
  );
  assert.equal(infistar.isInfistarOpenAIProvider(config.openaiCompatibility[1]), false);
  assert.deepEqual(
    raw.claude.map((item) => item.index),
    [0]
  );
  assert.deepEqual(
    raw.codex.map((item) => item.index),
    [0]
  );
  assert.deepEqual(
    raw.gemini.map((item) => item.index),
    [0]
  );

  const resource = adapters.infistarToResource(raw);
  assert.equal(resource?.brand, 'infistar');
  assert.equal(resource?.name, '无限星河');
  assert.deepEqual(resource?.flags.protocols, ['openai', 'anthropic', 'gemini', 'codexResponses']);

  const definition = sponsorDefinitions.getSponsorProviderDefinition('infistar');
  assert.deepEqual(definition.protocols, ['openai', 'claude', 'gemini', 'codex']);
  assert.deepEqual(
    definition.baseUrlOptions.map(({ id, baseUrl }) => ({ id, baseUrl })),
    [
      { id: 'domestic', baseUrl: 'https://coneverse.com/v1' },
      { id: 'overseas', baseUrl: 'https://infistar.ai/v1' },
    ]
  );
  assert.equal(
    Object.keys(definition).some((key) => key.toLowerCase().includes('affiliate')),
    false
  );
  assert.equal(
    Object.keys(infistar).some((key) => key.toLowerCase().includes('affiliate')),
    false
  );
  assert.equal(descriptors.PROVIDER_BRAND_ORDER.at(-1), 'infistar');
  assert.match(brandLogos.PROVIDER_LOGOS.infistar.src, /infistar\.png/);
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
  assert.equal(claudeApi.CLAUDE_API_DISPLAY_NAME, 'Claudeapi.com');
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

test('round-trips the Claude fingerprint profile without dropping unknown fields', async () => {
  const config = transformers.normalizeConfigResponse({
    'claude-api-key': [
      {
        'api-key': 'claude-secret',
        'base-url': 'https://api.anthropic.com',
        'fingerprint-profile': 'claude-code-cli',
      },
    ],
  });

  assert.deepEqual(config.claudeApiKeys, [
    {
      apiKey: 'claude-secret',
      baseUrl: 'https://api.anthropic.com',
      fingerprintProfile: 'claude-code-cli',
    },
  ]);
  assert.equal(
    adapters.claudeToResource(config.claudeApiKeys[0], 0).flags.claudeCodeCliProfile,
    true
  );
  assert.equal(
    adapters.claudeApiToResource(config.claudeApiKeys[0], 0).flags.claudeCodeCliProfile,
    true
  );

  const originalGet = client.apiClient.get;
  const originalPut = client.apiClient.put;
  const calls = [];
  let configRead = 0;
  client.apiClient.get = async (url) => {
    calls.push({ method: 'GET', url });
    configRead += 1;
    return configRead === 1
      ? { 'claude-api-key': [] }
      : {
          'claude-api-key': [
            {
              'api-key': 'claude-secret',
              'base-url': 'https://api.anthropic.com',
              'fingerprint-profile': 'claude-code-cli',
              'experimental-cch-signing': true,
              'future-field': 'preserved',
              'auth-index': 'response-only',
            },
          ],
        };
  };
  client.apiClient.put = async (url, data) => {
    calls.push({ method: 'PUT', url, data });
  };

  try {
    await providers.providersApi.createClaudeConfig({
      apiKey: 'new-claude-secret',
      baseUrl: 'https://api.anthropic.com',
      fingerprintProfile: 'claude-code-cli',
    });
    await providers.providersApi.updateClaudeConfig('claude-secret', 'https://api.anthropic.com', {
      apiKey: 'claude-secret',
      baseUrl: 'https://api.anthropic.com',
      fingerprintProfile: '',
    });
  } finally {
    client.apiClient.get = originalGet;
    client.apiClient.put = originalPut;
  }

  assert.deepEqual(calls, [
    { method: 'GET', url: '/config' },
    {
      method: 'PUT',
      url: '/claude-api-key',
      data: [
        {
          'api-key': 'new-claude-secret',
          'base-url': 'https://api.anthropic.com',
          'fingerprint-profile': 'claude-code-cli',
        },
      ],
    },
    { method: 'GET', url: '/config' },
    {
      method: 'PUT',
      url: '/claude-api-key',
      data: [
        {
          'future-field': 'preserved',
          'api-key': 'claude-secret',
          'base-url': 'https://api.anthropic.com',
        },
      ],
    },
  ]);
});

test('updates standard thinking levels without dropping advanced config', () => {
  assert.deepEqual(thinkingLevels.THINKING_LEVELS, [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'none',
    'auto',
  ]);

  const existing = {
    levels: ['LOW', 'ultra', 'vendor-custom'],
    min: 128,
    max: 32768,
    zero_allowed: true,
    dynamic_allowed: true,
    'future-field': { enabled: true },
  };
  assert.deepEqual(thinkingLevels.readThinkingLevels(existing), ['low', 'none', 'auto']);

  assert.deepEqual(
    thinkingLevels.mergeThinkingLevels(existing, ['low', 'high', 'max', 'none', 'auto']),
    {
      levels: ['low', 'high', 'max', 'ultra', 'vendor-custom'],
      min: 128,
      max: 32768,
      zero_allowed: true,
      dynamic_allowed: true,
      'future-field': { enabled: true },
    }
  );

  assert.deepEqual(thinkingLevels.mergeThinkingLevels(existing, ['low', 'high', 'max']), {
    levels: ['low', 'high', 'max', 'ultra', 'vendor-custom'],
    min: 128,
    max: 32768,
    'future-field': { enabled: true },
  });

  assert.deepEqual(thinkingLevels.mergeThinkingLevels(existing, []), {
    levels: ['ultra', 'vendor-custom'],
    min: 128,
    max: 32768,
    'future-field': { enabled: true },
  });
  assert.equal(thinkingLevels.mergeThinkingLevels({ levels: ['low'] }, []), undefined);
});

test('keeps thinking JSON as the editor source of truth', () => {
  const updated = thinkingLevels.updateThinkingLevelsJson(
    JSON.stringify({ levels: ['low'], custom: 'keep' }),
    ['low', 'high', 'max']
  );
  assert.deepEqual(JSON.parse(updated), {
    levels: ['low', 'high', 'max'],
    custom: 'keep',
  });
  assert.equal(thinkingLevels.updateThinkingLevelsJson('', []), '');
  assert.deepEqual(
    JSON.parse(
      thinkingLevels.updateThinkingBudgetJson(
        JSON.stringify({ levels: ['ultra'], custom: 'keep' }),
        'min',
        256
      )
    ),
    { levels: ['ultra'], custom: 'keep', min: 256 }
  );
  assert.equal(thinkingLevels.hasThinkingBudgetRangeError({ min: 1024, max: 512 }), true);
  assert.equal(thinkingLevels.hasThinkingBudgetRangeError({ min: 512, max: 1024 }), false);
  assert.throws(() => thinkingLevels.parseThinkingJson('[]'), /JSON object/);
  assert.throws(() => thinkingLevels.parseThinkingJson('{'), SyntaxError);
});

test('legacy model inputs preserve fields that are not visually editable', () => {
  const original = [
    {
      name: 'gpt-5.6-sol',
      alias: 'sol',
      displayName: 'Sol',
      priority: 7,
      testModel: 'probe-sol',
      image: true,
      thinking: {
        levels: ['high', 'ultra', 'vendor-custom'],
        min: 128,
        max: 32768,
        'future-field': { enabled: true },
      },
    },
  ];

  const entries = modelInputListUtils.modelsToEntries(original);
  entries[0].alias = 'sol-updated';
  assert.deepEqual(modelInputListUtils.entriesToModels(entries), [
    {
      ...original[0],
      alias: 'sol-updated',
    },
  ]);
});
