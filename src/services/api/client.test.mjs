import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError } from 'axios';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const [{ apiClient }, { parseApiErrorResponse }, versionUtils] = await Promise.all([
  vite.ssrLoadModule('/src/services/api/client.ts'),
  vite.ssrLoadModule('/src/services/api/apiError.ts'),
  vite.ssrLoadModule('/src/utils/version.ts'),
]);

const unauthorizedError = (config, data) =>
  new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, {
    data,
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  });

test('switch preparation blocks new writes and tracks in-flight mutations until completion', async () => {
  const lifecycle = await vite.ssrLoadModule('/src/services/connectionSession.ts');
  apiClient.setConfig({ apiBase: 'https://test.example.test', managementKey: 'synthetic' });
  let finish;
  const pending = apiClient.put('/config', {}, { adapter: (config) => new Promise((resolve) => {
    finish = () => resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  }) });
  assert.equal(lifecycle.hasActiveWrites(), true);
  lifecycle.setSessionFrozen(true);
  try {
    await assert.rejects(apiClient.post('/config', {}, { adapter: () => { throw new Error('must not reach network'); } }), /Connection switch/);
    finish();
    await pending;
    assert.equal(lifecycle.hasActiveWrites(), false);
  } finally {
    lifecycle.setSessionFrozen(false);
  }
});

test('read-only usage POST queries neither block a switch nor become frozen writes', async () => {
  const lifecycle = await vite.ssrLoadModule('/src/services/connectionSession.ts');
  apiClient.setConfig({ apiBase: 'https://test.example.test', managementKey: 'synthetic' });
  const response = (config) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  for (const path of ['/usage/query/summary', '/usage/query/details', '/usage/query/pricing']) {
    let finish;
    const pending = apiClient.post(path, {}, { adapter: (config) => new Promise(resolve => { finish = () => resolve(response(config)); }) });
    try {
      assert.equal(lifecycle.hasActiveWrites(), false, path);
      lifecycle.setSessionFrozen(true);
      await apiClient.post(path, {}, { adapter: async (config) => response(config) });
      assert.equal(lifecycle.hasActiveWrites(), false);
    } finally {
      finish();
      await pending;
      lifecycle.setSessionFrozen(false);
    }
  }
  lifecycle.setSessionFrozen(true);
  try {
    for (const path of ['/usage/import', '/usage/query/unknown', '/usage/query/summary/extra']) {
      await assert.rejects(apiClient.post(path, {}, { adapter: async (config) => response(config) }), /Connection switch/);
    }
    await assert.rejects(apiClient.put('/usage/query/summary', {}, { adapter: async (config) => response(config) }), /Connection switch/);
  } finally { lifecycle.setSessionFrozen(false); }
});

