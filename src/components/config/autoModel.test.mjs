import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useVisualConfig } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
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

test('auto routing edits preserve order, explicit disable and unrelated v8 settings', () => {
  useAuthStore.setState({ supportsAutoModel: true });
  const original = 'config-version: 8\nrouting:\n  strategy: fill-first\n  auto-model:\n    enabled: true\n    candidates: [b, a]\n    future: keep\n';
  const saved = apply(original, (values) => {
    assert.equal(values.autoModelEnabled, true);
    assert.equal(values.autoModelCandidates, 'b\na');
    return { autoModelEnabled: false, autoModelCandidates: 'free\nb' };
  });
  assert.deepEqual(parse(saved).routing, { strategy: 'fill-first', 'auto-model': { enabled: false, candidates: ['free', 'b'], future: 'keep' } });
  assert.deepEqual(parse(apply(saved, () => ({autoModelEnabled: true}))).routing['auto-model'].candidates, ['free','b']);
  const old = 'config-version: 8\nserver: {port: 8317}\n';
  assert.equal(parse(apply(old, (values) => {
    assert.equal(values.autoModelEnabled, false);
    return { port: '8400' };
  })).routing?.['auto-model'], undefined);
  const anchored = 'config-version: 8\nshared: &policy {enabled: true, future: keep}\nrouting: {auto-model: *policy}\n';
  assert.throws(() => apply(anchored, () => ({autoModelEnabled: false})));
  useAuthStore.setState({supportsAutoModel: false});
  assert.throws(() => apply(old, () => ({autoModelEnabled: true})));
});
