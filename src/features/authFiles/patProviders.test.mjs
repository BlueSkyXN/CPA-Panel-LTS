import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { buildPatAuth, parsePatSummary, newPatAuthFileName } = await vite.ssrLoadModule('/src/features/authFiles/patProviders.ts');
const { PatSummaryDetails } = await vite.ssrLoadModule('/src/features/authFiles/components/PatAccountSummary.tsx');
const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
test.after(() => vite.close());

test('new accounts receive unique path-safe filenames without using the label', () => {
  const names = new Set(Array.from({ length: 20 }, () => newPatAuthFileName('qoder')));
  assert.equal(names.size, 20);
  for (const name of names) assert.match(name, /^qoder-[0-9a-f]{32}\.json$/);
});

test('PAT update preserves non-credential account configuration without mutating the source', () => {
  const before = { type: 'qoder', auth_mode: 'pat', access_token: 'pt-fixture-old', prefix: 'team', disabled: true, transport: 'direct_openai', priority: 3 };
  const after = buildPatAuth('qoder', 'Main', ' pt-fixture-new ', before);
  assert.equal(after.pat, 'pt-fixture-new');
  assert.equal(after.access_token, undefined);
  assert.equal(after.transport, before.transport);
  assert.equal(after.prefix, before.prefix);
  assert.equal(after.disabled, true);
  assert.equal(after.priority, 3);
  assert.equal(before.access_token, 'pt-fixture-old');
});

test('new PAT files follow instance transport and do not invent account region', () => {
  assert.deepEqual(buildPatAuth('qoder', 'Main', 'pt-fixture'), { type: 'qoder', auth_mode: 'pat', pat: 'pt-fixture', label: 'Main' });
});

test('reject invalid PAT and avoid silent local-cli migration or provider changes', () => {
  for (const value of ['', ' ', 'opaque-token', 'pt-a\nb']) {
    assert.throws(() => buildPatAuth('qoder', '', value));
  }
  assert.throws(() => buildPatAuth('codebuddy', '', 'fixture', { type: 'qoder' }));
  assert.throws(() => buildPatAuth('qoder', '', 'pt-fixture', { type: 'qoder', auth_mode: 'local_cli' }));
});

test('CodeBuddy API key migration removes only the superseded credential', () => {
  const auth = buildPatAuth('codebuddy', '', 'fixture-pat', { type: 'codebuddy', auth_mode: 'api_key', api_key: 'old-fixture', proxy_url: 'http://127.0.0.1:9' });
  assert.equal(auth.api_key, undefined);
  assert.equal(auth.proxy_url, 'http://127.0.0.1:9');
});

const response = (quota) => ({ provider: 'qoder', auth_index: 'fixture-index', label: 'Fixture', account: { status: 'fallback' }, plan: { status: 'unsupported' }, quota, updated_at: '2026-09-09T00:00:00Z', cached: true });

test('exact decimals and zero survive, missing and failed quota are not turned into zero', () => {
  const value = parsePatSummary(response({ status: 'partial', remaining: 0, used_exact: '9007199254740993.123456789', used: 9007199254740992 }), 'qoder', 'fixture-index');
  assert.equal(value.quota.remaining, '0');
  assert.equal(value.quota.total, '—');
  assert.equal(value.quota.used, '9007199254740993.123456789');
  assert.equal(value.cached, true);
  const rejected = parsePatSummary(response({ status: 'auth_rejected' }), 'qoder', 'fixture-index');
  assert.equal(rejected.quota.remaining, '—');
});

test('summary cannot be attributed to a different credential or provider', () => {
  assert.throws(() => parsePatSummary(response({}), 'codebuddy', 'fixture-index'));
  assert.throws(() => parsePatSummary(response({}), 'qoder', 'another-index'));
});

test('unrelated and sensitive fields do not enter the view model', () => {
  const input = { ...response({ status: 'available', remaining: 0 }), pat: 'fixture-secret', account: { status: 'available', raw: 'fixture-secret' } };
  assert.equal(JSON.stringify(parsePatSummary(input, 'qoder', 'fixture-index')).includes('fixture-secret'), false);
});

test('all supported locales render partial account, quota and cache states', async () => {
  const summary = parsePatSummary(response({ status: 'auth_rejected', packages: [{ name: 'Expired', available: false, remaining_exact: '0' }] }), 'qoder', 'fixture-index');
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    await i18n.changeLanguage(locale);
    const markup = renderToStaticMarkup(createElement(PatSummaryDetails, { summary }));
    assert.equal(markup.includes('pat_accounts.'), false);
    assert.ok(markup.includes('2026-09-09T00:00:00Z'));
    assert.ok(markup.includes('Expired'));
  }
});
