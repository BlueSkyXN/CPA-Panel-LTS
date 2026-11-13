import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { buildAccountAuth, buildPatAuth, generateDeviceId, isAccountFormProvider, parsePatSummary, newPatAuthFileName, normalizeAccountExtraModels } = await vite.ssrLoadModule('/src/features/authFiles/patProviders.ts');
const { PatSummaryDetails } = await vite.ssrLoadModule('/src/features/authFiles/components/PatAccountSummary.tsx');
const { default: i18n } = await vite.ssrLoadModule('/src/i18n/index.ts');
const { pluginsApi } = await vite.ssrLoadModule('/src/services/api/plugins.ts');
const { patProvidersApi } = await vite.ssrLoadModule('/src/services/api/patProviders.ts');
test.after(() => vite.close());

test('ZCode extra models normalize, preserve credentials, and clear independently', () => {
  const previous = Object.freeze({ type: 'zcode-coding-plan', api_key: 'fixture.secret', device_id: 'stable-device', prefix: 'team', exmodel: Object.freeze(['glm-5.3-highspeed']) });
  const updated = buildAccountAuth('zcode-coding-plan', 'Main', '', '', previous, [' glm-5.3-flashx ', 'glm-5.3-flashx']);
  assert.deepEqual(updated.exmodel, ['glm-5.3-flashx']);
  assert.equal(updated.api_key, previous.api_key);
  assert.equal(updated.device_id, previous.device_id);
  assert.equal(updated.prefix, previous.prefix);
  assert.deepEqual(previous.exmodel, ['glm-5.3-highspeed']);
  assert.deepEqual(buildAccountAuth('zcode-coding-plan', 'Main', '', '', previous, []).exmodel, []);
  assert.deepEqual(buildAccountAuth('zcode-coding-plan', 'Main', '', '', previous).exmodel, previous.exmodel);
  assert.deepEqual(buildAccountAuth('zcode-coding-plan', 'Main', 'new.secret', '', previous, ['custom-model']).exmodel, ['custom-model']);
  assert.deepEqual(normalizeAccountExtraModels(undefined), []);
  assert.deepEqual(normalizeAccountExtraModels(null), []);
  for (const invalid of ['glm-5.3-flashx', {}, [1], [null], [' '], ['<model>'], ['model\n']]) {
    assert.throws(() => normalizeAccountExtraModels(invalid), /invalid_extra_models/);
  }
  assert.throws(() => buildAccountAuth('zcode-coding-plan', 'New', '', '', undefined, []), /invalid_api_key/);
  assert.throws(() => buildAccountAuth('qoder', 'Old', '', '', { type: 'qoder', pat: 'pt-fixture' }), /invalid_pat/);
});

test('ZCode extra model editing requires the loaded plugin feature version', async () => {
  const { pluginsApi } = await vite.ssrLoadModule('/src/services/api/plugins.ts');
  const { patProvidersApi } = await vite.ssrLoadModule('/src/services/api/patProviders.ts');
  const originalList = pluginsApi.list;
  const originalGetConfig = pluginsApi.getConfig;
  try {
    pluginsApi.getConfig = async () => ({});
    // undefined 版本在严格校验下直接拒绝；其余版本先通过 0.4.0 门槛，再看 extra-models 开关。
    const cases = [
      ['0.5.0', false],
      ['0.6.0', true],
      ['0.6.1', true],
    ];
    await assert.rejects(
      async () => {
        pluginsApi.list = async () => ({ pluginsEnabled: true, plugins: [{ id: 'zcode-coding-plan', registered: true, effectiveEnabled: true, metadata: { version: undefined } }] });
        await patProvidersApi.configuration('zcode-coding-plan');
      },
      /coding_plan_upgrade_required/
    );
    for (const [version, supported] of cases) {
      pluginsApi.list = async () => ({ pluginsEnabled: true, plugins: [{ id: 'zcode-coding-plan', registered: true, effectiveEnabled: true, metadata: { version } }] });
      const config = await patProvidersApi.configuration('zcode-coding-plan');
      assert.equal(config.supportsExtraModels, supported);
    }
    pluginsApi.list = async () => ({ pluginsEnabled: true, plugins: [{ id: 'zcode-coding-plan', registered: false, effectiveEnabled: true, metadata: { version: '0.6.0' } }] });
    await assert.rejects(() => patProvidersApi.configuration('zcode-coding-plan'), /plugin_unavailable/);
  } finally {
    pluginsApi.list = originalList;
    pluginsApi.getConfig = originalGetConfig;
  }
});

