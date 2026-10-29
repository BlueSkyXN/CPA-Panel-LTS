import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';

const oldWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const load = (path) => vite.ssrLoadModule(`/src/${path}`);
const { apiClient } = await load('services/api/client.ts');
const oldPost = apiClient.post;
const { authFilesApi } = await load('services/api/authFiles.ts');
const { normalizeRefreshResults } = await load('features/authFiles/runtimeActions.ts');
const { useVisualConfig } = await load('hooks/useVisualConfig.ts');
const { readDevinQuotaResponse } = await load('services/api/devinQuota.ts');
const { parseMetaQuotaPayload } = await load('services/api/metaQuota.ts');
const { createMetaQuotaFetcher } = await load('components/quota/metaRequests.ts');
const { createDevinQuotaFetcher } = await load('components/quota/devinRequests.ts');
const { useQuotaStore } = await load('stores/useQuotaStore.ts');
const { createResetGrantOperations } = await load(
  'components/quota/claudeGrants/resetGrantOperations.ts'
);
const { parseAnthropicResetGrantStatus } = await load('services/api/claudeResetGrants.ts');
const { validateDevinCallback } = await load('pages/devinOAuth.ts');
test.after(async () => {
  apiClient.post = oldPost;
  globalThis.window = oldWindow;
  await vite.close();
});

