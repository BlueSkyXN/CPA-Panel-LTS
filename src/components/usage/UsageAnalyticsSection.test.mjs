import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
globalThis.__analyticsTestState = { details: [], loading: true, error: '', loadedCount: 0, needsManualLoad: false, load() {} };
const vite = await createServer({
  appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  plugins: [{ name: 'analytics-sample-state', enforce: 'pre', transform(_code, id) {
    if (id.endsWith('/src/components/usage/hooks/useUsageAnalyticsDetails.ts')) {
      return 'export const useUsageAnalyticsDetails=()=>globalThis.__analyticsTestState;';
    }
  } }],
});
const [{ UsageAnalyticsSection }, { default: i18n }] = await Promise.all([
  vite.ssrLoadModule('/src/components/usage/UsageAnalyticsSection.tsx'), vite.ssrLoadModule('/src/i18n/index.ts'),
]);
await i18n.changeLanguage('en');
test.after(async () => { await vite.close(); globalThis.window = originalWindow; delete globalThis.__analyticsTestState; });
const render = () => renderToStaticMarkup(createElement(UsageAnalyticsSection, {
  querySession: { bound: 'synthetic', now_ms: 1 }, legacyUsage: null, timeWindow: null,
  loading: false, isMobile: false, modelStats: [], showPricing: false,
}));

test('pending first samples show loading after the summary has completed', () => {
  Object.assign(globalThis.__analyticsTestState, { loading: true, needsManualLoad: false });
  assert.ok(render().includes(i18n.t('common.loading')));
});

test('a deferred manual load is not presented as an active request', () => {
  Object.assign(globalThis.__analyticsTestState, { loading: true, needsManualLoad: true });
  const html = render();
  assert.ok(html.includes(i18n.t('usage_stats.analytics_load_samples')));
  assert.ok(!html.includes(i18n.t('common.loading')));
});

test('completed empty samples show no data without a loading indicator', () => {
  Object.assign(globalThis.__analyticsTestState, { loading: false, needsManualLoad: false });
  const html = render();
  assert.ok(html.includes(i18n.t('usage_stats.no_data')));
  assert.ok(!html.includes(i18n.t('common.loading')));
});