test.after(async () => {
  apiClient.clearConfig();
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('binds connection details when the request is created', async () => {
  const initialGeneration = apiClient.setConfig({
    apiBase: 'https://old-core.example.test',
    managementKey: 'old-management-key',
  });

  let capturedConfig;
  const pending = apiClient.get('/probe', {
    adapter: async (config) => {
      capturedConfig = config;
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    },
  });

  apiClient.setConfig({
    apiBase: 'https://new-core.example.test',
    managementKey: 'new-management-key',
  });

  await pending;

  assert.equal(capturedConfig.baseURL, 'https://old-core.example.test/v0/management');
  assert.equal(capturedConfig.headers.get('Authorization'), 'Bearer old-management-key');
  assert.equal(capturedConfig.__cpaConnectionGeneration, initialGeneration);
});

test('prefers a human-readable Management API message and preserves the stable code', () => {
  assert.deepEqual(
    parseApiErrorResponse(
      {
        error: 'plugin_install_failed',
        message: 'download plugin archive: 404 Not Found',
      },
      'Request failed with status code 502'
    ),
    {
      message: 'download plugin archive: 404 Not Found',
      apiCode: 'plugin_install_failed',
    }
  );
  assert.deepEqual(parseApiErrorResponse({ error: 'invalid body' }, 'Bad Request'), {
    message: 'invalid body',
    apiCode: 'invalid body',
  });
  assert.deepEqual(
    parseApiErrorResponse(
      { error: { code: 'invalid_config', message: 'plugins-dir is invalid' } },
      'Bad Request'
    ),
    {
      message: 'plugins-dir is invalid',
      apiCode: 'invalid_config',
    }
  );
  assert.deepEqual(parseApiErrorResponse('upstream unavailable', 'Network Error'), {
    message: 'upstream unavailable',
  });
  assert.deepEqual(parseApiErrorResponse({ error: null }, 'Network Error'), {
    message: 'Network Error',
    apiCode: undefined,
  });
});

test('rejects placeholder versions and compares real CPA release versions', () => {
  for (const placeholder of ['', ' unknown ', 'DEV', 'none', 'null', 'N/A', 'not set', 'unset']) {
    assert.equal(versionUtils.normalizeReportedVersion(placeholder), null, placeholder);
  }
  assert.equal(versionUtils.normalizeReportedVersion(' v1-lts-0.0.29 '), 'v1-lts-0.0.29');
  assert.equal(versionUtils.compareVersions('v1-lts-0.0.30', 'v1-lts-0.0.29'), 1);
  assert.equal(versionUtils.compareVersions('v1-lts-0.0.29', 'v1-lts-0.0.29'), 0);
  assert.equal(versionUtils.compareVersions('unknown', 'v1-lts-0.0.29'), null);
});

test('does not publish an unknown response header as the current CPA version', async () => {
  let versionEvent;
  const onVersion = (event) => {
    versionEvent = event.detail;
  };
  window.addEventListener('server-version-update', onVersion);

  try {
    apiClient.setConfig({ apiBase: 'https://test.example.test', managementKey: 'synthetic' });
    await apiClient.get('/version-placeholder', {
      adapter: async (config) => ({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {
          'x-cpa-version': 'unknown',
          'x-cpa-build-date': '2026-09-20T09:08:24Z',
        },
        config,
      }),
    });
    assert.deepEqual(versionEvent, {
      version: null,
      buildDate: '2026-09-20T09:08:24Z',
      runtimeKind: 'cpa',
    });
  } finally {
    window.removeEventListener('server-version-update', onVersion);
  }
});

test('a stale 401 keeps its parsed error but cannot log out the current connection', async () => {
  let releaseStaleRequest;
  let unauthorizedEvents = 0;
  const onUnauthorized = () => {
    unauthorizedEvents += 1;
  };
  window.addEventListener('unauthorized', onUnauthorized);

  try {
    apiClient.setConfig({
      apiBase: 'https://old-core.example.test',
      managementKey: 'old-management-key',
    });
    const staleRequest = apiClient.get('/stale-401', {
      adapter: (config) =>
        new Promise((_, reject) => {
          releaseStaleRequest = () =>
            reject(
              unauthorizedError(config, {
                error: 'stale_unauthorized',
                message: 'old connection expired',
              })
            );
        }),
    });

    apiClient.setConfig({
      apiBase: 'https://current-core.example.test',
      managementKey: 'current-management-key',
    });
    assert.equal(typeof releaseStaleRequest, 'function');
    releaseStaleRequest();

    await assert.rejects(staleRequest, (error) => {
      assert.equal(error.message, 'old connection expired');
      assert.equal(error.status, 401);
      assert.equal(error.apiCode, 'stale_unauthorized');
      return true;
    });
    assert.equal(unauthorizedEvents, 0);

    await assert.rejects(
      apiClient.get('/current-401', {
        adapter: async (config) => {
          throw unauthorizedError(config, {
            error: 'unauthorized',
            message: 'current connection expired',
          });
        },
      }),
      (error) => {
        assert.equal(error.message, 'current connection expired');
        assert.equal(error.apiCode, 'unauthorized');
        return true;
      }
    );
    assert.equal(unauthorizedEvents, 1);
  } finally {
    window.removeEventListener('unauthorized', onUnauthorized);
  }
});