function editYaml(source, patch) {
  let result;
  function Harness() {
    const config = useVisualConfig(),
      [phase, setPhase] = useState(0);
    if (!phase) {
      config.loadVisualValuesFromYaml(source);
      setPhase(1);
    } else if (phase === 1) {
      config.setVisualValues(patch);
      setPhase(2);
    } else result = { yaml: config.applyVisualChangesToYaml(source), values: config.visualValues };
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}
test('global GitHub token uses canonical path and preserves unknown YAML and comments', () => {
  const source =
    'server:\n  github-token: synthetic-old\n  custom: true # preserve\noauth: {auth-dir: auths}\n';
  const result = editYaml(source, { githubToken: 'synthetic-new' });
  assert.equal(parse(result.yaml).server['github-token'], 'synthetic-new');
  assert.equal(parse(result.yaml)['github-token'], undefined);
  assert.ok(result.yaml.includes('# preserve'));
  assert.equal(editYaml(result.yaml, {}).values.githubToken, 'synthetic-new');
  assert.equal(parse(editYaml(result.yaml, { githubToken: '' }).yaml).server['github-token'], '');
  assert.equal(
    parse(editYaml('server: {port: 1234}\n', { debug: true }).yaml).server['github-token'],
    undefined
  );
});
test('refresh validates success, sends stable identity, and drops response credentials', async () => {
  let sent;
  apiClient.post = async (...args) => {
    sent = args;
    return { ok: true, auth: { access_token: 'synthetic-private' } };
  };
  assert.equal(await authFilesApi.requestManualRefresh('same.json', 'auth-2'), undefined);
  assert.deepEqual(sent.slice(0, 2), [
    '/credentials/refresh',
    { name: 'same.json', auth_index: 'auth-2' },
  ]);
  apiClient.post = async () => ({ ok: false });
  await assert.rejects(authFilesApi.requestManualRefresh('same.json'), /Invalid/);
});
test('all-refresh strips arbitrary provider error payloads and rejects malformed results', () => {
  assert.deepEqual(
    normalizeRefreshResults({
      ok: true,
      results: [{ id: 'one', success: false, error: 'synthetic-private', tokens: {} }],
    }),
    [{ id: 'one', success: false }]
  );
  for (const value of [
    { ok: false, results: [] },
    { ok: true, results: [{}] },
    { ok: true, results: [{ id: 'one', success: 'yes' }] },
  ])
    assert.throws(() => normalizeRefreshResults(value));
});
test('cooldown reset requires identity and rejects another credential in readback', async () => {
  apiClient.post = async () => assert.fail('must not send');
  await assert.rejects(authFilesApi.resetCooldown(''));
  apiClient.post = async (url, body) => {
    assert.equal(url, '/routing/cooldown/reset');
    return { status: 'ok', auth_index: body.auth_index };
  };
  await authFilesApi.resetCooldown('auth-2');
  apiClient.post = async () => ({ status: 'ok', auth_index: 'other' });
  await assert.rejects(authFilesApi.resetCooldown('auth-2'));
});
test('Meta keeps unknown quota distinct from zero and drops keys/account data', () => {
  const parsed = parseMetaQuotaPayload({
    api_key: 'synthetic-private',
    email: 'synthetic@example.test',
    is_subs_active: true,
    subs_usage: { window: { used_percent: 25, window_duration_mins: 300, resets_at: 1793000000 } },
  });
  assert.equal(parsed.windows[0].usedPercent, 25);
  assert.equal(parsed.windows[0].durationMinutes, 300);
  assert.equal(parsed.windows[1].usedPercent, null);
  assert.equal(JSON.stringify(parsed).includes('synthetic-private'), false);
  assert.equal(parseMetaQuotaPayload('broken'), null);
  assert.equal(parseMetaQuotaPayload({}).windows[0].usedPercent, null);
});
test('Meta DCA is request-local and cannot fall back to an API key', async () => {
  let calls = 0,
    valid = false,
    current = true;
  const fetch = createMetaQuotaFetcher({
    downloadText: async () =>
      JSON.stringify(
        valid ? { dca_token: 'dca:synthetic-private' } : { api_key: 'synthetic-private' }
      ),
    captureCurrent: () => () => current,
    request: async (request) => {
      calls++;
      assert.equal(request.header.Authorization, 'Bearer dca:synthetic-private');
      assert.equal(request.url, 'https://api.meta.ai/muse-code/key');
      return { statusCode: 200, body: {} };
    },
  });
  const file = { name: 'meta.json', authIndex: 'meta-id' };
  await assert.rejects(fetch(file), (e) => e.code === 'missing_dca_token');
  assert.equal(calls, 0);
  valid = true;
  await fetch(file);
  assert.equal(calls, 1);
  current = false;
  await assert.rejects(fetch(file), (e) => e.code === 'stale_request');
  assert.equal(calls, 1);
});
const devinPayload = {
  userStatus: { planStatus: { dailyQuotaRemainingPercent: '60', weeklyQuotaRemainingPercent: 0 } },
};
test('Devin percentages preserve zero and unknown, without auth metadata', () => {
  const quota = readDevinQuotaResponse(devinPayload);
  assert.equal(quota.windows[0].remainingPercent, 60);
  assert.equal(quota.windows[1].remainingPercent, 0);
  assert.equal(readDevinQuotaResponse({}).windows[0].remainingPercent, null);
});
test('Devin merges in-flight reads, bounds concurrency, and refuses queued stale jobs', async () => {
  let session = 'first',
    calls = 0;
  const releases = [];
  const fetch = createDevinQuotaFetcher({
    generation: () => ({ session, file: 0 }),
    request: () => {
      calls++;
      return new Promise((resolve) =>
        releases.push(() => resolve({ statusCode: 200, body: devinPayload }))
      );
    },
  });
  const first = fetch({ name: 'one', authIndex: 'one' });
  assert.equal(fetch({ name: 'one', authIndex: 'one' }), first);
  const all = [
    first,
    fetch({ name: 'two', authIndex: 'two' }),
    fetch({ name: 'three', authIndex: 'three' }),
    fetch({ name: 'four', authIndex: 'four' }),
  ];
  const done = Promise.allSettled(all);
  assert.equal(calls, 3);
  session = 'second';
  releases.forEach((release) => release());
  assert.ok((await done).every((result) => result.status === 'rejected'));
  assert.equal(calls, 3);
});
test('new quota caches invalidate per credential and on connection cache reset', () => {
  useQuotaStore.getState().setDevinQuota({ a: { status: 'success' }, b: { status: 'success' } });
  useQuotaStore.getState().setMetaQuota({ a: { status: 'success' } });
  useQuotaStore.getState().clearQuotaCache(['a']);
  assert.equal(useQuotaStore.getState().devinQuota.a, undefined);
  assert.ok(useQuotaStore.getState().devinQuota.b);
  assert.equal(useQuotaStore.getState().metaQuota.a, undefined);
  useQuotaStore.getState().clearQuotaCache();
  assert.deepEqual(useQuotaStore.getState().devinQuota, {});
});
const status = parseAnthropicResetGrantStatus({
  eligible: true,
  at_limit: true,
  grants: [{ id: 'sample', resets_total: 2, resets_left: 2, usable_now: true }],
});
test('Claude unknown outcome reuses request id and refuses expired or different-organization retries', async () => {
  let organization = 'organization-a',
    now = 1000,
    calls = 0;
  const ids = [];
  const operations = createResetGrantOperations({
    revision: () => 1,
    readStatus: async () => status,
    readOrganization: async () => organization,
    now: () => now,
    requestId: () => 'same-id',
    claim: async (_auth, _org, _grant, id) => {
      calls++;
      ids.push(id);
      if (calls === 1) throw Error('ambiguous');
      return 'already_used';
    },
  });
  await assert.rejects(operations.run('file', 'auth', 'sample'));
  organization = 'organization-b';
  await assert.rejects(operations.run('file', 'auth', 'sample'), /identity/);
  assert.equal(calls, 1);
  organization = 'organization-a';
  assert.equal((await operations.run('file', 'auth', 'sample')).unresolved, false);
  assert.deepEqual(ids, ['same-id', 'same-id']);
  const uncertain = createResetGrantOperations({
    revision: () => 1,
    readStatus: async () => status,
    readOrganization: async () => organization,
    now: () => now,
    requestId: () => 'same-id',
    claim: async () => {
      throw Error('ambiguous');
    },
  });
  await assert.rejects(uncertain.run('file', 'auth', 'sample'));
  now += 600001;
  await assert.rejects(uncertain.run('file', 'auth', 'sample'), /expired/);
});
test('Claude rechecks eligibility and connection before sending any claim', async () => {
  let revision = 1,
    limited = false;
  const operations = createResetGrantOperations({
    revision: () => revision,
    readStatus: async () => ({ ...status, atLimit: limited }),
    readOrganization: async () => 'organization',
    now: () => 1000,
    requestId: () => 'one',
    claim: async () => assert.fail('must not spend'),
  });
  await assert.rejects(operations.run('file', 'auth', 'sample'), /blocked_not_limited/);
  const switching = createResetGrantOperations({
    revision: () => revision,
    readStatus: async () => status,
    readOrganization: async () => {
      revision++;
      return 'organization';
    },
    now: () => 1000,
    requestId: () => 'one',
    claim: async () => assert.fail('must not spend'),
  });
  await assert.rejects(switching.run('file', 'auth', 'sample'), /session/);
});
test('Devin callback requires original full URL and matching single state', () => {
  assert.equal(
    validateDevinCallback('http://localhost:1234/callback?state=abc&code=synthetic', 'abc'),
    undefined
  );
  for (const url of [
    'synthetic-code',
    'javascript:bad',
    'http://localhost/callback?state=abc&state=abc&code=synthetic',
  ])
    assert.equal(validateDevinCallback(url, 'abc'), 'invalid');
  assert.equal(
    validateDevinCallback('http://localhost/callback?state=wrong&code=synthetic', 'abc'),
    'state_mismatch'
  );
});

test('Devin visual settings preserve sibling OAuth state and explicit empty overrides', () => {
  const source =
    'oauth:\n  providers:\n    devin:\n      sensitive-words: [old]\n      future: keep # preserve-devin\n';
  const result = editYaml(source, { devinSensitiveWords: ['new'] });
  assert.deepEqual(parse(result.yaml).oauth.providers.devin['sensitive-words'], ['new']);
  assert.ok(result.yaml.includes('# preserve-devin'));
  assert.equal(parse(result.yaml).oauth.providers.devin.future, 'keep');
  assert.deepEqual(
    parse(editYaml(result.yaml, { devinSensitiveWords: [] }).yaml).oauth.providers.devin[
      'sensitive-words'
    ] ?? [],
    []
  );
});

test('Meta native mutations retain source identity, sibling keys and exact revision', async () => {
  const { installFakeV8Core } = await import('../../services/api/testing/fakeV8Core.mjs');
  const { providersApi } = await load('services/api/providers.ts');
  const { metaToResource } = await load('features/providers/adapters.ts');
  const core = installFakeV8Core(apiClient, {
    'config-version': 8,
    'api-keys': {
      meta: [
        {
          name: 'group',
          'base-url': 'https://meta.invalid/v1',
          'future-group': true,
          keys: [
            { 'api-key': 'synthetic-first', 'future-key': 'keep' },
            { 'api-key': 'synthetic-second' },
          ],
        },
      ],
    },
  });
  try {
    const [first, second] = await providersApi.getMetaConfigs();
    const resource = metaToResource(first, 0);
    assert.equal(resource.brand, 'meta');
    assert.equal(resource.raw.source, first.source);
    await providersApi.updateMetaConfig(first.apiKey, first.baseUrl, {
      ...first,
      prefix: 'changed',
    });
    assert.equal(core.doc['api-keys'].meta[0].keys[0]['future-key'], 'keep');
    assert.equal(core.doc['api-keys'].meta[0].keys[1]['api-key'], second.apiKey);
    assert.equal(
      core.calls.filter((call) => call.method === 'PUT')[0].ifMatch,
      core.calls.at(-2).etag
    );
    const refreshed = await providersApi.getMetaConfigs();
    await providersApi.deleteMetaConfig(
      refreshed[1].apiKey,
      refreshed[1].baseUrl,
      refreshed[1].source
    );
    assert.equal(core.doc['api-keys'].meta[0].keys.length, 1);
    assert.equal(core.doc['api-keys'].meta[0]['future-group'], true);
  } finally {
    core.restore();
  }
});
