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

const [{ apiClient }, { parseApiErrorResponse }] = await Promise.all([
  vite.ssrLoadModule('/src/services/api/client.ts'),
  vite.ssrLoadModule('/src/services/api/apiError.ts'),
]);

const unauthorizedError = (config, data) =>
  new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, {
    data,
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
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
