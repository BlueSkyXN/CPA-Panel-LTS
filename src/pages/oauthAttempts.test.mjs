import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { createOAuthAttempts } = await vite.ssrLoadModule('/src/pages/oauthAttempts.ts');
test.after(() => vite.close());

function setup() {
  let id = 0;
  const tasks = new Map();
  const attempts = createOAuthAttempts({
    setTimeout: (callback, delay) => {
      tasks.set(++id, { callback, delay });
      return id;
    },
    clearTimeout: (key) => tasks.delete(key),
  });
  const tick = () => {
    for (const [key, task] of [...tasks]) {
      tasks.delete(key);
      task.callback();
    }
  };
  return { attempts, tasks, tick };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('slow polls never overlap and only wait schedules the next request', async () => {
  const { attempts, tasks, tick } = setup();
  const response = deferred();
  let calls = 0;
  attempts.begin('codex').poll(
    () => {
      calls++;
      return response.promise;
    },
    (r) => r === 'wait',
    assert.fail,
    3000
  );
  assert.equal([...tasks.values()][0].delay, 3000);
  tick();
  tick();
  tick();
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
      old.poll(
        () => response.promise,
        () => {
          effects++;
          return true;
        },
        () => effects++,
        3000
      );
      tick();
      const next = attempts.begin('codex');
      assert.equal(old.signal.aborted, true);
      assert.equal(next.signal.aborted, false);
      next.schedule(() => effects++, 3000);
      if (cleanup) attempts.invalidateAll();
      if (fails) response.reject(new Error('late'));
      else response.resolve('ok');
      await flush();
      old.invalidate();
      assert.equal(effects, 0);
      assert.equal(tasks.size, cleanup ? 0 : 1);
      assert.equal(next.isCurrent(), !cleanup);
      assert.equal(next.signal.aborted, cleanup);
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
    attempts.begin('codex').poll(
      async () => {
        if (fails) throw new Error('current');
        return 'ok';
      },
      () => {
        effects++;
        return false;
      },
      () => effects++,
      3000
    );
    tick();
    await flush();
    assert.equal(effects, 1);
    assert.equal(tasks.size, 0);
  }
});

test('accepted callback can resume a failed poll without overlapping an active request', async () => {
  const { attempts, tasks, tick } = setup();
  const attempt = attempts.begin('codex');
  let errors = 0;
  attempt.poll(async () => { throw new Error('temporary'); }, () => true, () => errors++, 3000);
  assert.equal(attempt.isPolling(), true);
  tick(); await flush();
  assert.equal(errors, 1);
  assert.equal(attempt.isPolling(), false);
  const response = deferred(); let requests = 0;
  const request = () => { requests++; return response.promise; };
  attempt.poll(request, () => false, assert.fail, 3000);
  attempt.poll(request, () => false, assert.fail, 3000);
  tick(); await flush();
  assert.equal(requests, 1);
  assert.equal(attempt.isPolling(), true);
  response.resolve('ok'); await flush();
  assert.equal(attempt.isPolling(), false);
  assert.equal(tasks.size, 0);
  attempt.invalidate();
  assert.equal(attempt.isCurrent(), false);
});

test('SIWC validates callback ownership and cancels a late start response after close', async () => {
  const { isSiwcCallbackValid, createSiwcStart, supportsSiwcBinding } = await vite.ssrLoadModule('/src/features/authFiles/siwcBinding.ts');
  const url = 'http://127.0.0.1:1455/auth/callback?state=s1&code=synthetic&client_id=issued';
  assert.equal(isSiwcCallbackValid(url, 's1'), true);
  for (const invalid of [url.replace('s1','s2'), url+'&state=s1', url.replace('&client_id=issued',''), url.replace('127.0.0.1','foreign.invalid'), url+'#secret']) assert.equal(isSiwcCallbackValid(invalid, 's1'), false);
  assert.equal(supportsSiwcBinding({name:'c.json',provider:'codex',siwcBindSupported:true}), true);
  assert.equal(supportsSiwcBinding({name:'c.json',provider:'codex',siwcBindSupported:true,runtimeOnly:true}), false);
  const response = deferred(); const cancelled=[]; let results=0;
  const start = createSiwcStart({start:()=>response.promise, cancel:async (state)=>cancelled.push(state), onResult:()=>results++, onError:assert.fail});
  const running = start.start(); start.close(); response.resolve({state:'late-state'}); await running; await flush();
  assert.deepEqual(cancelled,['late-state']); assert.equal(results,0);
});
