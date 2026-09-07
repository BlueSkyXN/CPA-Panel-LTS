import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createInstance } from 'i18next';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const ru = read('./locales/ru.json');
const overlay = read('../lts/i18n/ru.lts.json');

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
