import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './testLoader.mjs';
const { appendFlowSample, flowSampleSegments, flowSamplePosition } = loadTypeScript('history.ts');
const sample = (ms, count = 1) => ({ 'sampled-at': new Date(ms).toISOString(), 'active-requests': count, 'active-attempts': count + 1, waiting: 0 });

test('irregular sampling is positioned by server time, not array index', () => {
  let history = [];
  for (const ms of [1000, 1500, 6000]) history = appendFlowSample(history, sample(ms), { intervalMs: 2000 });
  assert.equal(flowSamplePosition(history, history[1]), 0.1);
  assert.equal(flowSamplePosition(history, history[2]), 1);
  assert.equal(flowSampleSegments(history).length, 1);
});

test('reconnects and long gaps do not join a continuous line', () => {
  let history = appendFlowSample([], sample(1000));
  history = appendFlowSample(history, sample(2000), { discontinuity: true });
  history = appendFlowSample(history, sample(3000));
  history = appendFlowSample(history, sample(20000));
  assert.deepEqual(flowSampleSegments(history).map(s => s.length), [1, 2, 1]);
});

test('unknown timestamps are not replaced with invented wall-clock samples', () => {
  const history = appendFlowSample([], sample(1000));
  assert.strictEqual(appendFlowSample(history, { ...sample(2000), 'sampled-at': 'invalid' }), history);
  assert.strictEqual(appendFlowSample(history, { ...sample(2000), 'sampled-at': undefined }), history);
  assert.strictEqual(appendFlowSample(history, sample(500)), history);
});

test('duplicate samples update counts without expanding history or erasing a gap', () => {
  let history = appendFlowSample([], sample(1000));
  history = appendFlowSample(history, sample(2000), { discontinuity: true });
  history = appendFlowSample(history, sample(2000, 7));
  assert.equal(history.length, 2);
  assert.equal(history[1].requests, 7);
  assert.equal(history[1].breakBefore, true);
});

test('process reset drops prior samples and the window remains bounded', () => {
  let history = [];
  for (let i = 0; i < 100; i++) history = appendFlowSample(history, sample(i * 1000));
  assert.equal(history.length, 60);
  assert.equal(history[0].sampledAt, 40000);
  const fresh = appendFlowSample(history, sample(1), { reset: true });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].sampledAt, 1);
});
