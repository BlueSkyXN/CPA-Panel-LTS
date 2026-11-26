import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { parse, stringify } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const {
  useVisualConfig,
  VisualConfigApplyError,
  getPayloadReplaceValidationError,
  getPayloadRequestPathsValidationError,
} = await vite.ssrLoadModule('/src/hooks/useVisualConfig.ts');
const { getConfigIssueFields } = await vite.ssrLoadModule('/src/components/config/configIssues.ts');
const { PayloadModelsEditor } = await vite.ssrLoadModule('/src/components/config/PayloadModelsEditor.tsx');
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
  const duplicatePatterns = `oauth:
  providers:
    ${provider}:
      sensitive-patterns-replace:
        # first-rule
        - pattern: same
          replacement: ''
          future-rule: first
        # second-rule
        - pattern: same
          replacement: ''
          future-rule: second
`;
  test(`${provider}: renaming and moving duplicate patterns preserves each original YAML node`, () => {
    const saved = run(duplicatePatterns, (values) => ({ [patternsField]: [
      { ...values[patternsField][1], pattern: 'renamed-second' },
      { pattern: 'same', replacement: 'new' },
      { ...values[patternsField][0], pattern: 'renamed-first' },
    ] }));
    assert.equal(saved.error, undefined);
    assert.deepEqual(parse(saved.output).oauth.providers[provider]['sensitive-patterns-replace'], [
      { pattern: 'renamed-second', replacement: '', 'future-rule': 'second' },
      { pattern: 'same', replacement: 'new' },
      { pattern: 'renamed-first', replacement: '', 'future-rule': 'first' },
    ]);
    assert.match(saved.output, /# first-rule/);
    assert.match(saved.output, /# second-rule/);
    assert.ok(saved.output.indexOf('# second-rule') < saved.output.indexOf('# first-rule'));
    assert.deepEqual(run(saved.output).dirty, []);
  });
  test(`${provider}: moving identical patterns retains their distinct unmanaged fields`, () => {
    const saved = run(duplicatePatterns, (values) => ({ [patternsField]: [...values[patternsField]].reverse() }));
    assert.equal(saved.error, undefined);
    assert.ok(saved.dirty.includes(patternsField));
    assert.deepEqual(parse(saved.output).oauth.providers[provider]['sensitive-patterns-replace'].map((rule) => rule['future-rule']), ['second', 'first']);
  });
  test(`${provider}: deleting a duplicate and renaming its sibling preserves the remaining node`, () => {
    const saved = run(duplicatePatterns, (values) => ({ [patternsField]: [{ ...values[patternsField][1], pattern: 'remaining' }] }));
    assert.equal(saved.error, undefined);
    assert.deepEqual(parse(saved.output).oauth.providers[provider]['sensitive-patterns-replace'], [
      { pattern: 'remaining', replacement: '', 'future-rule': 'second' },
    ]);
    assert.match(saved.output, /# second-rule/);
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
for (const [label, yaml] of malformed) test(`replace rejects ${label} only when dirty`, () => {
  const untouched = run(yaml, () => ({ port: '8318' }));
  assert.equal(untouched.payloadInvalid, false);
  assert.equal(untouched.error, undefined);
  assert.ok(getPayloadReplaceValidationError(untouched.values.payloadReplaceRules[0]));
  assert.deepEqual(parse(untouched.output).requests, parse(yaml).requests);

  const dirty = run(yaml, ({ payloadReplaceRules: [rule] }) => ({
    payloadReplaceRules: [{ ...rule, models: [{ ...rule.models[0], name: 'edited' }] }],
  }));
  assert.equal(dirty.payloadInvalid, true);
  assert.ok(getPayloadReplaceValidationError(dirty.values.payloadReplaceRules[0]));
  assert.ok(dirty.error);
});

test('replace aliases cannot be overwritten through a visual edit', () => {
  const yaml = `shared: &rule\n  models: [{name: '*'}]\n  target: {role: user, all: true}\n  replacements: [{old: ''}]\nrequests:\n  payload:\n    replace: [*rule]\n`;
  const saved = run(yaml, ({ payloadReplaceRules: [rule] }) => ({ payloadReplaceRules: [{ ...rule, replacements: [{ ...rule.replacements[0], to: 'edited' }] }] }));
  assert.ok(saved.error);
});

test('advanced targets and regex survive an unrelated edit and switching back to literal', () => {
  const yaml = source.replace('role: user\n          positions: [1, 2]', 'paths: [metadata.description]')
    .replace(" - ' a ': ' b '", " - {pattern: '(?i)old', replacement: '$1'}");
  const saved = run(yaml, () => ({ port: '8318' }));
  assert.equal(saved.error, undefined);
  assert.deepEqual(parse(saved.output).requests, parse(yaml).requests);
  assert.match(saved.output, /first-entry/);
  for (const role of ['developer', 'system']) {
    const changed = run(saved.output, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [{ ...rule, target: { role, all: true, positions: '' },
        replacements: [{ ...rule.replacements[0], regex: false, from: 'literal', to: '' }] }],
    }));
    assert.equal(changed.error, undefined);
    const result = parse(changed.output).requests.payload.replace[0];
    assert.deepEqual(result.target, { role, all: true, 'future-target': 'keep' });
    assert.deepEqual(result.replacements, [{ literal: '' }]);
  }
});

test('editing paths preserves aliases, comments and LTS model restrictions', () => {
  const yaml = "path: &field metadata.description\n" + source.replace(
    'role: user\n          positions: [1, 2]',
    'paths:\n            # keep-path\n            - *field'
  );
  const result = run(yaml, ({ payloadReplaceRules: [rule] }) => ({
    payloadReplaceRules: [{ ...rule, target: { ...rule.target, paths: [...rule.target.paths, 'metadata.title'] } }],
  }));
  assert.equal(result.error, undefined);
  const rule = parse(result.output).requests.payload.replace[0];
  assert.deepEqual(rule.target.paths, ['metadata.description', 'metadata.title']);
  assert.deepEqual(rule.models, parse(yaml).requests.payload.replace[0].models);
  assert.match(result.output, /keep-path/);
  assert.match(result.output, /- \*field/);
});

test('serializeLiteralDraft trims keys, preserves value whitespace, and rejects blank or trimmed-duplicate keys', () => {
  assert.deepEqual(
    serializeLiteralDraft([
      { id: '1', key: '  foo  ', value: '  keep  ' },
      { id: '2', key: 'bar', value: '' },
    ]),
    { foo: '  keep  ', bar: '' }
  );
  assert.equal(serializeLiteralDraft([{ id: '1', key: '   ', value: 'x' }]), null);
  assert.equal(
    serializeLiteralDraft([
      { id: '1', key: 'foo', value: '1' },
      { id: '2', key: ' foo ', value: '2' },
    ]),
    null
  );
});

test('dirtyFields gates sensitive replacement validation without blocking unrelated edits', () => {
  const dirtyPatterns = run(
    'oauth: {providers: {antigravity: {sensitive-words-replace: {"   ": x}, sensitive-patterns-replace: [{pattern: "   ", replacement: ""}]}}}\n',
    () => ({ port: '8318' })
  );
  assert.equal(dirtyPatterns.error, undefined);
  assert.deepEqual(dirtyPatterns.validation.antigravitySensitivePatternsReplace, undefined);
  assert.deepEqual(dirtyPatterns.validation.antigravitySensitiveWordsReplace, undefined);

  const editedBlankPattern = run(
    'oauth: {providers: {antigravity: {sensitive-patterns-replace: [{pattern: "ok", replacement: ""}]}}}\n',
    () => ({ antigravitySensitivePatternsReplace: [{ pattern: '   ', replacement: 'x' }] })
  );
  assert.equal(editedBlankPattern.validation.antigravitySensitivePatternsReplace, 'sensitive_replacements_invalid');
  assert.ok(editedBlankPattern.error);

  const editedBlankLiteral = run(
    'oauth: {providers: {devin: {sensitive-words-replace: {ok: ""}}}}\n',
    () => ({ devinSensitiveWordsReplace: [{ id: '1', key: '   ', value: 'x' }] })
  );
  assert.equal(editedBlankLiteral.validation.devinSensitiveWordsReplace, 'sensitive_replacements_invalid');
  assert.ok(editedBlankLiteral.error);
});

test('parsePayloadReplaceRules accepts scalar aliases and explicit null optional fields', () => {
  const yaml = `defs:
  lk: &lk secret
  lv: &lv "  masked  "
  kp: &kp pattern
  kr: &kr replacement
  vp: &vp "(?i)token"
  vr: &vr "[redacted]"
  role: &role user
requests:
  payload:
    replace:
      - models:
          - name: '*'
            protocol: null
            from-protocol: null
            scope: null
            auth-kind: null
            match: null
            not-match: null
            exist: null
            not-exist: null
            request-paths: null
            headers: null
        target:
          role: *role
          all: null
          positions: [1]
          paths: null
        replacements:
          - *lk : *lv
          - *kp : *vp
            *kr : *vr
`;
  const loaded = run(yaml);
  assert.equal(loaded.payloadInvalid, false);
  assert.equal(loaded.values.payloadReplaceRules[0].invalid, undefined);
  assert.equal(getPayloadReplaceValidationError(loaded.values.payloadReplaceRules[0]), undefined);
  assert.deepEqual(
    loaded.values.payloadReplaceRules[0].replacements.map(({ from, to, regex }) => ({ from, to, regex })),
    [
      { from: 'secret', to: '  masked  ', regex: undefined },
      { from: '(?i)token', to: '[redacted]', regex: true },
    ]
  );
});

test('syncPayloadReplaceSequence updates in-place preserving comments, anchors, flow style, and aliases', () => {
  const yaml = `defs:
  lk: &lk lit-key
  lv: &lv lit-val
  kp: &kp pattern
  kr: &kr replacement
  vp: &vp "(?i)pat"
  vr: &vr rep-val
  role: &role user
requests:
  payload:
    replace:
      - models: [{name: '*'}]
        target:
          role: *role
          positions: [1]
        replacements:
          - # lit-key-comment
            lit: &litVal v1 # lit-val-comment
          - *lk : *lv
          - *kp : *vp
            *kr : *vr
          - {pattern: &patAnchor "(?i)old", replacement: &repAnchor "$1"}
`;
  const converted = run(yaml, ({ payloadReplaceRules: [rule] }) => ({
    payloadReplaceRules: [
      {
        ...rule,
        replacements: [
          { ...rule.replacements[0], regex: true, from: '(?i)lit', to: 'v2' },
          { ...rule.replacements[1], to: 'lit-edited' },
          { ...rule.replacements[2], to: 'rep-edited' },
          { ...rule.replacements[3], regex: false, from: 'back-to-lit', to: '$2' },
        ],
      },
    ],
  }));
  assert.equal(converted.error, undefined);
  assert.match(converted.output, /# lit-key-comment/);
  assert.match(converted.output, /# lit-val-comment/);
  assert.match(converted.output, /&litVal/);
  assert.match(converted.output, /\*role/);
  assert.match(converted.output, /\*lk\b[\s\S]*lit-edited/);
  assert.match(converted.output, /\*kp\b[\s\S]*\*vp/);
  assert.match(converted.output, /\*kr\b[\s\S]*rep-edited/);
  assert.match(converted.output, /\{\s*&patAnchor "back-to-lit": &repAnchor "\$2"\s*\}/);
  const parsedReplacements = parse(converted.output).requests.payload.replace[0].replacements;
  assert.deepEqual(parsedReplacements, [
    { pattern: '(?i)lit', replacement: 'v2' },
    { 'lit-key': 'lit-edited' },
    { pattern: '(?i)pat', replacement: 'rep-edited' },
    { 'back-to-lit': '$2' },
  ]);
  for (const item of parsedReplacements) {
    assert.ok(Object.keys(item).length === 1 || Object.keys(item).length === 2);
  }
});

test('changing replacement mode keeps the source and destination anchors bound to their operands', () => {
  for (const [source, regex, expected] of [
    ['{&word alpha: &result beta}', true, { pattern: 'alpha', replacement: 'beta' }],
    ['{pattern: &word alpha, replacement: &result beta}', undefined, { alpha: 'beta' }],
  ]) {
    const yaml = `requests:
  payload:
    replace:
      - models: [{name: '*'}]
        target: {role: user, all: true}
        replacements:
          - ${source}
          - *word : *result
`;
    const saved = run(yaml, ({ payloadReplaceRules: [rule] }) => ({
      payloadReplaceRules: [{
        ...rule,
        replacements: [{ ...rule.replacements[0], regex }, rule.replacements[1]],
      }],
    }));
    assert.equal(saved.error, undefined);
    assert.deepEqual(parse(saved.output).requests.payload.replace[0].replacements, [
      expected, { alpha: 'beta' },
    ]);
    assert.match(saved.output, /\*word\b/);
    assert.match(saved.output, /\*result\b/);
  }
});

test('syncPayloadReplaceSequence clears non-str Scalar tags when repairing malformed tagged maps', () => {
  const yaml = `requests:
  payload:
    replace:
      - models: [{name: '*'}]
        target: {role: user, all: true}
        replacements:
          - !!int 1: !!int 2
`;
  const repaired = run(yaml, ({ payloadReplaceRules: [rule] }) => ({
    payloadReplaceRules: [
      {
        ...rule,
        invalid: undefined,
        replacements: [{ ...rule.replacements[0], regex: true, from: 'a', to: 'b' }],
      },
    ],
  }));
  assert.equal(repaired.error, undefined);
  assert.doesNotMatch(repaired.output, /!!int/);
  assert.doesNotMatch(repaired.output, /\.nan/);
  assert.deepEqual(parse(repaired.output).requests.payload.replace[0].replacements, [
    { pattern: 'a', replacement: 'b' },
  ]);
});

test('P1-07 request-paths rejects all-whitespace and invalid paths, trims valid lines, and deletes only when undefined', () => {
  assert.equal(getPayloadRequestPathsValidationError(undefined), undefined);
  assert.equal(getPayloadRequestPathsValidationError([]), 'payload_invalid_request_paths');
  assert.equal(getPayloadRequestPathsValidationError(['   ']), 'payload_invalid_request_paths');
  assert.equal(getPayloadRequestPathsValidationError(['', '  ']), 'payload_invalid_request_paths');
  for (const bad of ['v1/responses', '//v1/responses', '/v1//responses', '/v1/responses/', '/v1/./responses', '/v1/*', '/v1/a?x=1', '/v1/a#h', '/v1/%20', '/v1/a b']) {
    assert.equal(getPayloadRequestPathsValidationError([bad]), 'payload_invalid_request_paths', bad);
  }
  assert.equal(getPayloadRequestPathsValidationError([' /v1/responses ', '', '/']), undefined);

  const base = `requests:
  payload:
    default:
      - models:
          - name: gpt-5
            request-paths:
              # keep-path-comment
              - /v1/responses
        params: {temperature: 1}
    filter:
      - models:
          - name: gpt-5
            request-paths:
              - /v1/responses
        params: [stream]
`;
  const whitespaceDefault = run(base, ({ payloadDefaultRules: [rule] }) => ({
    payloadDefaultRules: [
      { ...rule, models: [{ ...rule.models[0], requestPaths: ['   ', ''] }] },
    ],
  }));
  assert.equal(whitespaceDefault.payloadInvalid, true);
  assert.equal(whitespaceDefault.error?.code, 'visual_apply_failed');
  assert.ok(getConfigIssueFields(whitespaceDefault.values).has('payloadDefaultRules'));

  const whitespaceFilter = run(base, ({ payloadFilterRules: [rule] }) => ({
    payloadFilterRules: [
      { ...rule, models: [{ ...rule.models[0], requestPaths: ['   '] }] },
    ],
  }));
  assert.equal(whitespaceFilter.payloadInvalid, true);
  assert.equal(whitespaceFilter.error?.code, 'visual_apply_failed');
  assert.ok(getConfigIssueFields(whitespaceFilter.values).has('payloadFilterRules'));

  const trimmed = run(base, ({ payloadDefaultRules: [rule] }) => ({
    payloadDefaultRules: [
      {
        ...rule,
        models: [{ ...rule.models[0], requestPaths: [' /v1/responses ', '', '/v1/chat/completions '] }],
      },
    ],
  }));
  assert.equal(trimmed.error, undefined);
  assert.match(trimmed.output, /# keep-path-comment/);
  assert.deepEqual(
    parse(trimmed.output).requests.payload.default[0].models[0]['request-paths'],
    ['/v1/responses', '/v1/chat/completions']
  );

  const cleared = run(base, ({ payloadDefaultRules: [rule] }) => ({
    payloadDefaultRules: [{ ...rule, models: [{ ...rule.models[0], requestPaths: undefined }] }],
  }));
  assert.equal(cleared.error, undefined);
  assert.equal(
    'request-paths' in parse(cleared.output).requests.payload.default[0].models[0],
    false
  );
});

test('PayloadModelsEditor surfaces P1-07 request-paths validation inline across all 4 locales', async () => {
  const resources = {};
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    const json = JSON.parse(fs.readFileSync(new URL(`../../i18n/locales/${locale}.json`, import.meta.url), 'utf8'));
    assert.ok(json.config_management?.visual?.validation?.payload_invalid_request_paths, locale);
    resources[locale] = { translation: json };
  }
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources, fallbackLng: false });

  const modelMarkup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(PayloadModelsEditor, {
        value: [{ id: 'm1', name: 'gpt-5', requestPaths: ['   '] }],
        onChange() {},
      })
    )
  );
  assert.match(modelMarkup, /aria-invalid="true"/);
  assert.match(modelMarkup, /aria-describedby="[^"]+-error"/);
  assert.match(modelMarkup, /role="alert"/);
  assert.ok(modelMarkup.includes(i18n.t('config_management.visual.validation.payload_invalid_request_paths')));
});

test('ADV-1..ADV-4: applyVisualChangesToYaml enforces dirty payload validation across all payload sections while gating untouched sections', () => {
  const invalidBase = `server:
  port: 8317
requests:
  payload:
    default:
      - models:
          - name: gpt-5
            request-paths:
              - no-slash
        params:
          temperature: 0.5
    default-raw:
      - models:
          - name: gpt-5
            request-paths:
              - no-slash
        params:
          extra: '{"a":1}'
    override:
      - models:
          - name: gpt-5
            request-paths:
              - no-slash
        params:
          temperature: 0.7
    override-raw:
      - models:
          - name: gpt-5
            request-paths:
              - no-slash
        params:
          extra: '{"b":2}'
    filter:
      - models:
          - name: gpt-5
            request-paths:
              - no-slash
        params:
          - stream
`;

  // Untouched invalid payload.default / payload.filter must NOT block unrelated edits (P1-11 dirtyFields gating).
  const unrelatedEdit = run(invalidBase, () => ({ port: '8318' }));
  assert.equal(unrelatedEdit.payloadInvalid, false);
  assert.equal(unrelatedEdit.error, undefined);
  assert.equal(parse(unrelatedEdit.output).server.port, 8318);
  assert.deepEqual(
    parse(unrelatedEdit.output).requests.payload.default[0].models[0]['request-paths'],
    ['no-slash']
  );

  // ADV-1: dirty payloadDefaultRules (editing params on a rule with invalid request-paths: ['no-slash']) throws VisualConfigApplyError('visual_apply_failed').
  const adv1 = run(invalidBase, ({ payloadDefaultRules: [rule] }) => ({
    payloadDefaultRules: [
      {
        ...rule,
        params: [{ ...rule.params[0], value: '0.9' }],
      },
    ],
  }));
  assert.equal(adv1.payloadInvalid, true);
  assert.ok(adv1.error instanceof VisualConfigApplyError);
  assert.equal(adv1.error?.code, 'visual_apply_failed');

  // ADV-2: dirty payloadDefaultRules (editing params on a rule with pre-existing request-paths: []) throws VisualConfigApplyError('visual_apply_failed').
  const emptyPathsBase = invalidBase.replace('request-paths:\n              - no-slash', 'request-paths: []');
  const adv2 = run(emptyPathsBase, ({ payloadDefaultRules: [rule] }) => ({
    payloadDefaultRules: [
      {
        ...rule,
        params: [{ ...rule.params[0], value: '0.9' }],
      },
    ],
  }));
  assert.equal(adv2.payloadInvalid, true);
  assert.ok(adv2.error instanceof VisualConfigApplyError);
  assert.equal(adv2.error?.code, 'visual_apply_failed');

  // ADV-3: clearing model.name to '' while model.requestPaths is ['no-slash'] throws VisualConfigApplyError('visual_apply_failed') instead of deleting payload.default.
  const adv3 = run(invalidBase, ({ payloadDefaultRules: [rule] }) => ({
    payloadDefaultRules: [
      {
        ...rule,
        models: [{ ...rule.models[0], name: '', requestPaths: ['no-slash'] }],
      },
    ],
  }));
  assert.equal(adv3.payloadInvalid, true);
  assert.ok(adv3.error instanceof VisualConfigApplyError);
  assert.equal(adv3.error?.code, 'visual_apply_failed');

  // ADV-4: dirty payloadFilterRules (editing params on a rule with invalid request-paths) throws VisualConfigApplyError('visual_apply_failed').
  const adv4 = run(invalidBase, ({ payloadFilterRules: [rule] }) => ({
    payloadFilterRules: [
      {
        ...rule,
        params: ['temperature'],
      },
    ],
  }));
  assert.equal(adv4.payloadInvalid, true);
  assert.ok(adv4.error instanceof VisualConfigApplyError);
  assert.equal(adv4.error?.code, 'visual_apply_failed');

  // Cover remaining dirty payload sections: payloadDefaultRawRules, payloadOverrideRules, payloadOverrideRawRules.
  for (const field of ['payloadDefaultRawRules', 'payloadOverrideRules', 'payloadOverrideRawRules']) {
    const res = run(invalidBase, (values) => ({
      [field]: [
        {
          ...values[field][0],
          params: [{ ...values[field][0].params[0], value: '{"edited":true}' }],
        },
      ],
    }));
    assert.equal(res.payloadInvalid, true, field);
    assert.ok(res.error instanceof VisualConfigApplyError, field);
    assert.equal(res.error?.code, 'visual_apply_failed', field);
  }
});
