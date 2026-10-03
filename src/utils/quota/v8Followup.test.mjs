import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const oldWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const load = (path) => vite.ssrLoadModule(`/src/${path}`);
const { useQuotaStore, captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } =
  await load('stores/useQuotaStore.ts');
const { normalizeAuthFilesResponse, authFilesApi } = await load('services/api/authFiles.ts');
const { normalizeAuthFileCooldowns } = await load('services/api/authFileCooldowns.ts');
const { cooldownRemainingSeconds } = await load('features/authFiles/cooldowns.ts');
const { AuthFileCooldownSection } = await load(
  'features/authFiles/components/AuthFileCooldownSection.tsx'
);
const { createSharedClock } = await load('utils/time/sharedClock.ts');
const { createProbeRequestGuard } = await load('features/providers/probeRequests.ts');
const {
  parseCodexSubscriptionActiveUntil,
  fetchCodexSubscriptionActiveUntil,
  normalizeCodexAccountCredits,
} = await load('lts/codexQuota/account.ts');
const { CODEX_CONFIG } = await load('lts/codexQuota/config.ts');
const { resolveCodexChatgptAccountId } = await load('utils/quota/resolvers.ts');
const { apiCallApi } = await load('services/api/apiCall.ts');
const { apiClient } = await load('services/api/client.ts');
const oldRequest = apiCallApi.request;
const oldPatch = apiClient.patch;
test.after(async () => {
  apiCallApi.request = oldRequest;
  apiClient.patch = oldPatch;
  globalThis.window = oldWindow;
  await vite.close();
});

test('per-file invalidation fences replaced credentials but preserves unrelated quota including LTS Gemini', () => {
  useQuotaStore.getState().clearQuotaCache();
  const state = useQuotaStore.getState();
  state.setGeminiCliQuota({ a: { status: 'success' }, b: { status: 'success' } });
  const a = captureQuotaCacheGeneration('a'),
    b = captureQuotaCacheGeneration('b'),
    batch = captureQuotaCacheGeneration();
  state.clearQuotaCache(['a']);
  assert.equal(useQuotaStore.getState().geminiCliQuota.a, undefined);
  assert.equal(useQuotaStore.getState().geminiCliQuota.b.status, 'success');
  assert.equal(
    commitIfQuotaCacheCurrent(a, () => assert.fail()),
    false
  );
  assert.equal(
    commitIfQuotaCacheCurrent(b, () => {}),
    true
  );
  assert.equal(
    commitIfQuotaCacheCurrent(batch, () => {}, 'b'),
    true
  );
  assert.equal(
    commitIfQuotaCacheCurrent(batch, () => assert.fail(), 'a'),
    false
  );
  state.clearQuotaCache();
  assert.equal(
    commitIfQuotaCacheCurrent(b, () => assert.fail()),
    false
  );
});

const record = {
  scope: 'model',
  model_key: '<synthetic>',
  reason: 'quota',
  retry_at: '2026-10-03T10:00:32Z',
  remaining_seconds: 32,
  http_status: 429,
};
test('cooldown snapshots distinguish absent, unknown, empty and malformed; duplicate merge is atomic', () => {
  assert.equal(normalizeAuthFileCooldowns(undefined, undefined, 1000), undefined);
  for (const bad of [
    null,
    {},
    [null],
    [{ ...record, scope: 'future' }],
    [{ ...record, remaining_seconds: -1 }],
  ])
    assert.equal(normalizeAuthFileCooldowns(bad, undefined, 1000).records, null);
  for (const cooldowns of [[], null]) {
    const value = normalizeAuthFilesResponse(
      {
        files: [
          { name: 'a', source: 'file', cooldowns },
          { name: 'a', source: 'memory', cooldowns: [record] },
        ],
      },
      1000
    );
    assert.deepEqual(value.files[0].cooldownSnapshot.records, cooldowns);
  }
  const snapshot = normalizeAuthFileCooldowns([record], undefined, 1000);
  assert.equal(cooldownRemainingSeconds(snapshot.records[0], 1000, 500), 32);
  assert.equal(cooldownRemainingSeconds(snapshot.records[0], 1000, 35000), 0);
  assert.equal(renderToStaticMarkup(createElement(AuthFileCooldownSection)), '');
  const markup = renderToStaticMarkup(createElement(AuthFileCooldownSection, { snapshot }));
  assert.ok(markup.includes('<details') && markup.includes('&lt;synthetic&gt;'));
});

