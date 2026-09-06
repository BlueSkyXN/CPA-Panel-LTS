import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTypeScript } from './testLoader.mjs';
const m = loadTypeScript('model.ts');
const summary = {
  enabled: true, 'active-requests': 1, 'active-attempts': 1, waiting: 0, 'queued-bytes': 0,
  buckets: [], 'process-id': 'one', 'policy-revision': 1,
};
const raw = {
  'schema-version': 3, supported: true, 'events-supported': true, 'events-enabled': false,
  policy: { version: 3, enabled: true, rules: [] },
  state: summary, models: ['public'],
  'model-options': [{ ref: 'p::actual', provider: 'p', model: 'actual', aliases: ['public'] }],
};

test('first-use empty policy is a disabled V3 draft, not a legacy migration', () => {
  for (const config of [{}, { 'flow-control': {} }, { 'flow-control': { enabled: false, rules: [] } }]) {
    const values = m.readFlowControlValues(config);
    assert.equal(values.flowControlVersion, '3');
    assert.equal(values.flowControlEnabled, false);
    assert.equal(values.flowControlRealtime, false);
    assert.equal(values.flowControlResources, false);
  }
});

test('real legacy and future configurations keep their explicit semantics', () => {
  assert.equal(m.readFlowControlValues({ 'flow-control': { rules: [{ id: 'r' }] } }).flowControlVersion, '');
  assert.equal(m.readFlowControlValues({ 'flow-control': { enabled: true } }).flowControlVersion, '');
  assert.equal(m.readFlowControlValues({ 'flow-control': { rules: 'future-draft' } }).flowControlVersion, '');
  assert.equal(m.readFlowControlValues({ 'flow-control': { version: 2 } }).flowControlVersion, '2');
  assert.equal(m.readFlowControlValues({ 'flow-control': { version: 8 } }).flowControlVersion, '8');
});

test('execution choices require a resolved directory, never public-alias fallback', () => {
  const old = m.parseFlowCapabilities(raw);
  assert.deepEqual(m.modelOptionsForStage(old, 'attempt'), []);
  assert.deepEqual(m.modelOptionsForStage(old, 'request'), [{ value: 'public', label: 'public' }]);
  const data = m.parseFlowCapabilities({ ...raw, features: ['resolved-model-options'] });
  const [option] = m.modelOptionsForStage(data, 'attempt');
  assert.equal(option.value, 'p::actual');
  assert.match(option.label, /actual.*public/);
  assert(!m.modelOptionsForStage(data, 'attempt').some((entry) => entry.value === 'p::public'));
});

test('optional target relationships cannot break old-server rendering', () => {
  const data = m.parseFlowCapabilities({ ...raw, features: ['resolved-model-options'],
    'model-options': [{ ref: 'p::actual', provider: 'p', model: 'actual', aliases: 'invalid' }] });
  assert.deepEqual(m.modelOptionsForStage(data, 'attempt'), [{ value: 'p::actual', label: 'p · actual' }]);
});

test('resource removal in a fresh summary clears the old sample, not the running policy', () => {
  const previous = { ...summary, policy: raw.policy, resources: { 'heap-object-bytes': 12 } };
  const next = { ...summary, 'policy-revision': 2, observation: { realtime: false, resources: false } };
  const merged = m.mergeSummary(previous, next);
  assert.equal(merged.resources, undefined);
  assert.deepEqual(merged.policy, raw.policy);
  assert.equal(merged['active-attempts'], 1);
});

test('rejected desired policy and effective policy remain distinguishable', () => {
  const failure = { code: 'flow_control_rate_domain_change', rule: 'r', message: 'Retained history', 'rejected-at': '2026-09-06T00:00:00Z' };
  const data = m.parseFlowCapabilities({ ...raw, 'configured-enabled': false, 'configuration-error': true,
    'configured-policy': { enabled: false }, 'configuration-failure': failure });
  assert.equal(data['configured-enabled'], false);
  assert.equal(data.state.policy.enabled, true);
  assert.deepEqual(data['configuration-failure'], failure);
  assert.equal(m.canObserveLive(data), false);
});

test('observation is independent of request admission and V3 supports immediate refusal', () => {
  const values = { ...m.FLOW_DEFAULT_VALUES, flowControlEnabled: true,
    flowControlMaxWaiting: '4', flowControlMaxWaitMs: '0',
    flowControlRulesText: JSON.stringify([{ id: 'g', stage: 'attempt', scope: 'global', 'max-concurrent': 1 }]) };
  assert.deepEqual(m.flowIssues(values), []);
  const data = m.parseFlowCapabilities({ ...raw, policy: { ...raw.policy, enabled: false },
    'events-enabled': true });
  assert.equal(m.canObserveLive(data), true);
});
