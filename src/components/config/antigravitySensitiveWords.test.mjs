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

const ag = (body) => `oauth:\n  providers:\n    antigravity:\n${body}`;

test('loads Antigravity words without dirtying the config', () => {
  const result = apply(ag('      sensitive-words: [word-a, word-b]\n'));
  assert.deepEqual(result.words, ['word-a', 'word-b']);
  assert.equal(result.dirty, false);
});

test('word edits trim blanks and retain unknown YAML, comments and signature flags', () => {
  const result = apply(
    '# keep-comment\n' +
      ag('      sensitive-words: [old]\n      future-option: true\n      signature-cache-enabled: false\n'),
    { antigravitySensitiveWords: [' word-a ', '', 'word-b'] }
  );
  assert.equal(result.dirty, true);
  assert.deepEqual(parse(result.yaml), {
    oauth: {
      providers: {
        antigravity: {
          'sensitive-words': ['word-a', 'word-b'],
          'future-option': true,
          'signature-cache-enabled': false,
        },
      },
    },
  });
  assert.match(result.yaml, /# keep-comment/);
});

test('clearing words removes only the managed list', () => {
  for (const extra of ['', '      future-option: true\n']) {
    const result = apply(
      'observability: {logs: {debug: true}}\n' + ag(`      sensitive-words: [old]\n${extra}`),
      { antigravitySensitiveWords: [] }
    );
    const output = parse(result.yaml);
    assert.equal(output.observability.logs.debug, true);
    assert.equal(output.oauth?.providers?.antigravity?.['sensitive-words'], undefined);
    if (extra) assert.equal(output.oauth.providers.antigravity['future-option'], true);
  }
});

test('equal lists stay clean and unrelated changes preserve unmanaged words', () => {
  const source = 'observability: {logs: {debug: false}}\n' + ag('      sensitive-words: [word-a]\n');
  assert.equal(apply(source, { antigravitySensitiveWords: ['word-a'] }).dirty, false);
  assert.deepEqual(parse(apply(source, { debug: true }).yaml).oauth.providers.antigravity, {
    'sensitive-words': ['word-a'],
  });
});

test('visual edits preserve unknown nested Core config under the same parent', () => {
  const source = ag(
    [
      '      connection-pool:',
      '        enabled: true',
      '        idle-conn-timeout: 30s',
      '        max-idle-conns-per-host: 2',
      '      sensitive-words: [word-a]',
      '',
    ].join('\n')
  );
  const result = apply(source, { antigravitySensitiveWords: ['word-b'] });
  assert.deepEqual(parse(result.yaml).oauth.providers.antigravity, {
    'connection-pool': {
      enabled: true,
      'idle-conn-timeout': '30s',
      'max-idle-conns-per-host': 2,
    },
    'sensitive-words': ['word-b'],
  });
});
