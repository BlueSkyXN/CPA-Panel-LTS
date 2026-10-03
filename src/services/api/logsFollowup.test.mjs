import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const oldWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const { logsApi } = await vite.ssrLoadModule('/src/services/api/logs.ts');
const oldGet = apiClient.get,
  oldRaw = apiClient.getRaw;
test.after(async () => {
  apiClient.get = oldGet;
  apiClient.getRaw = oldRaw;
  globalThis.window = oldWindow;
  await vite.close();
});
test('empty cursor clears state and Home pagination retains signal and routing identity', async () => {
  apiClient.get = async () => ({ lines: [], 'next-cursor': '' });
  assert.equal((await logsApi.fetchLogs()).nextCursor, '');
  const controller = new AbortController();
  const calls = [];
  apiClient.get = async (path, options) => {
    calls.push({ path, options });
    const offset = options.params.offset ?? 0;
    return {
      logs: [{ line: `line-${offset}`, request_id: `r-${offset}`, home_ip: 'synthetic-home' }],
      total: 2,
      limit: 1,
      offset,
    };
  };
  const result = await logsApi.fetchLogs({ limit: 2 }, { signal: controller.signal });
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((call) => call.options.signal === controller.signal && call.path === '/logs')
  );
  assert.equal(result.requestLogHomeIpById['r-1'], 'synthetic-home');
});
test('Blob errors keep transport identity and successful JSON-looking logs remain data', async () => {
  const body = new Blob(['{"error":"not_found","message":"Synthetic missing log"}']);
  const error = Object.assign(new Error('transport failure'), {
    status: 404,
    code: 'ERR_BAD_REQUEST',
    data: body,
  });
  apiClient.getRaw = async () => {
    throw error;
  };
  await assert.rejects(
    logsApi.downloadErrorLog('synthetic.txt'),
    (value) =>
      value === error &&
      value.message === 'Synthetic missing log' &&
      value.status === 404 &&
      value.code === 'ERR_BAD_REQUEST' &&
      value.apiCode === 'not_found'
  );
  let options;
  apiClient.getRaw = async (_path, value) => {
    options = value;
    return { data: body };
  };
  assert.equal((await logsApi.downloadRequestLogById('r/1', 'synthetic-home')).data, body);
  assert.deepEqual(options.params, { home_ip: 'synthetic-home' });
});
