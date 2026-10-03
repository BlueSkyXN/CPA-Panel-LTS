import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useVisualConfig } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const { projectConfigForVisual, usesV8ConfigLayout } = await vite.ssrLoadModule('/src/utils/configLayout.ts');
test.after(() => vite.close());

function apply(source, edit) {
  let output;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) { assert.equal(config.loadVisualValuesFromYaml(source).ok, true); setPhase(1); }
    else if (phase === 1) { config.setVisualValues(edit(config.visualValues)); setPhase(2); }
    else output = config.applyVisualChangesToYaml(source);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return output;
}

const grouped = `config-version: 8
server: {port: 8317, commercial-mode: false}
access: {api-keys: [synthetic-client]}
api-keys:
  codex:
    - name: preserved
      base-url: https://example.invalid
      keys: [{api-key: synthetic-provider}]
      future-group: {value: keep}
upstream:
  codex:
    client-metadata: {mode: strict, workspace-policy: drop}
    cache-affinity: {strategy: client-aware}
requests:
  payload:
    # keep-rule
    override: [{models: [{name: m}], params: {temperature: 1}, future: keep}]
future-root: keep
`;

test('client keys add/change/clear never replaces provider groups', () => {
  for (const keys of ['new-client', 'first\nsecond', '']) {
    const result = parse(apply(grouped, () => ({ apiKeysText: keys })));
    assert.deepEqual(result['api-keys'], parse(grouped)['api-keys']);
    assert.deepEqual(result.access?.['api-keys'] ?? [], keys ? keys.split('\n') : []);
    assert.equal(result['future-root'], 'keep');
    assert.equal(result.upstream.codex['client-metadata'].mode, 'strict');
  }
});

test('visual read and write uses canonical values, including false and zero', () => {
  const mixed = grouped + 'port: 9999\ncommercial-mode: true\nrequest-retry: 5\nrouting: {retry: {request-retry: 0}}\n';
  const result = parse(apply(mixed, (values) => {
    assert.equal(values.port, '8317');
    assert.equal(values.commercialMode, false);
    assert.equal(values.requestRetry, '0');
    return { port: '8318', requestRetry: '2', codexCacheAffinityStrategy: 'stable-id' };
  }));
  assert.equal(result.server.port, 8318);
  assert.equal(result.routing.retry['request-retry'], 2);
  assert.equal(result.upstream.codex['cache-affinity'].strategy, 'stable-id');
  assert.equal(result.port, undefined);
  assert.equal(result['request-retry'], undefined);
  assert.deepEqual(result['api-keys'], parse(grouped)['api-keys']);
});

test('v8 payload edits preserve AST comments and unknown fields', () => {
  const output = apply(grouped, (values) => ({ payloadOverrideRules: values.payloadOverrideRules.map((rule) => ({ ...rule, params: rule.params.map((param) => ({ ...param, value: '2' })) })) }));
  assert.ok(output.includes('keep-rule'));
  assert.equal(parse(output).requests.payload.override[0].future, 'keep');
  assert.equal(parse(output).requests.payload.override[0].params.temperature, 2);
  assert.equal(parse(output).payload, undefined);
});

test('invalid root and invalid client-key shape are not empty configurations', () => {
  assert.throws(() => projectConfigForVisual('[]'));
  assert.throws(() => usesV8ConfigLayout('not-a-config'));
});

test('legacy configuration remains legacy after ordinary edits', () => {
  const result = parse(apply('port: 8317\napi-keys: [old]\n', () => ({ port: '8318', apiKeysText: 'new' })));
  assert.equal(result.port, 8318);
  assert.deepEqual(result['api-keys'], ['new']);
  assert.equal(result.server, undefined);
});

test('partial v8 structs preserve legacy sibling values but explicit empty resets them', () => {
 const raw = 'codex: {client-metadata: {mode: strict, workspace-policy: drop}}\nupstream: {codex: {client-metadata: {mode: repair}}}\n';
 const view = projectConfigForVisual(raw).toJS();
 assert.equal(view.codex['client-metadata'].mode, 'repair');
 assert.equal(view.codex['client-metadata']['workspace-policy'], 'drop');
 assert.deepEqual(projectConfigForVisual(raw.replace('{mode: repair}', '{}')).toJS().codex['client-metadata'], {});
 assert.throws(() => projectConfigForVisual('access: {api-keys: {bad: true}}\n'));
});
