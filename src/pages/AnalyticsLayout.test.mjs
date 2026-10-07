import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ AnalyticsLayout }, { useAuthStore }, { default: i18n }] = await Promise.all([
  vite.ssrLoadModule('/src/pages/AnalyticsLayout.tsx'),
  vite.ssrLoadModule('/src/stores/useAuthStore.ts'),
  vite.ssrLoadModule('/src/i18n/index.ts'),
]);
await i18n.changeLanguage('en');
const initialState = useAuthStore.getInitialState();
const initialSupport = { flowSupportKnown: initialState.flowSupportKnown, supportsFlowControl: initialState.supportsFlowControl };
// React's server snapshot reads the initial object captured by Zustand's bound hook.
const setSupport = (state) => { useAuthStore.setState(state); Object.assign(initialState, state); };
test.after(async () => { Object.assign(initialState, initialSupport); await vite.close(); globalThis.window = originalWindow; });
const render = () => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/analytics/flow/config'] },
  createElement(AnalyticsLayout, null, createElement('p', null, 'Synthetic child'))));

test('observability remains reachable before or without Flow support', () => {
  for (const known of [false, true]) {
    setSupport({ flowSupportKnown: known, supportsFlowControl: false });
    const html = render();
    assert.ok(html.includes('href="/analytics/observability"'));
    assert.ok(!html.includes('href="/analytics/flow"'));
    assert.ok(!html.includes('href="/analytics/flow/config"'));
    assert.ok(html.includes('Synthetic child'));
  }
});

test('supported Flow exposes two distinct pages with one selected tab', () => {
  setSupport({ flowSupportKnown: true, supportsFlowControl: true });
  const html = render();
  assert.ok(html.includes('href="/analytics/flow"'));
  assert.ok(html.includes('href="/analytics/flow/config"'));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});

test('analytics locales keep the same keys and interpolation fields', async () => {
  let reference;
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    const { analytics } = JSON.parse(await readFile(new URL(`../lts/i18n/${locale}.lts.json`, import.meta.url), 'utf8'));
    const signature = Object.fromEntries(Object.entries(analytics).map(([key, text]) => {
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 0);
      return [key, (text.match(/{{\w+}}/g) ?? []).sort()];
    }));
    reference ??= signature;
    assert.deepEqual(signature, reference, locale);
  }
});