test('ZCode account configuration reflects the configured upstream and rejects unknown values', async () => {
  const { pluginsApi } = await vite.ssrLoadModule('/src/services/api/plugins.ts');
  const { patProvidersApi } = await vite.ssrLoadModule('/src/services/api/patProviders.ts');
  const originalList = pluginsApi.list;
  const originalGetConfig = pluginsApi.getConfig;
  try {
    pluginsApi.list = async () => ({ pluginsEnabled: true, plugins: [{ id: 'zcode-coding-plan', registered: true, effectiveEnabled: true, metadata: { version: '0.6.1' } }] });
    for (const upstream of [undefined, null, 'bigmodel', 'zai']) {
      pluginsApi.getConfig = async () => ({ upstream });
      const config = await patProvidersApi.configuration('zcode-coding-plan');
      assert.equal(config.endpoint, upstream === 'zai'
        ? 'https://api.z.ai/api/anthropic/v1/messages'
        : 'https://open.bigmodel.cn/api/anthropic/v1/messages');
      assert.equal(config.supportsExtraModels, true);
    }
    for (const upstream of ['unknown', '', ' ZAI ', 1, {}]) {
      pluginsApi.getConfig = async () => ({ upstream });
      await assert.rejects(() => patProvidersApi.configuration('zcode-coding-plan'), /plugin_unavailable/);
    }
    pluginsApi.getConfig = async () => { throw new Error('synthetic_config_unavailable'); };
    await assert.rejects(() => patProvidersApi.configuration('zcode-coding-plan'), /synthetic_config_unavailable/);
  } finally {
    pluginsApi.list = originalList;
    pluginsApi.getConfig = originalGetConfig;
  }
});

test('ZCode device validation matches the plugin and preserves valid saved identities', () => {
  for (const device of ['a\nb', 'a\rb', 'a\0b', '<device>']) {
    assert.throws(() => buildAccountAuth('zcode-coding-plan', 'Main', 'fixture.secret', device), /invalid_device_id/);
    assert.throws(() => buildAccountAuth('zcode-coding-plan', 'Main', '', '', { type: 'zcode-coding-plan', api_key: 'fixture.secret', device_id: device }), /invalid_device_id/);
  }
  const previous = Object.freeze({ type: 'zcode-coding-plan', api_key: 'fixture.secret', device_id: ' stable-device ' });
  assert.equal(buildAccountAuth('zcode-coding-plan', 'Main', '', '', previous).device_id, 'stable-device');
  assert.equal(previous.device_id, ' stable-device ');
});

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

test('zcode account saves use zero retries on creation and update', () => {
  const created = buildAccountAuth('zcode-coding-plan', 'Coding Plan', 'key.part', 'fixture-device');
  assert.equal(created.request_retry, 0);

  const previous = Object.freeze({ type: 'zcode-coding-plan', device_id: 'stable-device', request_retry: 3 });
  const updated = buildAccountAuth('zcode-coding-plan', 'Main', 'key.part', '', previous);
  assert.equal(updated.request_retry, 0);
  assert.equal(previous.request_retry, 3);
});

test('zcode inline migration removes legacy references and preserves shared account settings', () => {
  const previous = Object.freeze({
    type: 'zcode-coding-plan',
    label: 'Old',
    config_file: '/synthetic/legacy-config.json',
    api_key: 'old.fixture',
    device_id: 'stable-device',
    pat: 'unused-fixture-pat',
    access_token: 'unused-fixture-access',
    prefix: 'team',
    disabled: true,
    priority: 3,
    weight: 2,
    proxy_url: 'http://127.0.0.1:9',
    note: 'Fixture account',
  });

  const updated = buildAccountAuth('zcode-coding-plan', ' Main ', ' new.fixture ', '', previous);
  assert.deepEqual(updated, {
    type: 'zcode-coding-plan',
    label: 'Main',
    api_key: 'new.fixture',
    device_id: 'stable-device',
    request_retry: 0,
    prefix: 'team',
    disabled: true,
    priority: 3,
    weight: 2,
    proxy_url: 'http://127.0.0.1:9',
    note: 'Fixture account',
  });
  assert.equal(previous.config_file, '/synthetic/legacy-config.json');
  assert.equal(previous.api_key, 'old.fixture');
});

