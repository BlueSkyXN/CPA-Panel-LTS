import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { installFakeV8Core } from '../../services/api/testing/fakeV8Core.mjs';

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
  providerUtils,
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
  vite.ssrLoadModule('/src/components/providers/utils.ts'),
]);

let core;
test.afterEach(() => core?.restore());
const readConfig = async () =>
  transformers.normalizeConfigResponse(await client.apiClient.get('/config'));
const stripSource = ({ source, ...rest }) => rest;

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
    'api-keys': {
      'openai-compatibility': [
        { name: 'invalid-without-base-url', keys: [] },
        {
          name: 'Code0 official',
          'base-url': 'https://code0.ai/v1',
          keys: [{ 'api-key': 'official-code0-key' }],
        },
        {
          name: 'code0',
          'base-url': 'https://custom-code0.example.test/v1',
          keys: [{ 'api-key': 'custom-code0-key' }],
        },
        {
          name: 'qiniuCloud',
          'base-url': 'https://custom-qiniu.example.test/v1',
          keys: [{ 'api-key': 'custom-qiniu-key' }],
        },
        {
          name: 'fennoAI',
          'base-url': 'https://api.fenno.ai/v1',
          keys: [{ 'api-key': 'fenno-openai-key' }],
        },
      ],
    },
  });

  assert.deepEqual(
    config.openaiCompatibility.map((item) => item.sourceIndex),
    [1, 2, 3, 4]
  );
  assert.deepEqual(
    config.openaiCompatibility.map((item) => item.source.groupIndex),
    [1, 2, 3, 4]
  );

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
  assert.deepEqual(descriptors.PROVIDER_BRAND_ORDER.slice(-2), ['infistar', 'kimi']);
  assert.match(brandLogos.PROVIDER_LOGOS.infistar.src, /infistar\.png/);
});

test('adapts configured Kimi endpoints as a config-detected group without affiliate links', async () => {
  const kimi = await vite.ssrLoadModule('/src/features/providers/kimi.ts');
  assert.equal(
    Object.keys(kimi).some((key) => /affiliate/i.test(key)),
    false
  );
  const config = transformers.normalizeConfigResponse({
    'api-keys': {
      'openai-compatibility': [
        { name: 'kimi', 'base-url': 'https://api.moonshot.cn/v1', keys: [{ 'api-key': 'synthetic-kimi' }] },
      ],
      claude: [
        {
          name: 'claude-kimi',
          'base-url': 'https://api.moonshot.cn/anthropic',
          keys: [{ 'api-key': 'synthetic-kimi-claude' }],
        },
      ],
    },
  });
  const raw = kimi.buildKimiRaw(config);
  assert.equal(raw.openai.length, 1);
  assert.equal(raw.claude.length, 1);
  const resource = adapters.kimiToResource(raw);
  assert.equal(resource.brand, 'kimi');
  assert.equal(sponsorDefinitions.isMultiProtocolSponsorBrand('kimi'), true);
  assert.ok(brandLogos.PROVIDER_LOGOS.kimi.src);
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
    'api-keys': {
      claude: [
        {
          name: 'claude-1',
          'base-url': 'https://api.anthropic.com',
          keys: [{ 'api-key': 'claude-secret', 'fingerprint-profile': 'claude-code-cli' }],
        },
      ],
    },
  });

  assert.deepEqual(stripSource(config.claudeApiKeys[0]), {
    apiKey: 'claude-secret',
    baseUrl: 'https://api.anthropic.com',
    fingerprintProfile: 'claude-code-cli',
  });
  assert.equal(
    adapters.claudeToResource(config.claudeApiKeys[0], 0).flags.claudeCodeCliProfile,
    true
  );
  assert.equal(
    adapters.claudeApiToResource(config.claudeApiKeys[0], 0).flags.claudeCodeCliProfile,
    true
  );

  core = installFakeV8Core(client.apiClient, {
    'api-keys': {
      claude: [
        {
          name: 'claude-1',
          'base-url': 'https://api.anthropic.com',
          keys: [
            {
              'api-key': 'claude-secret',
              'fingerprint-profile': 'claude-code-cli',
              'future-field': 'preserved',
            },
          ],
        },
      ],
    },
  });
  await providers.providersApi.createClaudeConfig({
    apiKey: 'new-claude-secret',
    baseUrl: 'https://api.anthropic.com',
    fingerprintProfile: 'claude-code-cli',
  });
  const current = (await readConfig()).claudeApiKeys.find((item) => item.apiKey === 'claude-secret');
  await providers.providersApi.updateClaudeConfig(current.apiKey, current.baseUrl, {
    ...current,
    fingerprintProfile: '',
  });

  assert.deepEqual(core.writes[0].data[1], {
    name: 'claude-2',
    'base-url': 'https://api.anthropic.com',
    keys: [{ 'api-key': 'new-claude-secret', 'fingerprint-profile': 'claude-code-cli' }],
  });
  assert.deepEqual(core.writes[1].data[0].keys[0], {
    'api-key': 'claude-secret',
    'future-field': 'preserved',
  });
});

