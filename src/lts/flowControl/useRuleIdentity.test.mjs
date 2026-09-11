import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './testLoader.mjs';

const { reconcileRuleIdentity } = loadTypeScript('useRuleIdentity.ts');
const initial = {
  rows: [{ id: 'a', key: 0, isNew: false }, { id: 'b', key: 1, isNew: false }],
  nextKey: 2,
};

test('external deletion and reordering preserve each surviving rule identity', () => {
  assert.deepEqual(reconcileRuleIdentity(initial, ['b']).rows, [initial.rows[1]]);
  assert.deepEqual(reconcileRuleIdentity(initial, ['b', 'a']).rows, [...initial.rows].reverse());
});

test('new rows receive fresh keys and expand without reusing deleted keys', () => {
  const next = reconcileRuleIdentity(reconcileRuleIdentity(initial, ['b']), ['b', 'a']);
  assert.equal(next.rows[1].key, 2);
  assert.equal(next.rows[1].isNew, true);
  assert.equal(next.nextKey, 3);
});

test('temporarily duplicate or empty editable IDs retain distinct UI keys', () => {
  const next = reconcileRuleIdentity(initial, ['a', 'a', '', '']);
  assert.equal(new Set(next.rows.map(row => row.key)).size, 4);
  assert.equal(next.rows[0].key, 0);
  assert.deepEqual(initial.rows.map(row => row.key), [0, 1]);
});
