import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createInstance } from 'i18next';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const en = read('./locales/en.json');
const zhCN = read('./locales/zh-CN.json');
const zhTW = read('./locales/zh-TW.json');
const ru = read('./locales/ru.json');
const overlay = read('../lts/i18n/ru.lts.json');
const ltsLocales = ['en', 'zh-CN', 'zh-TW', 'ru'].map((lang) => ({
  lang,
  data: read(`../lts/i18n/${lang}.lts.json`),
}));

function flattenKeys(node, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

test('Russian header editing labels and validation resolve without Chinese fallback', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'ru', fallbackLng: false, resources: { ru: { translation: ru } } });
  for (const key of ['headers_label', 'headers_placeholder', 'headers_hint', 'headers_invalid_json', 'headers_invalid_object', 'headers_invalid_value']) {
    assert.equal(i18n.t(`auth_files.${key}`), ru.auth_files[key]);
    assert.ok(ru.auth_files[key]);
  }
  assert.match(i18n.t('auth_files.headers_invalid_value'), /строкой/);
});

test('existing LTS Russian quota reset overlay retains account and failure interpolation', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'ru', fallbackLng: false, resources: { ru: { translation: ru } } });
  i18n.addResourceBundle('ru', 'translation', overlay, true, true);
  const message = i18n.t('codex_quota.reset_failed', { name: 'example.json', message: 'test-error' });
  assert.match(message, /example\.json/);
  assert.match(message, /test-error/);
  assert.doesNotMatch(message, /{{|codex_quota/);
});

test('P2-16: ru.json restores all plugin_resource.* keys and has zero missing keys vs en.json', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'ru', fallbackLng: false, resources: { ru: { translation: ru } } });

  for (const key of Object.keys(en.plugin_resource)) {
    assert.ok(typeof ru.plugin_resource?.[key] === 'string' && ru.plugin_resource[key].trim().length > 0);
    assert.equal(i18n.t(`plugin_resource.${key}`, { count: 2 }), ru.plugin_resource[key].replace('{{count}}', '2'));
  }

  const enKeys = new Set(flattenKeys(en));
  const ruKeys = new Set(flattenKeys(ru));
  const missingInRu = [...enKeys].filter((key) => !ruKeys.has(key));
  assert.deepEqual(missingInRu, []);
});

test('P2-16: zh-TW.json has parity with zh-CN.json, includes auth_login actions, and keeps gemini_cli_* across all 4 locales', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'zh-TW', fallbackLng: false, resources: { 'zh-TW': { translation: zhTW } } });

  for (const key of ['login_another_account', 'view_auth_files']) {
    assert.ok(typeof zhTW.auth_login?.[key] === 'string' && zhTW.auth_login[key].trim().length > 0);
    assert.equal(i18n.t(`auth_login.${key}`), zhTW.auth_login[key]);
  }

  const cnKeys = new Set(flattenKeys(zhCN));
  const twKeys = new Set(flattenKeys(zhTW));
  assert.deepEqual([...twKeys].filter((key) => !cnKeys.has(key)), []);
  assert.deepEqual([...cnKeys].filter((key) => !twKeys.has(key)), []);

  const geminiKeys = Object.keys(en.auth_login).filter((key) => key.startsWith('gemini_cli_'));
  assert.ok(geminiKeys.length > 0);
  for (const [lang, catalog] of Object.entries({ en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru })) {
    for (const key of geminiKeys) {
      assert.ok(
        typeof catalog.auth_login?.[key] === 'string' && catalog.auth_login[key].trim().length > 0,
        `${lang}.auth_login.${key} must exist`
      );
    }
  }

  const baseOverlayKeys = flattenKeys(ltsLocales[0].data).sort();
  for (const { lang, data } of ltsLocales.slice(1)) {
    assert.deepEqual(flattenKeys(data).sort(), baseOverlayKeys, `${lang}.lts.json keys must match`);
  }
});
