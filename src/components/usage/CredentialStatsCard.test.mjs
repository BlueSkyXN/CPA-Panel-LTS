import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ CredentialStatsCard }, { default: i18n }] = await Promise.all([
  vite.ssrLoadModule('/src/components/usage/CredentialStatsCard.tsx'),
  vite.ssrLoadModule('/src/i18n/index.ts'),
]);
await i18n.changeLanguage('en');
test.after(async () => { await vite.close(); globalThis.window = originalWindow; });

const render = (usage) => renderToStaticMarkup(createElement(CredentialStatsCard, { usage, loading: false }));
const detail = (failed, latency_ms) => ({ timestamp: '2026-10-07T00:00:00Z', source: 'synthetic',
  auth_index: 'synthetic-index', failed, latency_ms, tokens: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } });

test('credential average latency includes failed requests consistently in legacy and query views', () => {
  const legacy = { apis: { synthetic: { models: { synthetic: { details: [detail(false, 1000), detail(true, 9000)] } } } } };
  const query = { kind: 'usage-query-v1', summary: { groups: { credentials: [{ source: 'synthetic', auth_index: 'synthetic-index',
    metrics: { success: 1, failure: 1, tokens: 14, input: 6, cache_read: 0, latency_ms: 10000, latency_samples: 2 } }] } } };
  assert.equal(render(legacy), render(query));
});

test('failed-only credentials retain their observed latency in both views', () => {
  const legacy = { apis: { synthetic: { models: { synthetic: { details: [detail(true, 9000)] } } } } };
  const query = { kind: 'usage-query-v1', summary: { groups: { credentials: [{ source: 'synthetic', auth_index: 'synthetic-index',
    metrics: { success: 0, failure: 1, tokens: 7, input: 3, cache_read: 0, latency_ms: 9000, latency_samples: 1 } }] } } };
  assert.equal(render(legacy), render(query));
});
