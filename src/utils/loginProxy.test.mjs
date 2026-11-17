import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

// Login proxy port of upstream 6b1b94a7 + 96ce4e1b on the LTS OAuth page.
// The validator mirrors Core's validateOAuthSessionProxyURL so an invalid
// value never leaves the browser; a non-empty value moves the auth-url start
// request into a POST body because Core rejects proxy_url in the query string.
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { checkLoginProxyUrl, planLoginProxy, shouldShowLoginProxyError, isInvalidProxyUrlError, maskProxyUrl } =
  await vite.ssrLoadModule('/src/utils/loginProxy.ts');
const { oauthApi } = await vite.ssrLoadModule('/src/services/api/oauth.ts');
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
test.after(() => vite.close());

const PROXY = 'socks5://user:pass@127.0.0.1:1080';

const accepted = [
  'socks5://user:pass@127.0.0.1:1080',
  'socks5h://proxy.example.com:1080',
  'SOCKS5://Host:1080', // Go lowercases the scheme
  'http://proxy.example.com', // http(s) may omit the port
  'http://proxy.example.com:8080/', // a bare trailing slash is not a path
  'https://u:p@proxy.example.com:8443',
  'http://host:80?', // a lone "?" is an empty query
  'http://host:80#', // and a lone "#" an empty fragment
  'http://host:65535',
  'http://host:0080',
  'http://[::1]:8080',
  'socks5://[::ffff:1.2.3.4]:1080',
  'http://[fe80::1%25en0]:80',
  'http://u:p@ss@host:80', // Go splits userinfo at the last "@"
  'http://u%40x:p%3Ass@host:80',
  'socks5://a:1:2', // non-http schemes split the port at the last colon
  'http://exa_mple.com:80',
  'http://例子.测试:8080',
  'http://ex%c3%a9mple:80',
];

const rejected = [
  'ftp://host:21', // scheme: only http, https, socks5, socks5h
  'socks4://host:1080',
  'direct', // "direct"/"none" are not a concrete proxy
  'none',
  'proxy.example.com', // no scheme
  'host:8080',
  '//host:80',
  'http:host:80', // no "//" authority
  'http://', // no host
  'http://:8080',
  'http://user@:80',
  'socks5://host', // socks5(h) requires a port
  'socks5h://host',
  'http://host:', // dangling colon
  'http://[::1]:',
  'http://host:0', // port must be 1-65535
  'http://host:65536',
  'http://host:abc',
  'http://host/path', // no path
  'http://host:80/%2F',
  'http://host:80?a=1', // no query
  'http://host:80#frag', // no fragment
  'socks5://user:p#ss@host:1080',
  'http://a:1:2', // Go 1.26 rejects extra colons for http(s)
  'http://[1.2.3.4]:80', // brackets need IPv6
  'http://[::1',
  'http://ho st:80', // whitespace or control characters
  'http://h\u0001ost:80',
  'http://u p@host:80',
  'http://ü:p@host:80', // non-ASCII userinfo must be escaped
  'http://u%zz:p@host:80',
  'http://ex|ample:80',
  'http://ex%41mple:80', // hosts may only escape non-ASCII bytes
  'http://%c2%a0:80', // blank hostname after unescaping
];

for (const raw of accepted) {
  test(`accepts ${JSON.stringify(raw)}`, () => {
    assert.deepEqual(checkLoginProxyUrl(raw), { kind: 'valid', url: raw });
  });
}
for (const raw of rejected) {
  test(`rejects ${JSON.stringify(raw)}`, () => {
    assert.deepEqual(checkLoginProxyUrl(raw), { kind: 'invalid' });
  });
}

test('blank input means no proxy, and valid input is sent trimmed', () => {
  assert.deepEqual(checkLoginProxyUrl(''), { kind: 'empty' });
  assert.deepEqual(checkLoginProxyUrl(' \t\n '), { kind: 'empty' });
  assert.deepEqual(checkLoginProxyUrl(`  ${PROXY}  `), { kind: 'valid', url: PROXY });
});

