import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse, parseDocument } from 'yaml';
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

const payloadSections = [
  ['default', 'payloadDefaultRules'], ['default-raw', 'payloadDefaultRawRules'],
  ['override', 'payloadOverrideRules'], ['override-raw', 'payloadOverrideRawRules'],
  ['filter', 'payloadFilterRules'],
];
const conflict = error => error.code === 'visual_payload_conflict';
const transformFailure = error => error.code === 'visual_apply_failed';
const renameFirst = field => values => ({ [field]: values[field].map((rule, index) => index ? rule : {
  ...rule, models: rule.models.map((model, i) => i ? model : { ...model, name: 'edited-a' }),
}) });

for (const [section, field] of payloadSections) {
  const params = section === 'filter' ? '[remove.path]' : '{temperature: 1}';
  const a = `    - models: [{name: model-a}]\n      params: ${params}\n      extension: belongs-to-a\n`;
  const b = `    - models: [{name: model-b}]\n      params: ${params}\n      extension: belongs-to-b\n`;
  const head = `payload:\n  ${section}:\n`;
  const source = head + a + b;
  test(`${section}: server reorder/insert/delete blocks positional merging`, () => {
    for (const target of [head + b + a, source + a.replace('model-a', 'new-rule'), head + b, 'payload: {}\n']) {
      assert.throws(() => apply(source, renameFirst(field), target), conflict);
    }
  });
  test(`${section}: server model/condition/unknown-field changes are conflicts too`, () => {
    for (const target of [
      source.replace('models: [{name: model-a}]', 'models: [{name: model-b}, {name: model-a}]'),
      source.replace('models: [{name: model-a}]', 'models: [{name: model-a, match: [{a: 1}, {b: 2}], not-match: [{c: 3}]}]'),
      source.replace('belongs-to-a', 'server-update'),
    ]) assert.throws(() => apply(source, renameFirst(field), target), conflict);
  });
}

test('nested condition reorder is detected even when outer rule/model order is unchanged', () => {
  for (const key of ['match', 'not-match']) {
    const source = `payload:\n  default:\n    - models: [{name: model-a, ${key}: [{first: 1}, {second: 2}]}]\n      params: {temperature: 1}\n`;
    const target = source.replace('[{first: 1}, {second: 2}]', '[{second: 2}, {first: 1}]');
    assert.throws(() => apply(source, renameFirst('payloadDefaultRules'), target), conflict);
  }
});

test('only dirty sections conflict; unrelated server changes and repeated preview remain valid', () => {
  const source = 'debug: false\npayload:\n  default:\n    - models: [{name: model-a}]\n      params: {temperature: 1}\n';
  const target = source.replace('debug: false', 'debug: true') + '  override:\n    - models: [{name: server-rule}]\n      params: {other: 3}\n';
  const first = apply(source, renameFirst('payloadDefaultRules'), target);
  assert.equal(parse(first).payload.override[0].models[0].name, 'server-rule');
  assert.equal(parse(first).debug, true);
  assert.equal(first, apply(source, renameFirst('payloadDefaultRules'), target));
  assert.doesNotThrow(() => apply(source, () => ({ debug: true }), target));
});

const anchoredPayload = `payload:
  default:
    - models: [{name: model-a}]
      params:
        options: &options
          # nested-comment
          limit: 1
        temperature: 1
  override:
    - models: [{name: model-b}]
      params:
        options: *options
`;
const changeTemperature = values => ({ payloadDefaultRules: values.payloadDefaultRules.map(rule => ({
  ...rule, params: rule.params.map(param => param.path === 'temperature' ? { ...param, value: '2' } : param),
})) });

test('editing a sibling parameter retains cross-rule anchors, aliases and nested comments', () => {
  const output = apply(anchoredPayload, changeTemperature);
  assert.equal(parse(output).payload.default[0].params.temperature, 2);
  assert.match(output, /&options/);
  assert.match(output, /\*options/);
  assert.match(output, /nested-comment/);
  assert.deepEqual(parse(output).payload.override[0].params.options, { limit: 1 });
});

test('changing an anchored object retains its anchor and updates untouched aliases', () => {
  const output = apply(anchoredPayload, values => ({ payloadDefaultRules: values.payloadDefaultRules.map(rule => ({
    ...rule, params: rule.params.map(param => param.path === 'options' ? { ...param, value: '{"limit":2}' } : param),
  })) }));
  assert.match(output, /&options/);
  assert.match(output, /\*options/);
  assert.deepEqual(parse(output).payload.override[0].params.options, { limit: 2 });
});

test('deleting a referenced anchor reports conversion failure instead of returning unchanged YAML', () => {
  assert.throws(() => apply(anchoredPayload, values => ({ payloadDefaultRules: values.payloadDefaultRules.map(rule => ({
    ...rule, params: rule.params.filter(param => param.path !== 'options'),
  })) })), transformFailure);
});

test('changes to an externally defined anchor used by the edited section count as a conflict', () => {
  const source = 'shared: &options {limit: 1}\n' + anchoredPayload.replace('options: &options\n          # nested-comment\n          limit: 1', 'options: *options');
  assert.throws(() => apply(source, changeTemperature, source.replace('limit: 1', 'limit: 2')), conflict);
});

test('invalid target YAML is a failure and cannot masquerade as a no-op', () => {
  assert.throws(() => apply(anchoredPayload, changeTemperature, 'payload: ['), transformFailure);
});

test('formatting-only changes outside the edited subtree do not cause a conflict', () => {
  const target = '# another editor\n' + parseDocument(anchoredPayload).toString();
  const output = apply(anchoredPayload, changeTemperature, target);
  assert.equal(parse(output).payload.default[0].params.temperature, 2);
});

test('structural aliases fail explicitly rather than dropping fields while expanding them', () => {
  const cases = [
    'template: &rules [{models: [{name: model-a}], params: {temperature: 1}, future: keep}]\npayload:\n  default: *rules\n',
    'template: &model {name: model-a, future: keep}\npayload:\n  default:\n    - models: [*model]\n      params: {temperature: 1}\n',
  ];
  for (const source of cases) assert.throws(() => apply(source, renameFirst('payloadDefaultRules')), transformFailure);
});
