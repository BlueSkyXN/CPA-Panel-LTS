import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storedValues = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key) {
      return storedValues.get(key) ?? null;
    },
    setItem(key, value) {
      storedValues.set(key, String(value));
    },
    removeItem(key) {
      storedValues.delete(key);
    },
    clear() {
      storedValues.clear();
    },
  },
});
globalThis.window = new EventTarget();
globalThis.window.matchMedia = () => ({
  matches: false,
  media: '',
  addEventListener() {},
  removeEventListener() {},
});

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [apiKeyModule, strengthModule, meterModule, editorModule, valuesModule, i18nModule] =
  await Promise.all([
    vite.ssrLoadModule('/src/utils/apiKey.ts'),
    vite.ssrLoadModule('/src/utils/apiKeyStrength.ts'),
    vite.ssrLoadModule('/src/components/config/ApiKeyStrengthMeter.tsx'),
    vite.ssrLoadModule('/src/components/config/VisualConfigEditor.tsx'),
    vite.ssrLoadModule('/src/types/visualConfig.ts'),
    vite.ssrLoadModule('/src/i18n/index.ts'),
  ]);

const { generateSecureApiKey } = apiKeyModule;
const { API_KEY_STRENGTH_SEGMENTS, evaluateApiKeyStrength } = strengthModule;
const { ApiKeyStrengthMeter } = meterModule;
const { VisualConfigEditor } = editorModule;
const { DEFAULT_VISUAL_VALUES } = valuesModule;
const i18n = i18nModule.default;

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    delete globalThis.localStorage;
  }
});

test('generates uniformly shaped, distinct API keys at the stronger length', () => {
  const keys = Array.from({ length: 100 }, () => generateSecureApiKey());

  assert.equal(new Set(keys).size, keys.length);
  for (const apiKey of keys) {
    assert.match(apiKey, /^sk-[A-Za-z0-9]{48}$/);
    assert.equal(evaluateApiKeyStrength(apiKey).tier, 'strong');
  }
});

test('discounts repeated, sequential, guessable, and partial-period inputs', () => {
  assert.equal(evaluateApiKeyStrength('a'.repeat(48)).tier, 'weak');
  assert.ok(
    evaluateApiKeyStrength('abcdefghijklmnopqrstuvwxyz0123456789').bits <
      evaluateApiKeyStrength('qzmXe4Rk9BtLw7Ncy2VsJp5Ghd8FaU3Zmr6Q').bits
  );
  assert.ok(
    evaluateApiKeyStrength('sk-password-9fKw2mQx7ZtRv4Ns8Lc3Bd').bits <
      evaluateApiKeyStrength('sk-hRvnqtwj-9fKw2mQx7ZtRv4Ns8Lc3Bd').bits
  );
  assert.ok(
    evaluateApiKeyStrength('abcabca').bits < evaluateApiKeyStrength('abczqra').bits,
    '尾部不完整的重复周期应按周期折价'
  );
});

test('renders the strength tier as an accessible progress bar', () => {
  const markup = renderToStaticMarkup(
    createElement(ApiKeyStrengthMeter, { value: generateSecureApiKey() })
  );

  assert.match(markup, new RegExp(`aria-valuenow="${API_KEY_STRENGTH_SEGMENTS}"`));
  assert.match(markup, new RegExp(`aria-valuemax="${API_KEY_STRENGTH_SEGMENTS}"`));
  assert.match(markup, /aria-valuetext="Strong"/);
  assert.equal(markup.match(/data-filled="true"/g)?.length, API_KEY_STRENGTH_SEGMENTS);
});

test('announces visible config navigation validation counts', () => {
  const markup = renderToStaticMarkup(
    createElement(VisualConfigEditor, {
      values: DEFAULT_VISUAL_VALUES,
      validationErrors: { port: 'port_range' },
      onChange() {},
    })
  );
  const accessibleLabel = [
    i18n.t('config_management.visual.sections.server.title'),
    i18n.t('config_management.meta_errors', { count: 1 }),
  ].join(', ');

  assert.ok(markup.includes(`aria-label="${accessibleLabel}"`));
});

test('keeps every strength label available in all active locales', async () => {
  const originalLanguage = i18n.language;

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    await i18n.changeLanguage(locale);
    for (const key of ['label', 'empty', 'weak', 'fair', 'good', 'strong']) {
      const path = `config_management.visual.api_keys.strength.${key}`;
      assert.equal(i18n.exists(path), true);
      assert.notEqual(i18n.t(path), path);
    }
  }

  await i18n.changeLanguage(originalLanguage);
});