test('planning never falls back to a proxy-less login on invalid values', () => {
  assert.deepEqual(planLoginProxy(''), { kind: 'none' });
  assert.deepEqual(planLoginProxy('   '), { kind: 'none' });
  assert.deepEqual(planLoginProxy(` ${PROXY} `), { kind: 'proxy', url: PROXY });
  assert.deepEqual(planLoginProxy('socks5://host'), { kind: 'invalid' });
});

test('the inline error appears after blur or a refused login, and tracks the refused value', () => {
  const state = (touched, rejectedValue) => ({ touched, rejectedValue });
  assert.equal(shouldShowLoginProxyError('socks5://host', state(false, null)), false);
  assert.equal(shouldShowLoginProxyError('socks5://host', state(true, null)), true);
  assert.equal(shouldShowLoginProxyError('socks5://host', state(false, 'socks5://host')), true);
  assert.equal(shouldShowLoginProxyError('', state(true, null)), false);
  assert.equal(shouldShowLoginProxyError(PROXY, state(true, null)), false);
  // Locally valid but refused by the backend: flagged until edited.
  assert.equal(shouldShowLoginProxyError(` ${PROXY} `, state(false, PROXY)), true);
  assert.equal(shouldShowLoginProxyError('http://other:8080', state(false, PROXY)), false);
});

test('masking hides userinfo and keeps scheme, host and port', () => {
  assert.equal(maskProxyUrl(PROXY), 'socks5://***@127.0.0.1:1080');
  assert.equal(maskProxyUrl('http://onlyuser@proxy.example.com:8080/'), 'http://***@proxy.example.com:8080');
  assert.equal(maskProxyUrl('http://u:p@ss@host:80'), 'http://***@host:80');
  assert.equal(maskProxyUrl('https://u:p@[::1]:8443'), 'https://***@[::1]:8443');
  assert.equal(maskProxyUrl(' http://proxy.example.com:3128 '), 'http://proxy.example.com:3128');
});

test('masking never leaks a credential even from malformed input', () => {
  for (const raw of ['socks5://user:p/ss@host:1', 'user:secret@host:1', 'http://a:b?c#d@h']) {
    const masked = maskProxyUrl(raw);
    assert.ok(!masked.includes('secret'), masked);
    assert.ok(!/user|:p\/ss|a:b/.test(masked), masked);
  }
});

test('maps the backend 400 invalid proxy_url to a recognizable rejection', () => {
  assert.equal(isInvalidProxyUrlError({ status: 400, apiCode: 'invalid proxy_url' }), true);
  assert.equal(isInvalidProxyUrlError({ status: 400, message: 'invalid proxy_url' }), true);
  assert.equal(isInvalidProxyUrlError({ status: 400, message: 'invalid provider' }), false);
  assert.equal(isInvalidProxyUrlError({ status: 500, message: 'invalid proxy_url' }), false);
  assert.equal(isInvalidProxyUrlError(new Error('invalid proxy_url')), false);
});

// --- oauthApi.startAuth wire contract ---------------------------------------

