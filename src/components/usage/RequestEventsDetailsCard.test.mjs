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

const [{ RequestEventsDetailsCard }, pricingModule, i18nModule] = await Promise.all([
  vite.ssrLoadModule('/src/components/usage/RequestEventsDetailsCard.tsx'),
  vite.ssrLoadModule('/src/utils/usage/pricing/index.ts'),
  vite.ssrLoadModule('/src/i18n/index.ts'),
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
    JSON.stringify({ model: 'gpt-b', serviceTier: '__service_tier_fast__' })
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
    assert.match(markup, /Fast</);
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
