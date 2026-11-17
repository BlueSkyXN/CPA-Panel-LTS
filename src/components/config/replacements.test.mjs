import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse, stringify } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { useVisualConfig, getPayloadReplaceValidationError } = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const { literalDraftFromMap, serializeLiteralDraft } = await vite.ssrLoadModule('/src/components/providers/sensitiveReplacementDraft.ts');
test.after(() => vite.close());

function run(source, edit, target = source) {
  let result;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) { assert.equal(config.loadVisualValuesFromYaml(source).ok, true); setPhase(1); }
    else if (phase === 1 && edit) { config.setVisualValues(edit(config.visualValues)); setPhase(2); }
    else {
      let output, error;
      try { output = config.applyVisualChangesToYaml(target); } catch (e) { error = e; }
      result = { values: config.visualValues, dirty: [...config.visualDirtyFields], validation: config.visualValidationErrors, payloadInvalid: config.visualHasPayloadValidationErrors, output, error };
    }
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

for (const provider of ['antigravity', 'devin']) {
  const wordsField = `${provider}SensitiveWordsReplace`;
  const patternsField = `${provider}SensitivePatternsReplace`;
  const initial = stringify({ oauth: { providers: { [provider]: {
    'sensitive-words-replace': { old: '', padded: '  keep  ' },
    'sensitive-patterns-replace': [ { pattern: '(?P<name>secret)', replacement: ' ${name} ', 'future-rule': 7 }, { pattern: '(?i)other', replacement: '' } ],
    'future-option': { keep: true },
  } } } });
  test(`${provider}: round-trips empty replacements, whitespace, RE2 syntax and unmanaged siblings`, () => {
    const loaded = run(initial);
    assert.deepEqual(loaded.dirty, []);
    assert.deepEqual(serializeLiteralDraft(loaded.values[wordsField]), { old: '', padded: '  keep  ' });
    const saved = run('# root-comment\n' + initial, (values) => ({
      [wordsField]: literalDraftFromMap({ replacement: '', padded: '  edited  ' }),
      [patternsField]: [...values[patternsField]].reverse(),
    }));
    assert.equal(saved.error, undefined);
    const actual = parse(saved.output).oauth.providers[provider];
    assert.deepEqual(actual['sensitive-words-replace'], { replacement: '', padded: '  edited  ' });
    assert.deepEqual(actual['sensitive-patterns-replace'], [ { pattern: '(?i)other', replacement: '' }, { pattern: '(?P<name>secret)', replacement: ' ${name} ', 'future-rule': 7 } ]);
    assert.deepEqual(actual['future-option'], { keep: true });
    assert.match(saved.output, /root-comment/);
    assert.deepEqual(run(saved.output).dirty, []);
  });
  test(`${provider}: clearing deletes managed fields only`, () => {
    const saved = run(initial, () => ({ [wordsField]: [], [patternsField]: [] }));
    assert.deepEqual(parse(saved.output).oauth.providers[provider], { 'future-option': { keep: true } });
  });
  test(`${provider}: incomplete and duplicate literal drafts remain dirty and block saving`, () => {
    for (const rows of [[{ id: 'blank', key: '', value: 'unfinished' }], [{ id: 'a', key: 'same', value: '1' }, { id: 'b', key: 'same', value: '2' }]]) {
      const result = run(initial, () => ({ [wordsField]: rows }));
      assert.ok(result.dirty.includes(wordsField));
      assert.deepEqual(result.values[wordsField], rows);
      assert.equal(result.validation[wordsField], 'sensitive_replacements_invalid');
      assert.ok(result.error);
    }
  });
}

const source = `requests:
  payload:
    replace:
      # rule-comment
      - models:
          - name: '*'
            scope: upstream
            auth-kind: apikey
            request-paths: [/v1/responses]
            future-model: keep
        future-rule: keep
        target:
          role: user
          positions: [1, 2]
          future-target: keep
        replacements:
          # first-entry
          - ' a ': ' b '
          # second-entry
          - __proto__: ''
`;