function installAdapter(capture) {
  const original = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async (config) => {
    capture(config);
    return { data: { url: 'https://auth.example', state: 's1' }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return () => {
    apiClient.instance.defaults.adapter = original;
  };
}

test('a proxy moves the request into a POST body with a trimmed proxy_url', async () => {
  apiClient.setConfig({ apiBase: 'http://core.test', managementKey: 'k' });
  const sent = [];
  const restore = installAdapter((config) => sent.push({
    method: config.method,
    url: config.url,
    params: config.params,
    data: config.data,
  }));
  try {
    await oauthApi.startAuth('codex', { proxyUrl: ` ${PROXY} ` });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'post');
    assert.equal(sent[0].url, '/oauth/auth-url');
    const body = typeof sent[0].data === 'string' ? JSON.parse(sent[0].data) : sent[0].data;
    assert.deepEqual(body, { provider: 'codex', is_webui: true, proxy_url: PROXY });
    // An empty params object serializes to no query string.
    assert.deepEqual(sent[0].params, {});
  } finally {
    restore();
  }
});

test('blank proxies keep the original GET request', async () => {
  apiClient.setConfig({ apiBase: 'http://core.test', managementKey: 'k' });
  const sent = [];
  const restore = installAdapter((config) => sent.push({ method: config.method, params: config.params }));
  try {
    for (const blank of ['', '   ', undefined]) {
      await oauthApi.startAuth('gemini-cli', { proxyUrl: blank, projectId: 'ALL' });
    }
    assert.equal(sent.length, 3);
    for (const req of sent) {
      assert.equal(req.method, 'get');
    }
    assert.deepEqual(sent[0].params, { is_webui: true, project_id: 'ALL', provider: 'gemini-cli' });
  } finally {
    restore();
  }
});

test('a proxied gemini login keeps project_id in the query string', async () => {
  apiClient.setConfig({ apiBase: 'http://core.test', managementKey: 'k' });
  const sent = [];
  const restore = installAdapter((config) => sent.push({ params: config.params, data: config.data }));
  try {
    await oauthApi.startAuth('gemini-cli', { proxyUrl: PROXY, projectId: 'ALL' });
    assert.deepEqual(sent[0].params, { project_id: 'ALL' });
    const body = typeof sent[0].data === 'string' ? JSON.parse(sent[0].data) : sent[0].data;
    assert.deepEqual(body, { provider: 'gemini-cli', is_webui: true, proxy_url: PROXY });
  } finally {
    restore();
  }
});

// Backend 400 mapping through the real error path: an Axios adapter failure is
// converted by the shared client's handleError (ApiError with status/apiCode)
// before isInvalidProxyUrlError sees it. A bare `new Error("invalid
// proxy_url")` without status 400 must stay unrecognized.
test('isInvalidProxyUrlError recognizes backend rejections via the real client error path', async (t) => {
  const cases = [
    {
      name: '400 with error code invalid proxy_url → recognized',
      status: 400,
      body: { error: 'invalid proxy_url' },
      want: true,
    },
    {
      name: '400 with the same code plus a detailed message → recognized',
      status: 400,
      body: { error: 'invalid proxy_url', message: 'invalid proxy_url: socks5 requires a port' },
      want: true,
    },
    {
      name: '400 with a different error code → not a proxy rejection',
      status: 400,
      body: { error: 'provider_disabled' },
      want: false,
    },
    {
      name: '500 with invalid proxy_url → not a proxy rejection',
      status: 500,
      body: { error: 'invalid proxy_url' },
      want: false,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      apiClient.setConfig({ apiBase: 'http://core.test', managementKey: 'k' });
      const original = apiClient.instance.defaults.adapter;
      apiClient.instance.defaults.adapter = async (config) => {
        const response = { data: testCase.body, status: testCase.status, statusText: '', headers: {}, config };
        throw Object.assign(new Error(`Request failed with status code ${testCase.status}`), {
          isAxiosError: true,
          config,
          request: {},
          response,
        });
      };
      try {
        let caught;
        try {
          await oauthApi.startAuth('codex', { proxyUrl: PROXY });
        } catch (error) {
          caught = error;
        }
        assert.ok(caught, 'startAuth must reject when the backend refuses the proxy');
        assert.equal(caught.name, 'ApiError', 'the shared client must convert the adapter failure');
        assert.equal(caught.status, testCase.status);
        assert.equal(
          isInvalidProxyUrlError(caught),
          testCase.want,
          `isInvalidProxyUrlError(error=${JSON.stringify({ status: caught.status, apiCode: caught.apiCode, message: caught.message })})`
        );
      } finally {
        apiClient.instance.defaults.adapter = original;
      }
    });
  }
});
