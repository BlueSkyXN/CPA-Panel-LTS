import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

// Behavioural checks for the v8 model-catalog refresh port (upstream 2da3e263).
// The reviewed defect was that a response belonging to a superseded connection
// still resolved as a successful refresh, so the caller showed "catalog
// updated" and re-fetched the *current* connection's model list.
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { modelsApi } = await vite.ssrLoadModule('/src/services/api/models.ts');
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
test.after(() => vite.close());

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const installPost = (impl) => {
  const original = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = impl;
  return () => {
    apiClient.instance.defaults.adapter = original;
  };
};

test('a stale refresh reports stale instead of a successful apply', async () => {
  const response = deferred();
  let seen = 0;
  const restore = installPost(async (config) => {
    seen += 1;
    const data = await response.promise;
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  });
  try {
    apiClient.setConfig({ apiBase: 'http://core-a.test', managementKey: 'k' });
    let staleNotified = 0;
    const pending = modelsApi.refreshCatalog(() => {
      staleNotified += 1;
    });
    // Connection switches while the request is still in flight.
    apiClient.setConfig({ apiBase: 'http://core-b.test', managementKey: 'k' });
    response.resolve({ changed_providers: ['claude'] });

    const result = await pending;
    assert.equal(seen, 1, 'the refresh must actually hit the old connection');
    assert.deepEqual(result, { stale: true, changedProviders: [] },
      'a superseded response must not look like a successful refresh');
    assert.equal(staleNotified, 1, 'the stale callback must fire once');
  } finally {
    restore();
  }
});

test('a current refresh still returns the changed providers', async () => {
  const restore = installPost(async (config) => ({
    data: { changed_providers: ['claude', 'gemini'] },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }));
  try {
    apiClient.setConfig({ apiBase: 'http://core-c.test', managementKey: 'k' });
    const result = await modelsApi.refreshCatalog();
    assert.deepEqual(result, { stale: false, changedProviders: ['claude', 'gemini'] });
  } finally {
    restore();
  }
});

test('a stale failure is swallowed as stale, a current failure still throws', async () => {
  const response = deferred();
  let shouldThrow = true;
  const restore = installPost(async (config) => {
    await response.promise;
    if (shouldThrow) throw new Error('core said no');
    return { data: { changed_providers: [] }, status: 200, statusText: 'OK', headers: {}, config };
  });
  try {
    apiClient.setConfig({ apiBase: 'http://core-d.test', managementKey: 'k' });
    const stalePending = modelsApi.refreshCatalog();
    apiClient.setConfig({ apiBase: 'http://core-e.test', managementKey: 'k' });
    response.resolve();
    assert.deepEqual(await stalePending, { stale: true, changedProviders: [] },
      'a failure from a superseded connection must not surface as this connection error');

    // Same adapter, current connection: the error must propagate.
    shouldThrow = true;
    const failing = modelsApi.refreshCatalog();
    response.resolve();
    await assert.rejects(failing, /core said no/,
      'a failure on the current connection must still be reported');
  } finally {
    restore();
  }
});

test('the caller drops its success path for a stale refresh', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync('src/pages/SystemPage.tsx', 'utf8');
  assert.match(
    page,
    /const result = await modelsApi\.refreshCatalog\(\);[\s\S]{0,200}?if \(result\.stale \|\| !isCurrent\(\)\) return;/,
    'SystemPage must not show success or re-fetch the current connection for a stale refresh'
  );
  assert.match(
    page,
    /requestId === catalogRequestId\.current && revision === apiClient\.getConnectionRevision\(\)/,
    'the catalog refresh must be guarded by both request id and connection revision'
  );
});
