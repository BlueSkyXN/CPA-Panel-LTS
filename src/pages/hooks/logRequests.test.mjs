import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { createLogRequestGuard, createLogRequestQueue } = await vite.ssrLoadModule(
  '/src/pages/hooks/logRequests.ts'
);
test.after(() => vite.close());

test('clear supersedes reads, blocks duplicates, and coalesces a subsequent reload', () => {
  const queue = createLogRequestQueue();
  const old = queue.startRead(false);
  queue.startRead(false);
  const clear = queue.startClear();
  assert.equal(queue.isCurrent(old), false);
  assert.equal(queue.startClear(), null);
  assert.equal(queue.startRead(true), null);
  assert.equal(queue.finish(old), false);
  assert.equal(queue.startRead(false), null);
  assert.equal(queue.finish(clear), true);
  assert.notEqual(queue.startRead(false), null);
});

test('failed clear recovers reads but a stale finally cannot drain new work', () => {
  const queue = createLogRequestQueue();
  const clear = queue.startClear();
  assert.equal(queue.finish(clear, true), true);
  const next = queue.startRead(false);
  assert.equal(queue.finish(clear, true), false);
  assert.equal(queue.isCurrent(next), true);
  queue.invalidate();
  assert.equal(queue.isCurrent(next), false);
  assert.notEqual(queue.startRead(false), null);
});

test('viewer and session generations invalidate obsolete results', () => {
  const guard = createLogRequestGuard();
  const first = guard.capture();
  const second = guard.invalidate();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test('LTS log ownership keeps Home routing and refuses Home clear', () => {
  const source = readFileSync(new URL('../LogsPage.tsx', import.meta.url), 'utf8');
  for (const marker of [
    'useAuthStore.subscribe',
    'useConfigStore.subscribe',
    'requests.logs.startClear()',
    'requestLogHomeIpByIdRef.current[id]',
    "serverRuntimeKind === 'home'",
    'mergeIncrementalLogLines',
    'event.defaultPrevented',
  ])
    assert.ok(source.includes(marker), marker);
});