test('replace preserves order, empty strings, whitespace, comments, unknown fields and LTS model restrictions', () => {
  const saved = run(source, ({ payloadReplaceRules: [rule] }) => ({ payloadReplaceRules: [{ ...rule,
    target: { ...rule.target, all: true, positions: '' },
    replacements: [rule.replacements[1], { ...rule.replacements[0], to: '  edited  ' }],
  }] }));
  assert.equal(saved.error, undefined);
  const rule = parse(saved.output).requests.payload.replace[0];
  assert.deepEqual(rule.replacements, [JSON.parse('{"__proto__":""}'), { ' a ': '  edited  ' }]);
  assert.deepEqual(rule.target, { role: 'user', all: true, 'future-target': 'keep' });
  assert.deepEqual(rule.models[0], { name: '*', scope: 'upstream', 'auth-kind': 'apikey', 'request-paths': ['/v1/responses'], 'future-model': 'keep' });
  assert.equal(rule['future-rule'], 'keep');
  assert.ok(saved.output.indexOf('# second-entry') < saved.output.indexOf('# first-entry'));
  assert.equal(run(saved.output).payloadInvalid, false);
});

test('replace field edits serialize LTS auth kind and request paths', () => {
  const saved = run(source, ({ payloadReplaceRules: [rule] }) => ({ payloadReplaceRules: [{ ...rule,
    models: [{ ...rule.models[0], authKind: 'oauth', requestPaths: ['/v1/chat/completions'] }],
  }] }));
  assert.equal(saved.error, undefined);
  assert.equal(parse(saved.output).requests.payload.replace[0].models[0]['auth-kind'], 'oauth');
  assert.deepEqual(parse(saved.output).requests.payload.replace[0].models[0]['request-paths'], ['/v1/chat/completions']);
});

test('clearing replace deletes its section; unrelated visual edits leave it untouched', () => {
  assert.equal(parse(run(source, () => ({ payloadReplaceRules: [] })).output).requests?.payload?.replace, undefined);
  assert.deepEqual(parse(run(source, () => ({ debug: true })).output).requests.payload, parse(source).requests.payload);
});

test('replace uses LTS concurrent section conflict detection', () => {
  const result = run(source, ({ payloadReplaceRules: [rule] }) => ({ payloadReplaceRules: [{ ...rule, replacements: [{ ...rule.replacements[0], to: 'edited' }] }] }), source.replace("' b '", "'external'"));
  assert.equal(result.error?.code, 'visual_payload_conflict');
  assert.ok(run(source, () => ({ debug: true }), source.replace("' b '", "'external'")).output.includes('external'));
});

const malformed = [
  ['non-user target', source.replace('role: user', 'role: assistant')],
  ['missing models', source.replace("name: '*'", 'name: 1')],
  ['numeric operand', source.replace("' a ': ' b '", "123: ' b '")],
  ['boolean operand', source.replace("' a ': ' b '", "true: ' b '")],
  ['numeric replacement', source.replace("' a ': ' b '", "' a ': 1")],
  ['null replacement', source.replace("' a ': ' b '", "' a ': null")],
  ['fractional source integer', source.replace('[1, 2]', '[1.0]')],
  ['quoted position', source.replace('[1, 2]', '["1"]')],
  ['zero position', source.replace('[1, 2]', '[0]')],
  ['negative position', source.replace('[1, 2]', '[-1]')],
  ['all and positions', source.replace('role: user', 'role: user\n          all: true')],
];
for (const [label, yaml] of malformed) test(`replace rejects ${label} before save`, () => {
  const result = run(yaml);
  assert.equal(result.payloadInvalid, true);
  assert.ok(getPayloadReplaceValidationError(result.values.payloadReplaceRules[0]));
  assert.ok(result.error);
});

test('replace aliases cannot be overwritten through a visual edit', () => {
  const yaml = `shared: &rule\n  models: [{name: '*'}]\n  target: {role: user, all: true}\n  replacements: [{old: ''}]\nrequests:\n  payload:\n    replace: [*rule]\n`;
  const saved = run(yaml, ({ payloadReplaceRules: [rule] }) => ({ payloadReplaceRules: [{ ...rule, replacements: [{ ...rule.replacements[0], to: 'edited' }] }] }));
  assert.ok(saved.error);
});