test('cooldown clock uses one timer and releases it after last subscriber', () => {
  let now = 1,
    starts = 0,
    stops = 0,
    tick;
  const clock = createSharedClock({
    now: () => now,
    setTimer: (callback) => {
      tick = callback;
      starts++;
      return 1;
    },
    clearTimer: () => stops++,
  });
  const a = clock.subscribe(() => {}),
    b = clock.subscribe(() => {});
  now = 3;
  assert.equal(clock.getSnapshot(), 1);
  tick();
  assert.equal(clock.getSnapshot(), 3);
  assert.equal(starts, 1);
  a();
  assert.equal(stops, 0);
  b();
  assert.equal(stops, 1);
});

test('probe ownership rejects same-slot late results, form resets and connection switches', () => {
  const guard = createProbeRequestGuard();
  let current = true;
  const old = guard.start('a', () => current),
    other = guard.start('b', () => current);
  guard.start('a', () => current);
  assert.equal(old.current(), false);
  assert.equal(other.current(), true);
  current = false;
  assert.equal(other.current(), false);
  guard.invalidate();
  assert.equal(other.ownsSession(), false);
});

test('Codex renewal parsing and credit balances reject malformed values without synthesizing zero', async () => {
  for (const value of [null, false, '', 0, -1, 'not-a-date'])
    assert.equal(parseCodexSubscriptionActiveUntil({ active_until: value }), null);
  assert.equal(
    parseCodexSubscriptionActiveUntil({ activeUntil: '2026-12-01T00:00:00Z' }),
    '2026-12-01T00:00:00Z'
  );
  assert.deepEqual(normalizeCodexAccountCredits({ balance: '42.500', unlimited: true }), {
    balance: '42.500',
    unlimited: true,
  });
  assert.equal(normalizeCodexAccountCredits({ balance: 0 }).balance, '0');
  for (const balance of [-1, NaN, false, 'Infinity', ''])
    assert.equal(normalizeCodexAccountCredits({ balance }).balance, null);
  assert.equal(
    resolveCodexChatgptAccountId({
      name: 'a',
      metadata: { chatgpt_account_id: 'synthetic-account' },
    }),
    'synthetic-account'
  );
  let calls = 0;
  apiCallApi.request = async (request) => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.ok(request.url.endsWith('account_id=a%2Fb'));
    return { statusCode: 200, body: { active_until: 1234567890 } };
  };
  assert.equal(await fetchCodexSubscriptionActiveUntil('synthetic', null, {}), null);
  assert.equal(calls, 0);
  assert.equal(await fetchCodexSubscriptionActiveUntil('synthetic', 'a/b', {}), 1234567890);
  apiCallApi.request = async () => {
    throw new Error('optional unavailable');
  };
  assert.equal(await fetchCodexSubscriptionActiveUntil('synthetic', 'a/b', {}), null);
  const state = CODEX_CONFIG.buildSuccessState({
    windows: [],
    creditBalance: '42',
    creditsUnlimited: true,
  });
  const html = renderToStaticMarkup(
    CODEX_CONFIG.renderQuotaItems(state, (key) => key, { styles: {}, QuotaProgressBar: () => null })
  );
  assert.ok(html.includes('codex_quota.credit_unlimited'));
});

test('auth status sends stable auth index only when provided', async () => {
  const calls = [];
  apiClient.patch = async (...args) => {
    calls.push(args);
  };
  await authFilesApi.setStatus('synthetic.json', false, 'index-one');
  await authFilesApi.setStatus('synthetic.json', true);
  assert.deepEqual(calls[0], [
    '/auth-files/status',
    { name: 'synthetic.json', disabled: false, auth_index: 'index-one' },
  ]);
  assert.deepEqual(calls[1][1], { name: 'synthetic.json', disabled: true });
});


test('all LTS locale overlays use the current Codex Pro labels', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    const messages = JSON.parse(await readFile(new URL(`../../lts/i18n/${locale}.lts.json`, import.meta.url), 'utf8'));
    assert.equal(messages.codex_quota.plan_pro, 'Pro 200');
    assert.equal(messages.codex_quota.plan_prolite, 'Pro 100');
  }
});
