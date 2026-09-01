import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
const localStorageValues = new Map();
const testWindow = new EventTarget();
testWindow.localStorage = {
  getItem(key) {
    return localStorageValues.get(key) ?? null;
  },
  setItem(key, value) {
    localStorageValues.set(key, String(value));
  },
  removeItem(key) {
    localStorageValues.delete(key);
  },
};
testWindow.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.window = testWindow;

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
  assert.match(markup, /Output TPS/);
  assert.match(markup, /data-request-performance="output-tps"[^>]*data-output-tps="200"[^>]*>200</);
  assert.match(markup, /Avg TPS/);
  assert.match(markup, /data-request-performance="average-tps"[^>]*data-average-tps="150"[^>]*>150</);
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
