import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
test.after(() => vite.close());
const { useVisualConfig } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const { DEFAULT_VISUAL_VALUES } = await vite.ssrLoadModule('/src/types/visualConfig.ts');
const { useCodexPolicyControls } = await vite.ssrLoadModule('/src/lts/codexPolicy/useCodexPolicyControls.tsx');

function editYaml(source, patch, target = source) {
  let result;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) { config.loadVisualValuesFromYaml(source); setPhase(1); }
    else if (phase === 1) { config.setVisualValues(patch); setPhase(2); }
    else { result = { yaml: config.applyVisualChangesToYaml(target), values: config.visualValues }; }
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

for (const mode of ['disabled', 'observe', 'correct']) {
  test(`${mode}: roundtrip preserves siblings and comments`, () => {
    const source = 'upstream:\n  codex:\n    zcode-context-usage: future # retain-comment\n    unknown: preserve\n';
    const result = editYaml(source, { codexZcodeContextUsage: mode });
    assert.equal(parse(result.yaml).upstream?.codex['zcode-context-usage'], mode);
    assert.equal(parse(result.yaml).upstream?.codex.unknown, 'preserve');
    assert.ok(result.yaml.includes('# retain-comment'));
    assert.equal(editYaml(result.yaml, {}).values.codexZcodeContextUsage, mode);
  });
}

test('unrelated edits preserve absent, unknown, invalid and latest values', () => {
  for (const source of ['debug: false\n', 'upstream:\n  codex: {zcode-context-usage: future}\n', 'upstream:\n  codex: {zcode-context-usage: 42}\n']) {
    const result = editYaml(source, { debug: true, codexIdentityConfuse: true });
    assert.equal(parse(result.yaml).upstream?.codex?.['zcode-context-usage'], parse(source).upstream?.codex?.['zcode-context-usage']);
  }
  const initial = 'upstream:\n  codex: {zcode-context-usage: observe}\n';
  assert.equal(parse(editYaml(initial, { debug: true }, initial.replace('observe', 'correct')).yaml).upstream?.codex['zcode-context-usage'], 'correct');
  assert.equal(editYaml('debug: false\n', {}).values.codexZcodeContextUsage, '');
  assert.equal(editYaml('upstream:\n  codex: {zcode-context-usage: 42}\n', {}).values.codexZcodeContextUsage, '__unsupported__');
  assert.throws(() => editYaml(initial, { codexZcodeContextUsage: 'bad-mode' }), error => error.code === 'visual_apply_failed');
});

test('aliased parent cannot be replaced by a visual edit', () => {
  const source = 'base: &policy {zcode-context-usage: observe, keep: true}\nupstream:\n  codex: *policy\n';
  assert.throws(() => editYaml(source, { codexZcodeContextUsage: 'correct' }), error => error.code === 'visual_apply_failed');
});

test('unsupported parent values are preserved; null can become a mapping', () => {
  for (const source of ['upstream:\n  codex: future\n', 'upstream:\n  codex: [future]\n', 'upstream:\n  codex: false\n']) {
    assert.throws(() => editYaml(source, { codexZcodeContextUsage: 'correct' }), error => error.code === 'visual_apply_failed');
  }
  assert.equal(parse(editYaml('upstream:\n  codex: null\n', { codexZcodeContextUsage: 'observe' }).yaml).upstream?.codex['zcode-context-usage'], 'observe');
});

for (const locale of ['zh-CN', 'zh-TW', 'en', 'ru']) {
  test(`${locale}: modes, disabled default, unknown state and extra request are visible`, async () => {
    const catalog = JSON.parse(fs.readFileSync(new URL(`../i18n/${locale}.lts.json`, import.meta.url)));
    const instance = i18next.createInstance();
    await instance.init({ lng: locale, resources: { [locale]: { translation: catalog } } });
    function render(value, disabled = false) {
      function Harness() { return useCodexPolicyControls({ values: { ...DEFAULT_VISUAL_VALUES, codexZcodeContextUsage: value }, disabled, onChange: () => {} }).codexZcodeContextUsage; }
      return renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, createElement(Harness)));
    }
    const html = render('');
    assert.equal((html.match(/type="radio"/g) || []).length, 3);
    assert.equal((html.match(/checked=""/g) || []).length, 1);
    assert.ok(html.includes(catalog.codex_zcode_context_usage.options.disabled.label));
    assert.ok(html.includes(catalog.codex_zcode_context_usage.count_hint));
    assert.ok(!html.includes('codex_zcode_context_usage.'));
    assert.ok(render('future').includes(catalog.codex_zcode_context_usage.unknown_hint));
    assert.ok(!render('future').includes('checked=""'));
    assert.ok(render('correct', true).includes('disabled=""'));
  });
}
