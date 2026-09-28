import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { buildAccountAuth, buildPatAuth, generateDeviceId, isAccountFormProvider, parsePatSummary, newPatAuthFileName } = await vite.ssrLoadModule('/src/features/authFiles/patProviders.ts');
const { PatSummaryDetails } = await vite.ssrLoadModule('/src/features/authFiles/components/PatAccountSummary.tsx');
const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
test.after(() => vite.close());

test('new accounts receive unique path-safe filenames without using the label', () => {
  const names = new Set(Array.from({ length: 20 }, () => newPatAuthFileName('qoder')));
  assert.equal(names.size, 20);
  for (const name of names) assert.match(name, /^qoder-[0-9a-f]{32}\.json$/);
});

test('PAT update preserves account configuration and legacy transport fields without mutating the source', () => {
  const before = { type: 'qoder', auth_mode: 'pat', access_token: 'pt-fixture-old', prefix: 'team', disabled: true, transport: 'direct_openai', priority: 3 };
  const after = buildPatAuth('qoder', 'Main', ' pt-fixture-new ', before);
  assert.equal(after.pat, 'pt-fixture-new');
  assert.equal(after.access_token, undefined);
  assert.equal(after.transport, 'direct_openai');
  assert.equal(after.prefix, before.prefix);
  assert.equal(after.disabled, true);
  assert.equal(after.priority, 3);
  assert.equal(before.access_token, 'pt-fixture-old');
});

test('PAT update on legacy plugin keeps the account-level direct transport alive', () => {
  // 旧 Qoder 插件（<0.3.0）默认 sdk_cli，账号靠 transport: direct_openai 覆盖运行；
  // 更新 PAT 绝不能删除该字段，否则账号会退回 runner 路径。
  const before = { type: 'qoder', auth_mode: 'pat', pat: 'pt-fixture-old', transport: 'direct_openai', label: 'Old' };
  const after = buildPatAuth('qoder', 'Main', 'pt-fixture-new', before);
  assert.equal(after.transport, 'direct_openai');
  assert.equal(after.pat, 'pt-fixture-new');
});

test('new PAT files contain only provider, mode, credential and label', () => {
  assert.deepEqual(buildPatAuth('qoder', 'Main', 'pt-fixture'), { type: 'qoder', auth_mode: 'pat', pat: 'pt-fixture', label: 'Main' });
});

test('reject invalid PAT, removed auth modes, and provider changes', () => {
  for (const value of ['', ' ', 'opaque-token', 'pt-a\nb']) {
    assert.throws(() => buildPatAuth('qoder', '', value));
  }
  assert.throws(() => buildPatAuth('codebuddy', '', 'fixture', { type: 'qoder' }));
  assert.throws(() => buildPatAuth('qoder', '', 'pt-fixture', { type: 'qoder', auth_mode: 'local_cli' }));
  assert.throws(() => buildPatAuth('qoder', '', 'pt-fixture', { type: 'qoder', auth_mode: 'sdk_profile' }));
});

test('CodeBuddy API key migration removes only the superseded credential', () => {
  const auth = buildPatAuth('codebuddy', '', 'fixture-pat', { type: 'codebuddy', auth_mode: 'api_key', api_key: 'old-fixture', proxy_url: 'http://127.0.0.1:9' });
  assert.equal(auth.api_key, undefined);
  assert.equal(auth.proxy_url, 'http://127.0.0.1:9');
});

test('zcode inline accounts: single-file credentials, device identity, and validation', () => {
  const created = buildAccountAuth('zcode-coding-plan', 'Coding Plan', ' key.part ', '');
  assert.equal(created.type, 'zcode-coding-plan');
  assert.equal(created.api_key, 'key.part');
  assert.match(created.device_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(created.pat, undefined);
  assert.equal(created.auth_mode, undefined);
  const existing = buildAccountAuth('zcode-coding-plan', 'Main', 'key.part', '', { type: 'zcode-coding-plan', device_id: 'stable-device', prefix: 'team' });
  assert.equal(existing.device_id, 'stable-device');
  assert.equal(existing.prefix, 'team');
  const manual = buildAccountAuth('zcode-coding-plan', 'Main', 'key.part', ' manual-device ');
  assert.equal(manual.device_id, 'manual-device');
  for (const value of ['', 'nodot', 'a.', '.b', 'a.b.c', 'a b']) {
    assert.throws(() => buildAccountAuth('zcode-coding-plan', '', value, ''), Error);
  }
  // 与插件端语义一致：首尾空白先归一再校验，尾部换行不会拒收
  assert.equal(buildAccountAuth('zcode-coding-plan', '', ' key.part\n', '').api_key, 'key.part');
  assert.throws(() => buildAccountAuth('zcode-coding-plan', '', 'key.part', '', { type: 'qoder' }));
  // PAT 路径经同一入口分派，行为不变
  assert.deepEqual(buildAccountAuth('qoder', 'Main', 'pt-fixture', ''), { type: 'qoder', auth_mode: 'pat', pat: 'pt-fixture', label: 'Main' });
  assert.equal(isAccountFormProvider('zcode-coding-plan'), true);
  assert.equal(isAccountFormProvider('unknown'), false);
  assert.match(generateDeviceId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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