test('Coding Plan manual identity wins and generated identity persists across edits', () => {
  const created = buildAccountAuth('zcode-coding-plan', 'New', 'key.part', '');
  const edited = buildAccountAuth('zcode-coding-plan', 'Edited', 'rotated.key', '', created);
  assert.equal(edited.device_id, created.device_id);
  const manual = buildAccountAuth('zcode-coding-plan', 'Edited', 'rotated.key', ' imported-device ', created);
  assert.equal(manual.device_id, 'imported-device');
  assert.notEqual(created.device_id, manual.device_id);
  assert.equal(created.api_key, 'key.part');
});

test('device identity hints explain optional import and no billing guarantee in every locale', () => {
  const disclaimers = { en: 'does not guarantee', 'zh-CN': '不保证', 'zh-TW': '不保證', ru: 'не гарантирует' };
  for (const [locale, disclaimer] of Object.entries(disclaimers)) {
    const hint = i18n.getResource(locale, 'translation', 'pat_accounts.device_id_hint');
    assert.ok(hint.includes('deviceMid'));
    assert.ok(hint.includes(disclaimer));
  }
});

test('Coding Plan migration replaces legacy fields without changing unrelated account settings', () => {
  const previous = { type: 'zcode-coding-plan', config_file: '/synthetic/private.json', auth_mode: 'pat', pat: 'synthetic-pat', access_token: 'synthetic-token', request_retry: 5, prefix: 'team', priority: 3, note: 'keep', disabled: true };
  const updated = buildAccountAuth('zcode-coding-plan', 'Updated', 'key.part', '', previous);
  for (const key of ['config_file', 'auth_mode', 'pat', 'access_token']) assert.equal(updated[key], undefined);
  for (const key of ['prefix', 'priority', 'note', 'disabled']) assert.equal(updated[key], previous[key]);
  assert.equal(updated.request_retry, 0);
  assert.equal(previous.config_file, '/synthetic/private.json');
  for (const device of ['line\nbreak', 'bad\0device', '<placeholder>']) {
    assert.throws(() => buildAccountAuth('zcode-coding-plan', '', 'key.part', device), /invalid_device_id/);
  }
});

test('Coding Plan configuration requires inline-capable versions and reflects the upstream', async () => {
  const originalList = pluginsApi.list;
  const originalConfig = pluginsApi.getConfig;
  let version = '0.4.0';
  let settings = {};
  let configReads = 0;
  pluginsApi.list = async () => ({ pluginsEnabled: true, plugins: [{ id: 'zcode-coding-plan', registered: true, effectiveEnabled: true, metadata: { name: 'zcode-coding-plan', version } }] });
  pluginsApi.getConfig = async () => { configReads++; return settings; };
  try {
    const initial = await patProvidersApi.configuration('zcode-coding-plan');
    assert.equal(initial.endpoint, 'https://open.bigmodel.cn/api/anthropic/v1/messages');
    assert.equal(initial.hostLoggingAcknowledged, false);
    settings = { upstream: 'zai', host_logging_disabled: true };
    const international = await patProvidersApi.configuration('zcode-coding-plan');
    assert.equal(international.endpoint, 'https://api.z.ai/api/anthropic/v1/messages');
    assert.equal(international.hostLoggingAcknowledged, true);
    settings = { upstream: 'invalid' };
    await assert.rejects(patProvidersApi.configuration('zcode-coding-plan'), /plugin_unavailable/);
    const before = configReads;
    for (const old of ['0.3.0', '', 'dev', '0.4.0-beta.1', '0.4.bad']) {
      version = old;
      await assert.rejects(patProvidersApi.configuration('zcode-coding-plan'), /coding_plan_upgrade_required/);
    }
    assert.equal(configReads, before);
  } finally {
    pluginsApi.list = originalList;
    pluginsApi.getConfig = originalConfig;
  }
});

test('all account compatibility and acknowledgement hints are translated', async () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    for (const key of ['invalid_device_id', 'coding_plan_upgrade_required', 'coding_plan_single_account_hint', 'coding_plan_logging_required']) {
      assert.equal(typeof i18n.getResource(locale, 'translation', `pat_accounts.${key}`), 'string');
    }
  }
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