test('round-trips credential weights without dropping provider fields', async () => {
  core = installFakeV8Core(client.apiClient, {
    'api-keys': {
      gemini: [
        {
          name: 'gemini-1',
          'base-url': 'https://gemini.example.test',
          keys: [{ 'api-key': 'gemini-secret', weight: 2, 'future-field': { keep: true } }],
        },
      ],
      'openai-compatibility': [
        {
          name: 'custom',
          'base-url': 'https://openai.example.test/v1',
          'future-provider-field': 'keep',
          keys: [{ 'api-key': 'openai-secret', weight: 3, 'future-entry-field': 'keep' }],
        },
      ],
    },
  });
  const config = await readConfig();
  assert.equal(config.geminiApiKeys[0]?.weight, 2);
  assert.equal(config.openaiCompatibility[0]?.apiKeyEntries[0]?.weight, 3);
  assert.equal(config.openaiCompatibility[0]?.apiKeyEntries[0]?.sourceIndex, 0);

  const gemini = config.geminiApiKeys[0];
  await providers.providersApi.updateGeminiKey(gemini.apiKey, gemini.baseUrl, {
    ...gemini,
    weight: 7,
  });
  const openai = (await readConfig()).openaiCompatibility[0];
  await providers.providersApi.updateOpenAIProvider(openai.name, 0, {
    ...openai,
    apiKeyEntries: openai.apiKeyEntries.map((entry) => ({ ...entry, weight: 0 })),
  });

  assert.deepEqual(core.writes[0].data[0].keys[0], {
    'api-key': 'gemini-secret',
    weight: 7,
    'future-field': { keep: true },
  });
  assert.deepEqual(core.writes[1].data[0], {
    name: 'custom',
    'base-url': 'https://openai.example.test/v1',
    'future-provider-field': 'keep',
    keys: [{ 'api-key': 'openai-secret', weight: 0, 'future-entry-field': 'keep' }],
  });
});

test('manages Interactions API resources through the Core contract', async () => {
  const parsed = transformers.normalizeConfigResponse({
    'api-keys': {
      interactions: [
        {
          name: 'interactions-1',
          'base-url': 'https://generativelanguage.googleapis.com',
          keys: [{ 'api-key': 'interaction-secret', weight: 4 }],
        },
      ],
    },
  });
  assert.equal(parsed.interactionsApiKeys[0]?.weight, 4);

  const resource = adapters.interactionsToResource(parsed.interactionsApiKeys[0], 0);
  assert.equal(resource.brand, 'interactions');
  assert.deepEqual(resource.selector, {
    brand: 'interactions',
    apiKey: 'interaction-secret',
    baseUrl: 'https://generativelanguage.googleapis.com',
    index: 0,
  });
  assert.equal(
    descriptors.PROVIDER_BRAND_ORDER.indexOf('interactions'),
    descriptors.PROVIDER_BRAND_ORDER.indexOf('gemini') + 1
  );
  assert.equal(brandLogos.PROVIDER_LOGOS.interactions.src, brandLogos.PROVIDER_LOGOS.gemini.src);
  assert.equal(
    providerUtils.buildInteractionsEndpoint('https://generativelanguage.googleapis.com/v1beta'),
    'https://generativelanguage.googleapis.com/v1beta/interactions'
  );
  assert.deepEqual(providerUtils.buildInteractionsProbePayload('gemini-2.5-flash'), {
    model: 'gemini-2.5-flash',
    input: 'Hi',
  });
  assert.equal(providerUtils.INTERACTIONS_API_REVISION, '2026-05-20');
  assert.equal(providerUtils.getProviderUsageKey('interactions'), 'gemini-interactions');

  core = installFakeV8Core(client.apiClient, {
    'api-keys': {
      interactions: [
        {
          name: 'interactions-1',
          'base-url': 'https://generativelanguage.googleapis.com',
          keys: [{ 'api-key': 'interaction-secret', weight: 4, 'future-field': { keep: true } }],
        },
      ],
    },
  });
  await providers.providersApi.createInteractionsKey({ apiKey: 'new-interaction-secret', weight: 2 });
  let current = (await readConfig()).interactionsApiKeys[0];
  await providers.providersApi.updateInteractionsKey(current.apiKey, current.baseUrl, {
    ...current,
    weight: 6,
  });
  current = (await readConfig()).interactionsApiKeys[0];
  await providers.providersApi.deleteInteractionsKey(current.apiKey, current.baseUrl, current.source);

  assert.deepEqual(
    core.writes.map((write) => write.url),
    Array(3).fill('/config/api-keys/interactions')
  );
  assert.deepEqual(core.writes[0].data[1], {
    name: 'interactions-2',
    keys: [{ 'api-key': 'new-interaction-secret', weight: 2 }],
  });
  assert.deepEqual(core.writes[1].data[0].keys[0], {
    'api-key': 'interaction-secret',
    weight: 6,
    'future-field': { keep: true },
  });
  assert.deepEqual(core.doc['api-keys'].interactions[0].keys, []);
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
