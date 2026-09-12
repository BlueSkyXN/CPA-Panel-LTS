import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { createOAuthAttempts } = await vite.ssrLoadModule('/src/pages/oauthAttempts.ts');
test.after(() => vite.close());

function setup() {
  let id = 0;
  const tasks = new Map();
  const attempts = createOAuthAttempts({
    setTimeout: (callback, delay) => { tasks.set(++id, { callback, delay }); return id; },
    clearTimeout: (key) => tasks.delete(key),
  });
  const tick = () => {
    for (const [key, task] of [...tasks]) { tasks.delete(key); task.callback(); }
  };
  return { attempts, tasks, tick };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('slow polls never overlap and only wait schedules the next request', async () => {
  const { attempts, tasks, tick } = setup();
  const response = deferred();
  let calls = 0;
  attempts.begin('codex').poll(() => { calls++; return response.promise; }, (r) => r === 'wait', assert.fail, 3000);
  assert.equal([...tasks.values()][0].delay, 3000);
  tick(); tick(); tick();
  assert.equal(calls, 1);
  assert.equal(tasks.size, 0);
  response.resolve('wait');
  await flush();
  assert.equal(tasks.size, 1);
  tick();
  assert.equal(calls, 2);
});

for (const fails of [false, true]) {
  test(`late ${fails ? 'error' : 'success'} is inert after retry or unmount`, async () => {
    for (const cleanup of [false, true]) {
      const { attempts, tasks, tick } = setup();
      const response = deferred();
      let effects = 0;
      const old = attempts.begin('codex');
      old.poll(() => response.promise, () => { effects++; return true; }, () => effects++, 3000);
      tick();
      const next = attempts.begin('codex');
      next.schedule(() => effects++, 3000);
      if (cleanup) attempts.invalidateAll();
      if (fails) response.reject(new Error('late'));
      else response.resolve('ok');
      await flush();
      old.invalidate();
      assert.equal(effects, 0);
      assert.equal(tasks.size, cleanup ? 0 : 1);
      assert.equal(next.isCurrent(), !cleanup);
    }
  });
}

test('retry cancels only its own success reset and terminal polls stop', async () => {
  const { attempts, tasks, tick } = setup();
  let resets = 0;
  attempts.begin('codex').schedule(() => resets++, 5000);
  attempts.begin('anthropic').schedule(() => resets++, 5000);
  attempts.begin('codex');
  tick();
  assert.equal(resets, 1);
  assert.equal(tasks.size, 0);
  for (const fails of [false, true]) {
    let effects = 0;
    attempts.begin('codex').poll(async () => { if (fails) throw new Error('current'); return 'ok'; },
      () => { effects++; return false; }, () => effects++, 3000);
    tick(); await flush();
    assert.equal(effects, 1);
    assert.equal(tasks.size, 0);
  }
});
