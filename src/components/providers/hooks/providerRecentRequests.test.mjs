import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const { createProviderRecentRequestsCacheController } = await vite.ssrLoadModule(
  '/src/components/providers/hooks/useProviderRecentRequests.ts'
);

test.after(async () => {
  await vite.close();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test('reuses recent-request cache only within the same connection scope', () => {
  const controller = createProviderRecentRequestsCacheController();
  const first = controller.forScope('https://server.example.test', 'key-a');

  assert.equal(controller.forScope('https://server.example.test', 'key-a'), first);
  assert.notEqual(controller.forScope('https://server.example.test', 'key-b'), first);
});

test('late writes to an old connection cannot populate the current cache', async () => {
  const controller = createProviderRecentRequestsCacheController();
  const serverA = controller.forScope('https://server-a.example.test', 'key-a');
  serverA.cachedUsageByProvider = new Map([['provider-a', new Map()]]);
  serverA.cachedAt = Date.now();
  serverA.inFlightRequest = Promise.resolve(serverA.cachedUsageByProvider);

  const serverB = controller.forScope('https://server-b.example.test', 'key-b');
  serverA.cachedUsageByProvider = new Map([['late-provider-a', new Map()]]);
  await serverA.inFlightRequest;

  assert.equal(controller.forScope('https://server-b.example.test', 'key-b'), serverB);
  assert.equal(serverB.cachedUsageByProvider.size, 0);
  assert.equal(serverB.cachedAt, 0);
  assert.equal(serverB.inFlightRequest, null);
});
