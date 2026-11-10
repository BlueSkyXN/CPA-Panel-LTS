import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { loadTypeScript } from './testLoader.mjs';
const m = loadTypeScript('model.ts');
const h = loadTypeScript('history.ts');
const g = loadTypeScript('grouping.ts');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/grouped-summary.json', import.meta.url), 'utf8'));
const data = m.parseFlowCapabilities(fixture);
const history = h.appendFlowSample([], data.state);
const groups = data.state.breakdown.groups;
const id = (row, field) => g.flowGroupValue(row, field);

test('shared Core fixture preserves qualified models, credentials and exact totals', () => {
  assert(data.features.includes('grouped-summary'));
  assert.deepEqual(m.parseFlowEvent(fixture).breakdown, data.state.breakdown);
  assert.equal(history[0].breakdown.groups.length, 4);
  const models = g.aggregateFlowPoint(history[0], 'attempts', 'model', {});
  assert.equal(models.get(id(groups[0], 'model')), 3);
  assert.equal(models.get(id(groups[2], 'model')), 1);
  assert.equal(g.aggregateFlowPoint(history[0], 'requests', 'model', {}).get(id(groups[3], 'model')), 2);
  assert.equal([...g.aggregateFlowPoint(history[0], 'waiting', 'account', {}).values()].reduce((a, b) => a + b), 2);
});

test('cross filters select a model on each credential and a caller without widening missing selections', () => {
  const model = id(groups[0], 'model');
  const values = g.aggregateFlowPoint(history[0], 'attempts', 'account', { model });
  assert.equal(values.get(id(groups[0], 'account')), 2);
  assert.equal(values.get(id(groups[1], 'account')), 1);
  const caller = g.aggregateFlowPoint(history[0], 'attempts', 'account', { model, key: id(groups[1], 'key') });
  assert.deepEqual([...caller.values()], [1]);
  assert.equal(g.aggregateFlowPoint(history[0], 'attempts', 'model', { account: '["missing"]' }).size, 0);
});

test('incomplete or missing snapshots leave gaps; complete zero snapshots produce zero', () => {
  const full = history[0];
  const partial = { ...full, sampledAt: full.sampledAt + 1000, breakdown: { ...full.breakdown, truncated: true, omitted: { 'active-requests': 0, 'active-attempts': 2, waiting: 0 } } };
  assert.equal(g.aggregateFlowPoint(partial, 'attempts', 'model', {}), null);
  assert(g.aggregateFlowPoint(partial, 'requests', 'model', {}) instanceof Map);
  const empty = { ...full, sampledAt: full.sampledAt + 2000, breakdown: { groups: [], truncated: false, omitted: { 'active-requests': 0, 'active-attempts': 0, waiting: 0 } } };
  const absent = { ...full, sampledAt: full.sampledAt + 3000, breakdown: undefined };
  const view = g.buildFlowSeries([full, partial, empty, absent], 'attempts', 'model', {}, [id(groups[0], 'model')]);
  assert.deepEqual(view.series[0].values, [3, null, 0, null]);
  assert.equal(view.incomplete, 2);
  assert.deepEqual(g.flowValueSegments([full, partial, empty, absent], view.series[0].values).map(segment => segment.length), [1, 1]);
});

test('automatic bounded lines conserve all counts in Other; explicit empty selection stays empty', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ stage: 'attempt', model: `model-${index}`, active: index + 1, waiting: 0 }));
  const point = { ...history[0], breakdown: { groups: rows, omitted: { 'active-requests': 0, 'active-attempts': 0, waiting: 0 }, truncated: false } };
  const view = g.buildFlowSeries([point], 'attempts', 'model', {});
  assert.equal(view.series.length, g.MAX_FLOW_LINES + 1);
  assert.equal(view.series.at(-1).id, g.OTHER_FLOW_LINE);
  assert.equal(view.series.reduce((sum, line) => sum + line.values[0], 0), 210);
  assert.deepEqual(g.buildFlowSeries([point], 'attempts', 'model', {}, []).series, []);
  assert.deepEqual(g.buildFlowSeries([point], 'attempts', 'model', {}, ['["attempt","","missing"]']).series[0].values, [0]);
});

test('untrusted breakdowns cannot corrupt totals or carry old group samples forward', () => {
  const state = fixture.state;
  for (const patch of [
    { groups: [...state.breakdown.groups, state.breakdown.groups[0]] },
    { groups: [{ ...state.breakdown.groups[0], key: 'raw-key' }] },
    { groups: state.breakdown.groups.map((row, i) => i ? row : { ...row, active: -1 }) },
    { groups: Array(129).fill(state.breakdown.groups[0]) },
    { omitted: { ...state.breakdown.omitted, waiting: 1 } },
    { truncated: true },
  ]) {
    const parsed = m.parseFlowEvent({ ...fixture, state: { ...state, breakdown: { ...state.breakdown, ...patch } } });
    assert.equal(parsed['active-attempts'], 4);
    assert.equal(parsed.breakdown, undefined);
  }
  const { breakdown, ...without } = state;
  const next = m.parseFlowEvent({ ...fixture, state: without });
  assert.equal(m.mergeSummary(data.state, next).breakdown, undefined);
  assert.equal(h.appendFlowSample(history, { ...next, 'sampled-at': '2026-11-10T00:00:02Z' }).at(-1).breakdown, undefined);
  assert(breakdown);
});

test('reconnect boundaries still split individual group curves', () => {
  const points = [history[0], { ...history[0], sampledAt: history[0].sampledAt + 2000, breakBefore: true }];
  assert.deepEqual(g.flowValueSegments(points, [1, 2]).map(segment => segment.length), [1, 1]);
});
