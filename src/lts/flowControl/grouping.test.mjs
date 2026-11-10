import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { loadTypeScript } from './testLoader.mjs';
const m = loadTypeScript('model.ts');
const h = loadTypeScript('history.ts');
const g = loadTypeScript('grouping.ts');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/grouped-summary.json', import.meta.url), 'utf8'));
const data = m.parseFlowCapabilities(fixture);
const sample = m.parseFlowEvent(fixture, 'model');
const history = h.appendFlowSample([], sample);
const groups = sample.breakdown.groups;
const id = (row, field) => g.flowGroupValue(row, field);

test('shared Core fixture preserves qualified models, credentials and exact totals', () => {
  assert(data.features.includes('on-demand-grouped-summary'));
  assert.deepEqual(m.parseFlowEvent(fixture, 'model').breakdown, sample.breakdown);
  assert.equal(history[0].breakdown.groups.length, 3);
  const models = g.aggregateFlowPoint(history[0], 'attempts', 'model');
  assert.equal(models.get(id(groups[0], 'model')), 3);
  assert.equal(models.get(id(groups[1], 'model')), 1);
  assert.equal(g.aggregateFlowPoint(history[0], 'requests', 'model').get(id(groups[2], 'model')), 2);
  assert.equal([...g.aggregateFlowPoint(history[0], 'waiting', 'model').values()].reduce((a, b) => a + b), 2);
});

test('a sample cannot be projected onto a different subscription view', () => {
  assert.equal(g.aggregateFlowPoint(history[0], 'attempts', 'account'), null);
  assert.equal(m.parseFlowEvent(fixture, 'account'), null);
  assert.equal(m.parseFlowCapabilities(fixture).state.breakdown, undefined);
  assert.equal(m.parseFlowEvent(fixture).breakdown, undefined);
});

test('incomplete or missing snapshots leave gaps; complete zero snapshots produce zero', () => {
  const full = history[0];
  const partial = { ...full, sampledAt: full.sampledAt + 1000, breakdown: { ...full.breakdown, truncated: true, omitted: { 'active-requests': 0, 'active-attempts': 2, waiting: 0 } } };
  assert.equal(g.aggregateFlowPoint(partial, 'attempts', 'model'), null);
  assert(g.aggregateFlowPoint(partial, 'requests', 'model') instanceof Map);
  const empty = { ...full, sampledAt: full.sampledAt + 2000, breakdown: { view: 'model', groups: [], truncated: false, omitted: { 'active-requests': 0, 'active-attempts': 0, waiting: 0 } } };
  const absent = { ...full, sampledAt: full.sampledAt + 3000, breakdown: undefined };
  const view = g.buildFlowSeries([full, partial, empty, absent], 'attempts', 'model', [id(groups[0], 'model')]);
  assert.deepEqual(view.series[0].values, [3, null, 0, null]);
  assert.equal(view.incomplete, 2);
  assert.deepEqual(g.flowValueSegments([full, partial, empty, absent], view.series[0].values).map(segment => segment.length), [1, 1]);
});

test('automatic bounded lines conserve all counts in Other; explicit empty selection stays empty', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ stage: 'attempt', model: `model-${index}`, active: index + 1, waiting: 0 }));
  const point = { ...history[0], breakdown: { view: 'model', groups: rows, omitted: { 'active-requests': 0, 'active-attempts': 0, waiting: 0 }, truncated: false } };
  const view = g.buildFlowSeries([point], 'attempts', 'model');
  assert.equal(view.series.length, g.MAX_FLOW_LINES + 1);
  assert.equal(view.series.at(-1).id, g.OTHER_FLOW_LINE);
  assert.equal(view.series.reduce((sum, line) => sum + line.values[0], 0), 210);
  assert.deepEqual(g.buildFlowSeries([point], 'attempts', 'model', []).series, []);
  assert.deepEqual(g.buildFlowSeries([point], 'attempts', 'model', ['["attempt","","missing"]']).series[0].values, [0]);
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
    const parsed = m.parseFlowEvent({ ...fixture, state: { ...state, breakdown: { ...state.breakdown, ...patch } } }, 'model');
    assert.equal(parsed['active-attempts'], 4);
    assert.equal(parsed.breakdown, undefined);
  }
  const { breakdown, ...without } = state;
  const next = m.parseFlowEvent({ ...fixture, state: without }, 'model');
  assert.equal(m.mergeSummary(sample, next).breakdown, undefined);
  assert.equal(h.appendFlowSample(history, { ...next, 'sampled-at': '2026-11-10T00:00:02Z' }).at(-1).breakdown, undefined);
  assert(breakdown);
});

test('reconnect boundaries still split individual group curves', () => {
  const points = [history[0], { ...history[0], sampledAt: history[0].sampledAt + 2000, breakBefore: true }];
  assert.deepEqual(g.flowValueSegments(points, [1, 2]).map(segment => segment.length), [1, 1]);
});


test('each view accepts only its projected identity and conserves all stage totals', () => {
  for (const view of ['account', 'key', 'provider']) {
    const identity = view === 'provider' ? 'p' : 'a'.repeat(64);
    const groups = [
      { stage: 'attempt', [view]: identity, active: 4, waiting: 2 },
      { stage: 'request', ...(view === 'key' ? { key: identity } : {}), active: 2, waiting: 0 },
    ];
    const state = { ...fixture.state, breakdown: { ...fixture.state.breakdown, view, groups } };
    assert.equal(m.parseFlowEvent({ ...fixture, state }, view).breakdown.view, view);
    const polluted = { ...groups[0], model: 'unrequested' };
    assert.equal(m.parseFlowEvent({ ...fixture, state: { ...state, breakdown: { ...state.breakdown, groups: [polluted, groups[1]] } } }, view).breakdown, undefined);
    if (view !== 'key') {
      const invalid = { ...groups[1], [view]: identity };
      assert.equal(m.parseFlowEvent({ ...fixture, state: { ...state, breakdown: { ...state.breakdown, groups: [groups[0], invalid] } } }, view).breakdown, undefined);
    }
  }
});

test('identity byte bounds match Core JSON escaping without structural overhead', () => {
  const parse = model => m.parseFlowBreakdown({ view: 'model', groups: [{ stage: 'attempt', model, active: 1, waiting: 0 }], omitted: { 'active-requests': 0, 'active-attempts': 0, waiting: 0 }, truncated: false }, { 'active-requests': 0, 'active-attempts': 1, waiting: 0 }, 'model');
  assert(parse('x'.repeat(1017))); // seven bytes for attempt, no JSON punctuation counted.
  assert.equal(parse('x'.repeat(1018)), undefined);
  assert(parse('<'.repeat(169)));
  assert.equal(parse('<'.repeat(170)), undefined);
  assert(parse('中'.repeat(339)));
  assert.equal(parse('中'.repeat(340)), undefined);
});
