import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
const localStorageValues = new Map();
const sessionStorageValues = new Map();
const buildStorage = (values) => ({
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  },
});
const testWindow = new EventTarget();
testWindow.localStorage = buildStorage(localStorageValues);
testWindow.sessionStorage = buildStorage(sessionStorageValues);
testWindow.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.window = testWindow;
if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = testWindow.sessionStorage;
}

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [{ RequestEventsDetailsCard }, pricingModule, i18nModule, { buildRequestEventFilterOptions }] = await Promise.all([
  vite.ssrLoadModule('/src/components/usage/RequestEventsDetailsCard.tsx'),
  vite.ssrLoadModule('/src/utils/usage/pricing/index.ts'),
  vite.ssrLoadModule('/src/i18n/index.ts'),
  vite.ssrLoadModule('/src/components/usage/requestEventFilterOptions.ts'),
]);
const i18n = i18nModule.default;

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('renders the current local USD estimate for every priced request event', async () => {
  await i18n.changeLanguage('en');
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.4-mini': {
            details: [
              {
                timestamp: '2026-08-17T00:00:00Z',
                tokens: { input_tokens: 1_000_000, total_tokens: 1_000_000 },
              },
              {
                timestamp: '2026-08-17T00:01:00Z',
                tokens: { input_tokens: 100, total_tokens: 100 },
              },
              {
                timestamp: '2026-08-17T00:01:15Z',
                tokens: { input_tokens: 99_999, total_tokens: 99_999 },
              },
              {
                timestamp: '2026-08-17T00:01:20Z',
                tokens: { input_tokens: 40_000, total_tokens: 40_000 },
              },
              {
                timestamp: '2026-08-17T00:01:25Z',
                tokens: { input_tokens: 200_000, total_tokens: 200_000 },
              },
              {
                timestamp: '2026-08-17T00:01:27Z',
                tokens: { input_tokens: 300_000, total_tokens: 300_000 },
              },
              {
                timestamp: '2026-08-17T00:01:30Z',
                tokens: {
                  input_tokens: 1,
                  cache_read_tokens: 1,
                  total_tokens: 1,
                },
              },
              {
                timestamp: '2026-08-17T00:01:35Z',
                tokens: { input_tokens: 0, total_tokens: 0 },
              },
            ],
          },
          'gpt-5.3-codex-spark': {
            details: [
              {
                timestamp: '2026-08-17T00:01:40Z',
                tokens: { input_tokens: 1, total_tokens: 1 },
              },
            ],
          },
          'unmatched-local-model': {
            details: [
              {
                timestamp: '2026-08-17T00:02:00Z',
                tokens: { input_tokens: 100, total_tokens: 100 },
              },
            ],
          },
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    createElement(RequestEventsDetailsCard, {
      usage,
      loading: false,
      pageTimeRange: 'all',
      referenceNowMs: Date.parse('2026-08-17T00:00:00Z'),
      priceProfile: pricingModule.createDefaultPriceProfileV3(),
      requestApiKeys: [],
      geminiKeys: [],
      claudeConfigs: [],
      codexConfigs: [],
      vertexConfigs: [],
      openaiProviders: [],
    })
  );

  assert.match(markup, /Estimated cost \(USD \/ ¢\)/);
  assert.match(markup, /data-request-cost-status="priced"/);
  assert.match(markup, />\$0\.75</);
  assert.match(markup, />\$0\.075</);
  assert.match(markup, />0\.0075¢</);
  assert.match(markup, />≈0</);
  assert.match(markup, /data-request-cost-status="unmatched"[^>]*>--</);
  for (const tone of [
    'unavailable',
    'inactive',
    'free',
    'micro',
    'low',
    'medium',
    'elevated',
    'high',
    'critical',
  ]) {
    assert.match(markup, new RegExp(`data-request-cost-tone="${tone}"`));
  }
  assert.match(markup, /Endpoint · POST \/v1\/responses/);
});

