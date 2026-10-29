import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useVisualConfig } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
beforeEach(() => useAuthStore.setState({ supportsReasoningEffortPolicy: true }));
const { validReasoningEffortRules, parseReasoningEffortRules } = await vite.ssrLoadModule('/src/components/config/reasoningEffort.ts');
test.after(() => vite.close());

function apply(source, edit, target = source) {
  let output;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) {
      const loaded = config.loadVisualValuesFromYaml(source);
      assert.equal(loaded.ok, true);
      setPhase(1);
    } else if (phase === 1) {
      config.setVisualValues(edit(config.visualValues));
      setPhase(2);
    } else output = config.applyVisualChangesToYaml(target);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return output;
}

const source = `config-version: 8
server: {port: 8317}
requests:
  proxy-url: direct
  reasoning-effort:
    # 保留策略说明
    - models: [glm-5.3]
      mode: force
      effort: high
      future-setting: keep
  payload:
    override: [{models: [{name: another-model}], params: {temperature: 0.2}}]
plugins:
  configs:
    sample: {opaque: keep}
`;

test('round-trip policy changes keep v8 layout, comments, unknown fields and unrelated config', () => {
  const output = apply(source, (values) => ({ reasoningEffortRules: values.reasoningEffortRules.map((rule) => ({ ...rule, effort: 'max' })) }));
  const got = parse(output);
  assert.equal(got.requests['reasoning-effort'][0].effort, 'max');
  assert.equal(got.requests['reasoning-effort'][0]['future-setting'], 'keep');
  assert.equal(got['reasoning-effort'], undefined);
  assert.equal(got.requests['proxy-url'], 'direct');
  assert.deepEqual(got.requests.payload, parse(source).requests.payload);
  assert.deepEqual(got.plugins, parse(source).plugins);
  assert.match(output, /保留策略说明/);
});

test('editing an unrelated field does not rewrite reasoning rules', () => {
  const output = apply(source, () => ({ port: '8319' }));
  assert.deepEqual(parse(output).requests['reasoning-effort'], parse(source).requests['reasoning-effort']);
  assert.match(output, /保留策略说明/);
});

test('follow removes its unused effort and deleting all policies keeps other requests settings', () => {
  const follow = apply(source, (values) => ({ reasoningEffortRules: values.reasoningEffortRules.map((rule) => ({ ...rule, mode: 'follow', effort: '' })) }));
  assert.equal(parse(follow).requests['reasoning-effort'][0].effort, undefined);
  const removed = apply(source, () => ({ reasoningEffortRules: [] }));
  assert.equal(parse(removed).requests['reasoning-effort'], undefined);
  assert.deepEqual(parse(removed).requests.payload, parse(source).requests.payload);
});

test('a changed source rule cannot be overwritten or removed from a stale visual baseline', () => {
  const changed = source.replace('effort: high', 'effort: low');
  assert.throws(() => apply(source, (values) => ({ reasoningEffortRules: values.reasoningEffortRules.map((rule) => ({ ...rule, effort: 'max' })) }), changed));
  assert.throws(() => apply(source, () => ({ reasoningEffortRules: [] }), changed));
});

test('malformed lists are not silently parsed as empty and invalid rule edits are rejected', () => {
  assert.throws(() => parseReasoningEffortRules({ mode: 'force' }));
  assert.throws(() => parseReasoningEffortRules([{ models: [123], mode: 'force', effort: 'max' }]));
  for (const rule of [{ models: [], mode: 'force', effort: 'max' }, { models: ['glm-*'], mode: 'follow', effort: 'max' }, { models: ['glm-*'], mode: 'force', effort: 'invalid' }]) {
    assert.equal(validReasoningEffortRules([{ id: 'fixture', ...rule }]), false);
  }
});


test('visual policy writes are refused when Core capability disappears', () => {
  useAuthStore.setState({ supportsReasoningEffortPolicy: false });
  assert.throws(() => apply(source, (values) => ({ reasoningEffortRules: values.reasoningEffortRules.map((rule) => ({ ...rule, effort: 'max' })) })));
  const unrelated = apply(source, () => ({ port: '8319' }));
  assert.deepEqual(parse(unrelated).requests['reasoning-effort'], parse(source).requests['reasoning-effort']);
});
