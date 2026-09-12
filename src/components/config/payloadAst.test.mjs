import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useVisualConfig } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
test.after(() => vite.close());

function apply(source, edit, target = source) {
  let output;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) { config.loadVisualValuesFromYaml(source); setPhase(1); }
    else if (phase === 1) { config.setVisualValues(edit(config.visualValues)); setPhase(2); }
    else output = config.applyVisualChangesToYaml(target);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return output;
}

for (const [section, field, raw] of [
  ['default', 'payloadDefaultRules', false], ['override', 'payloadOverrideRules', false],
  ['default-raw', 'payloadDefaultRawRules', true], ['override-raw', 'payloadOverrideRawRules', true],
]) {
  test(`${section}: deletion/reordering keeps the right unknown fields, comments and LTS scope`, () => {
    const source = `payload:
  ${section}:
    # deleted-rule
    - models: [{name: delete-me}]
      params: {obsolete: 0}
      future-rule: deleted
    # kept-rule
    - models:
        # kept-model
        - name: keep-me
          scope: upstream
          future-model: preserve
      params:
        # deleted-param
        obsolete: ${raw ? "'0'" : '0'}
        # kept-param
        temperature: ${raw ? "'1'" : '1'}
      future-rule: preserve
`;
    const edit = (values) => {
      const rule = values[field][1];
      return { [field]: [{ ...rule, models: [{ ...rule.models[0], name: 'renamed', scope: 'requested' }],
        params: [{ ...rule.params[1], value: '2', valueType: raw ? 'json' : 'number' }] }] };
    };
    const output = apply(source, edit, source + 'future-root: preserve\n');
    const parsed = parse(output);
    assert.equal(parsed['future-root'], 'preserve');
    assert.equal(parsed.payload[section].length, 1);
    const rule = parsed.payload[section][0];
    assert.deepEqual(rule.models, [{ name: 'renamed', scope: 'requested', 'future-model': 'preserve' }]);
    assert.equal(rule['future-rule'], 'preserve');
    assert.deepEqual(rule.params, { temperature: raw ? '2' : 2 });
    for (const comment of ['kept-rule', 'kept-model', 'kept-param']) assert.ok(output.includes(comment));
    for (const comment of ['deleted-rule', 'deleted-param']) assert.ok(!output.includes(comment));
  });
}

test('filter sequence reorder keeps per-item comments and unknown model/rule fields', () => {
  const source = `payload:
  filter:
    - models:
        - name: keep
          future-model: true
      params:
        # first-comment
        - first.path
        # second-comment
        - second.path
      future-rule: true
`;
  const output = apply(source, (v) => ({ payloadFilterRules: [{ ...v.payloadFilterRules[0], params: ['second.path', 'new.path'] }] }));
  const rule = parse(output).payload.filter[0];
  assert.equal(rule['future-rule'], true);
  assert.equal(rule.models[0]['future-model'], true);
  assert.deepEqual(rule.params, ['second.path', 'new.path']);
  assert.ok(output.includes('second-comment'));
  assert.ok(!output.includes('first-comment'));
});

test('unrelated visual changes do not rewrite payload or remove anchors', () => {
  const source = 'debug: false\npayload:\n  default:\n    - models: [{name: model}]\n      params:\n        limit: &limit 2 # preserve\n        other: *limit\n';
  const output = apply(source, () => ({ debug: true }));
  assert.ok(output.includes('&limit'));
  assert.ok(output.includes('*limit'));
  assert.deepEqual(parse(output).payload, parse(source).payload);
});
