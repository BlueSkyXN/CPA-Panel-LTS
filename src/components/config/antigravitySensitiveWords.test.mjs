import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useVisualConfig } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
test.after(() => vite.close());

function apply(source, patch) {
  let result;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) {
      config.loadVisualValuesFromYaml(source);
      setPhase(1);
    } else if (phase === 1 && patch) {
      config.setVisualValues(patch);
      setPhase(2);
    } else {
      result = {
        words: config.visualValues.antigravitySensitiveWords,
        dirty: config.visualDirty,
        yaml: config.applyVisualChangesToYaml(source),
      };
    }
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

test('loads Antigravity words without dirtying the config', () => {
  const result = apply('antigravity:\n  sensitive-words: [word-a, word-b]\n');
  assert.deepEqual(result.words, ['word-a', 'word-b']);
  assert.equal(result.dirty, false);
});

test('word edits trim blanks and retain unknown YAML, comments and signature flags', () => {
  const result = apply('# keep-comment\nantigravity:\n  sensitive-words: [old]\n  future-option: true\nantigravity-signature-cache-enabled: false\n', {
    antigravitySensitiveWords: [' word-a ', '', 'word-b'],
  });
  assert.equal(result.dirty, true);
  assert.deepEqual(parse(result.yaml), {
    antigravity: { 'sensitive-words': ['word-a', 'word-b'], 'future-option': true },
    'antigravity-signature-cache-enabled': false,
  });
  assert.match(result.yaml, /# keep-comment/);
});

test('clearing words removes only the managed list and empty parent', () => {
  for (const extra of ['', '  future-option: true\n']) {
    const result = apply(`debug: true\nantigravity:\n  sensitive-words: [old]\n${extra}`, { antigravitySensitiveWords: [] });
    assert.deepEqual(parse(result.yaml), extra ? { debug: true, antigravity: { 'future-option': true } } : { debug: true });
  }
});

test('equal lists stay clean and unrelated changes preserve unmanaged words', () => {
  const source = 'debug: false\nantigravity:\n  sensitive-words: [word-a]\n';
  assert.equal(apply(source, { antigravitySensitiveWords: ['word-a'] }).dirty, false);
  assert.deepEqual(parse(apply(source, { debug: true }).yaml).antigravity, { 'sensitive-words': ['word-a'] });
});