test('renders Core TTFB and derived output throughput metrics', async () => {
  await i18n.changeLanguage('en');
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.6-sol': {
            details: [
              {
                timestamp: '2026-08-17T00:00:00Z',
                latency_ms: 2_000,
                ttfb_ms: 500,
                timing_version: 1,
                ttft_ms: 900,
                ttfa_ms: 1_500,
                tokens: {
                  input_tokens: 10,
                  output_tokens: 300,
                  reasoning_tokens: 0,
                  total_tokens: 310,
                },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    createElement(RequestEventsDetailsCard, {
      usage,
      loading: false,
      pageTimeRange: 'all',
      referenceNowMs: Date.parse('2026-08-17T00:00:00Z'),
      priceProfile: pricingModule.createDefaultPriceProfileV3(),
      requestApiKeys: [],
      geminiKeys: [],
      claudeConfigs: [],
      codexConfigs: [],
      vertexConfigs: [],
      openaiProviders: [],
    })
  );

  assert.match(markup, /TTFB/);
  assert.match(markup, /data-request-performance="ttfb"[^>]*data-ttfb-ms="500"[^>]*>500ms</);
  assert.match(markup, /data-request-performance="ttft"[^>]*data-ttft-ms="900"[^>]*>900ms</);
  assert.match(markup, /data-request-performance="ttfa"[^>]*data-ttfa-ms="1500"[^>]*>1.5s</);
  assert.match(markup, /Output TPS/);
  assert.match(markup, /data-request-performance="output-tps"[^>]*data-output-tps="200"[^>]*>200</);
  assert.match(markup, /Avg TPS/);
  assert.match(markup, /data-request-performance="average-tps"[^>]*data-average-tps="150"[^>]*>150</);
  assert.match(markup, /data-performance-summary-key="output-tps"/);
  assert.match(markup, /Weighted Output TPS/);
});

test('renders the upstream-reported model without changing the request model', async () => {
  await i18n.changeLanguage('en');
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.5-sol': {
            details: [
              {
                timestamp: '2026-09-16T00:00:00Z',
                upstream_model: 'gpt-5.5-sol-2026-0815',
                tokens: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
                failed: false,
              },
              {
                timestamp: '2026-09-16T00:01:00Z',
                tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                failed: false,
              },
              {
                timestamp: '2026-09-16T00:02:00Z',
                upstream_model: 'gpt-5.5-sol',
                tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    createElement(RequestEventsDetailsCard, {
      usage,
      loading: false,
      pageTimeRange: 'all',
      referenceNowMs: Date.parse('2026-09-16T00:00:00Z'),
      priceProfile: pricingModule.createDefaultPriceProfileV3(),
      requestApiKeys: [],
      geminiKeys: [],
      claudeConfigs: [],
      codexConfigs: [],
      vertexConfigs: [],
      openaiProviders: [],
    })
  );

  assert.match(markup, />gpt-5\.5-sol</);
  assert.match(markup, /Upstream: gpt-5\.5-sol-2026-0815/);
  // Identical upstream models are suppressed; only the mismatched row renders.
  assert.equal((markup.match(/data-upstream-model=/g) ?? []).length, 1);
  assert.equal(markup.includes('Upstream: gpt-5.5-sol<'), false);
});

test('renders a dedicated upstream column with match/diff tones and no inline sub-label', async () => {
  await i18n.changeLanguage('en');
  localStorageValues.set(
    'cli-proxy-usage-request-event-columns-v3',
    JSON.stringify({ upstreamModel: true })
  );
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.5-sol': {
            details: [
              {
                timestamp: '2026-09-16T00:00:00Z',
                upstream_model: 'gpt-5.5-sol-2026-0815',
                tokens: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
                failed: false,
              },
              {
                timestamp: '2026-09-16T00:01:00Z',
                upstream_model: 'gpt-5.5-sol',
                tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                failed: false,
              },
              {
                timestamp: '2026-09-16T00:02:00Z',
                tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };

  try {
    const markup = renderToStaticMarkup(
      createElement(RequestEventsDetailsCard, {
        usage,
        loading: false,
        pageTimeRange: 'all',
        referenceNowMs: Date.parse('2026-09-16T00:00:00Z'),
        priceProfile: pricingModule.createDefaultPriceProfileV3(),
        requestApiKeys: [],
        geminiKeys: [],
        claudeConfigs: [],
        codexConfigs: [],
        vertexConfigs: [],
        openaiProviders: [],
      })
    );

    // Column mode shows both matching and differing upstream models with tones.
    assert.match(markup, /data-upstream-match="diff"/);
    assert.match(markup, /data-upstream-match="match"/);
    assert.match(markup, /data-upstream-match="missing"/);
    assert.match(markup, /Upstream Model/);
    // Inline "Upstream: xxx" sub-label is suppressed once the column is visible.
    assert.equal(markup.includes('Upstream: gpt-5.5-sol'), false);
    assert.equal((markup.match(/data-upstream-model=/g) ?? []).length, 2);
  } finally {
    localStorageValues.delete('cli-proxy-usage-request-event-columns-v3');
  }
});

test('renders first content from assistant timing when reasoning timing is absent', async () => {
  await i18n.changeLanguage('en');
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.6-luna': {
            details: [
              {
                timestamp: '2026-08-17T00:00:00Z',
                latency_ms: 2_000,
                ttfb_ms: 200,
                timing_version: 1,
                ttfa_ms: 1_200,
                tokens: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    createElement(RequestEventsDetailsCard, {
      usage,
      loading: false,
      pageTimeRange: 'all',
      referenceNowMs: Date.parse('2026-08-17T00:00:00Z'),
      priceProfile: pricingModule.createDefaultPriceProfileV3(),
      requestApiKeys: [],
      geminiKeys: [],
      claudeConfigs: [],
      codexConfigs: [],
      vertexConfigs: [],
      openaiProviders: [],
    })
  );

  assert.match(markup, /First Text/);
  assert.match(
    markup,
    /data-request-performance="first-content"[^>]*data-first-content-ms="1200"[^>]*>1\.2s</
  );
  assert.match(markup, /data-request-performance="ttft"[^>]*>--</);
  assert.match(markup, /data-request-performance="ttfa"[^>]*data-ttfa-ms="1200"[^>]*>1\.2s</);
});

test('renders a configured caller key without exposing the raw credential', async () => {
  await i18n.changeLanguage('en');
  const rawRequestKey = 'sk-panel-request-key-1234567890';
  const usage = {
    apis: {
      [rawRequestKey]: {
        models: {
          'gpt-5.6-sol': {
            details: [
              {
                timestamp: '2026-08-17T00:00:00Z',
                tokens: { input_tokens: 1, total_tokens: 1 },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    createElement(RequestEventsDetailsCard, {
      usage,
      loading: false,
      pageTimeRange: 'all',
      referenceNowMs: Date.parse('2026-08-17T00:00:00Z'),
      priceProfile: pricingModule.createDefaultPriceProfileV3(),
      requestApiKeys: [rawRequestKey],
      geminiKeys: [],
      claudeConfigs: [],
      codexConfigs: [],
      vertexConfigs: [],
      openaiProviders: [],
    })
  );

  assert.match(markup, /Caller Key/);
  assert.match(markup, /\(1\)sk\*{2}90/);
  assert.match(markup, /data-request-identity-type="configured-key"/);
  assert.doesNotMatch(markup, new RegExp(rawRequestKey));
});

test('fully redacts short caller keys instead of exposing every original character', async () => {
  await i18n.changeLanguage('en');
  const configuredKey = 'abcd';
  const callerKey = 'xyz';
  const usage = {
    apis: {
      [configuredKey]: {
        models: {
          'gpt-5.6-sol': {
            details: [
              {
                timestamp: '2026-08-17T00:00:00Z',
                tokens: { input_tokens: 1, total_tokens: 1 },
                failed: false,
              },
            ],
          },
        },
      },
      [callerKey]: {
        models: {
          'gpt-5.6-sol': {
            details: [
              {
                timestamp: '2026-08-17T00:01:00Z',
                tokens: { input_tokens: 1, total_tokens: 1 },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };

  const markup = renderToStaticMarkup(
    createElement(RequestEventsDetailsCard, {
      usage,
      loading: false,
      pageTimeRange: 'all',
      referenceNowMs: Date.parse('2026-08-17T00:02:00Z'),
      priceProfile: pricingModule.createDefaultPriceProfileV3(),
      requestApiKeys: [configuredKey],
      geminiKeys: [],
      claudeConfigs: [],
      codexConfigs: [],
      vertexConfigs: [],
      openaiProviders: [],
    })
  );

  assert.match(markup, /\(1\)\*{2}/);
  assert.match(markup, /Caller · \*{2}/);
  assert.doesNotMatch(markup, /ab\*+cd/);
  assert.doesNotMatch(markup, /x\*+z/);
});

const allFilterOption = { value: '__all__', label: '全部' };

test('model filter options are unique, naturally sorted, and keep All first', () => {
  const models = Object.freeze([
    'gpt-5.10', 'glm-5.3-flash', 'gpt-5.9', 'glm-5.3',
    'Doubao-Seed-2.1-Pro', 'glm-5.3', '__all__',
  ]);
  const expected = [
    allFilterOption,
    ...['Doubao-Seed-2.1-Pro', 'glm-5.3', 'glm-5.3-flash', 'gpt-5.9', 'gpt-5.10']
      .map((value) => ({ value, label: value })),
  ];

  for (const selection of ['__all__', 'glm-5.3', 'gpt-5.10']) {
    assert.deepEqual(buildRequestEventFilterOptions(models, selection, allFilterOption), expected);
    assert.deepEqual(buildRequestEventFilterOptions([...models].reverse(), selection, allFilterOption), expected);
  }
});

test('filter ordering ignores case but preserves exact model identities and deterministic ties', () => {
  const models = ['gpt-5.9', 'GLM-5.3', 'glm-5.3', 'GPT-5.10', 'glm-5.3'];
  const expected = ['__all__', 'GLM-5.3', 'glm-5.3', 'gpt-5.9', 'GPT-5.10'];

  for (const values of [models, [...models].reverse()]) {
    assert.deepEqual(
      buildRequestEventFilterOptions(values, 'glm-5.3', allFilterOption).map(({ value }) => value),
      expected
    );
  }
});

test('missing selected models stay in sorted position even with empty window options', () => {
  assert.deepEqual(
    buildRequestEventFilterOptions(['gpt-5.10', 'Doubao-Seed-2.1-Pro'], 'glm-5.3', allFilterOption)
      .map(({ value }) => value),
    ['__all__', 'Doubao-Seed-2.1-Pro', 'glm-5.3', 'gpt-5.10']
  );
  assert.deepEqual(buildRequestEventFilterOptions([], 'glm-5.3', allFilterOption), [
    allFilterOption, { value: 'glm-5.3', label: 'glm-5.3' },
  ]);
  assert.deepEqual(buildRequestEventFilterOptions([], '__all__', allFilterOption), [allFilterOption]);
});

test('auth index filter options retain missing selections without duplicates or selection pinning', () => {
  const values = ['10', '2', '-', '1', '2'];
  const options = buildRequestEventFilterOptions(values, '2', allFilterOption);
  assert.deepEqual(options.map(({ value }) => value), ['__all__', '-', '1', '2', '10']);
  assert.deepEqual(buildRequestEventFilterOptions(values, '-', allFilterOption), options);
  assert.deepEqual(
    buildRequestEventFilterOptions(['10', '1'], '2', allFilterOption).map(({ value }) => value),
    ['__all__', '1', '2', '10']
  );
});

test('previously selected filters survive a workspace remount via the session draft', async () => {
  await i18n.changeLanguage('en');
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-a': {
            details: [
              {
                timestamp: '2026-08-17T00:01:00Z',
                tokens: { input_tokens: 1, total_tokens: 1 },
              },
            ],
          },
        },
      },
    },
  };
  sessionStorage.setItem(
    'cpa-request-event-filters-v1',
    JSON.stringify({ model: 'gpt-b', authIndex: 'missing-auth-index', serviceTier: '__service_tier_fast__' })
  );
  try {
    const markup = renderToStaticMarkup(
      createElement(RequestEventsDetailsCard, {
        usage,
        loading: false,
        pageTimeRange: 'all',
        referenceNowMs: Date.parse('2026-08-17T00:00:00Z'),
        priceProfile: pricingModule.createDefaultPriceProfileV3(),
        requestApiKeys: [],
        geminiKeys: [],
        claudeConfigs: [],
        codexConfigs: [],
        vertexConfigs: [],
        openaiProviders: [],
      })
    );
    // The restored selection stays visible instead of silently resetting to All.
    assert.match(markup, />gpt-b</);
    assert.match(markup, />missing-auth-index</);
    assert.match(markup, /Fast</);
    assert.equal((markup.match(/data-request-cost-status=/g) ?? []).length, 0);
  } finally {
    sessionStorage.removeItem('cpa-request-event-filters-v1');
  }
});

test('restored request key filter shows the remembered label, not the raw token', async () => {
  await i18n.changeLanguage('en');
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-a': {
            details: [
              {
                timestamp: '2026-08-17T00:01:00Z',
                tokens: { input_tokens: 1, total_tokens: 1 },
              },
            ],
          },
        },
      },
    },
  };
  sessionStorage.setItem(
    'cpa-request-event-filters-v1',
    JSON.stringify({
      requestKey: 'request-identity-9',
      requestKeyValue: 'POST /v1/responses',
      requestKeyLabel: 'Configured key #4',
    })
  );
  try {
    const markup = renderToStaticMarkup(
      createElement(RequestEventsDetailsCard, {
        usage,
        loading: false,
        pageTimeRange: 'all',
        referenceNowMs: Date.parse('2026-08-17T00:00:00Z'),
        priceProfile: pricingModule.createDefaultPriceProfileV3(),
        requestApiKeys: [],
        geminiKeys: [],
        claudeConfigs: [],
        codexConfigs: [],
        vertexConfigs: [],
        openaiProviders: [],
      })
    );
    // The seeded label memory keeps the trigger readable before options resolve.
    assert.match(markup, /Configured key #4/);
  } finally {
    sessionStorage.removeItem('cpa-request-event-filters-v1');
  }
});


test('combines response-confirmed Blue with speed without inferring legacy program', async () => {
  await i18n.changeLanguage('en');
  const cases = [
    ['standard', 'standard', 'Std'],
    ['priority', 'standard', 'Fast'],
    ['standard', 'daybreak_blue', 'BLUE'],
    ['priority', 'daybreak_blue', 'BLUE FAST'],
    ['standard', undefined, 'Std ?'],
    ['priority', 'daybreak_red', 'Fast ?'],
  ];
  const usage = { apis: { 'POST /v1/responses': { models: {
    'gpt-5.6-sol': { details: cases.map(([speed, program], index) => ({
      timestamp: `2026-10-03T00:00:0${index}Z`,
      source: 'synthetic-source', auth_index: '0',
      response_service_tier: speed, effective_service_tier: speed,
      response_cyber_program: program,
      tokens: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }, failed: false,
    })) },
  } } } };
  const markup = renderToStaticMarkup(createElement(RequestEventsDetailsCard, {
    usage, loading: false, pageTimeRange: 'all',
    referenceNowMs: Date.parse('2026-10-03T00:10:00Z'),
    priceProfile: pricingModule.createDefaultPriceProfileV3(),
    requestApiKeys: [], geminiKeys: [], claudeConfigs: [], codexConfigs: [], vertexConfigs: [], openaiProviders: [],
  }));
  for (const [, , label] of cases) assert.ok(markup.includes(`>${label}</span>`), label);
  assert.equal((markup.match(/data-cyber-program="daybreak_blue"/g) ?? []).length, 2);
  assert.match(markup, /Unknown: upstream did not report/);
  assert.match(markup, /not assumed Standard/);
});

test('Blue metadata survives both snapshot transforms and does not change pricing', async () => {
  const utils = await vite.ssrLoadModule('/src/utils/usage.ts');
  const program = await vite.ssrLoadModule('/src/utils/usage/cyberProgram.ts');
  const detail = { timestamp: '2026-10-03T00:00:00Z', source: '', auth_index: '0', failed: false,
    response_cyber_program: 'daybreak_blue', effective_service_tier: 'priority',
    tokens: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } };
  const usage = { apis: { 'POST /v1/responses': { models: { 'gpt-5.6-sol': { details: [detail] } } } } };
  for (const collect of [utils.collectUsageDetails, utils.collectUsageDetailsWithEndpoint]) {
    const rows = collect(usage);
    assert.equal(rows[0].response_cyber_program, 'daybreak_blue');
    const profile = pricingModule.createDefaultPriceProfileV3();
    assert.deepEqual(utils.calculateCostEstimate(rows[0], profile),
      utils.calculateCostEstimate({ ...rows[0], response_cyber_program: 'standard' }, profile));
  }
  assert.equal(program.normalizeResponseCyberProgram(undefined), null);
  assert.equal(program.normalizeResponseCyberProgram('daybreak_red'), 'unknown');
  assert.equal(program.normalizeResponseCyberProgram('standard'), 'standard');
});


test('analytics drilldown overrides stored filters and combines tier with exact model/source', async () => {
  await i18n.changeLanguage('en');
  const storageKey = 'cpa-request-event-filters-v1';
  sessionStorageValues.set(storageKey, JSON.stringify({ model: 'old-model', result: 'failed', source: 'old-source', serviceTier: '__service_tier_std__' }));
  const detail = (source, auth_index, token) => ({ timestamp: '2026-10-08T00:00:00Z', source, auth_index, failed: false, tokens: { total_tokens: token } });
  const usage = { apis: { app: { models: {
    'model-a': { details: [detail('source-a', '1', 11), detail('source-b', '2', 22), {
      ...detail('source-a', '1', 44), effective_service_tier: 'priority',
    }] },
    'model-b': { details: [detail('source-a', '1', 33)] },
  } } } };
  const props = { usage, loading: false, pageTimeRange: 'all', referenceNowMs: Date.parse('2026-10-08T01:00:00Z'),
    priceProfile: pricingModule.createDefaultPriceProfileV3(), requestApiKeys: [], geminiKeys: [], claudeConfigs: [], codexConfigs: [], vertexConfigs: [], openaiProviders: [] };
  for (const tier of ['fast', 'std', undefined]) {
    const markup = renderToStaticMarkup(createElement(RequestEventsDetailsCard, { ...props, initialAnalyticsFilters: {
      model: 'model-a', tier, source: { value: 'auth:1', label: 'Credential A', identities: [{ source: 't:source-a', auth_index: '1' }] },
    } }));
    assert.equal((markup.match(/data-request-cost-status=/g) ?? []).length, tier ? 1 : 2);
    assert.ok(markup.includes('Credential A'));
    const rows = markup.slice(markup.indexOf('<tbody'));
    assert.equal(rows.includes('>44<'), tier !== 'std');
    assert.equal(rows.includes('>11<'), tier !== 'fast');
  }
  const all = renderToStaticMarkup(createElement(RequestEventsDetailsCard, { ...props, initialAnalyticsFilters: {} }));
  assert.equal((all.match(/data-request-cost-status=/g) ?? []).length, 4);
  assert.equal(JSON.parse(sessionStorageValues.get(storageKey)).model, 'old-model');
  sessionStorageValues.delete(storageKey);
});

test('transition drilldown keeps effort and excludes pure tiers from both conversion groups', async () => {
  await i18n.changeLanguage('en');
  const rows = [
    ['priority', 'priority', 'high', 11],
    ['default', 'default', 'high', 22],
    ['priority', 'default', 'high', 33],
    ['priority', 'default', 'medium', 44],
    ['default', 'priority', 'high', 55],
    ['priority', 'default', undefined, 66],
  ].map(([request_service_tier, response_service_tier, reasoning_effort, total_tokens]) => ({
    request_service_tier, response_service_tier, reasoning_effort,
    timestamp: '2026-10-08T00:00:00Z', source: 'synthetic-source', auth_index: '1',
    failed: false, tokens: { total_tokens },
  }));
  const props = { usage: { apis: { app: { models: { 'model-a': { details: rows } } } } },
    loading: false, pageTimeRange: 'all', referenceNowMs: Date.parse('2026-10-08T01:00:00Z'),
    priceProfile: pricingModule.createDefaultPriceProfileV3(), requestApiKeys: [], geminiKeys: [], claudeConfigs: [], codexConfigs: [], vertexConfigs: [], openaiProviders: [] };
  for (const [tier, effort, tokens] of [
    ['fast', 'high', 11], ['std', 'high', 22], ['fast_to_std', 'high', 33],
    ['fast_to_std', 'medium', 44], ['std_to_fast', 'high', 55], ['fast_to_std', '', 66],
  ]) {
    const html = renderToStaticMarkup(createElement(RequestEventsDetailsCard, {
      ...props, initialAnalyticsFilters: { tier, effort },
    }));
    assert.equal((html.match(/data-request-cost-status=/g) ?? []).length, 1, `${tier}/${effort}`);
    assert.ok(html.slice(html.indexOf('<tbody')).includes(`>${tokens}<`));
  }
});
