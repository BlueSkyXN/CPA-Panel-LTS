import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from 'yaml';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { useVisualConfig, getVisualConfigValidationErrors } = await vite.ssrLoadModule(
  '/src/hooks/useVisualConfig.ts'
);
const { DEFAULT_VISUAL_VALUES } = await vite.ssrLoadModule('/src/types/visualConfig.ts');
const { projectConfigForVisual } = await vite.ssrLoadModule('/src/utils/v8VisualProjection.ts');
const { assertConfigListsUnchanged } = await vite.ssrLoadModule('/src/utils/configListConflict.ts');
test.after(() => vite.close());

test('concurrent client/provider list changes cannot be overwritten by a stale draft', () => {
  assert.throws(
    () =>
      assertConfigListsUnchanged(
        'access: {api-keys: [a]}',
        'access: {api-keys: [b]}',
        'access: {api-keys: [a, c]}'
      ),
    /concurrently/
  );
  assert.doesNotThrow(() =>
    assertConfigListsUnchanged(
      'access: {api-keys: [a]}',
      'access: {api-keys: [b]}',
      'access: {api-keys: [b]}'
    )
  );
  assert.doesNotThrow(() =>
    assertConfigListsUnchanged(
      'access: {api-keys: [a]}',
      'access: {api-keys: [a]}\ndebug: true',
      'access: {api-keys: [a, c]}'
    )
  );
});

function apply(source, edit) {
  let output;
  function Harness() {
    const config = useVisualConfig();
    const [phase, setPhase] = useState(0);
    if (phase === 0) {
      assert.equal(config.loadVisualValuesFromYaml(source).ok, true);
      setPhase(1);
    } else if (phase === 1) {
      config.setVisualValues(edit(config.visualValues));
      setPhase(2);
    } else output = config.applyVisualChangesToYaml(source);
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
  const mixed =
    grouped +
    'port: 9999\ncommercial-mode: true\nrequest-retry: 5\nrouting: {retry: {request-retry: 0}}\n';
  const result = parse(
    apply(mixed, (values) => {
      assert.equal(values.port, '8317');
      assert.equal(values.commercialMode, false);
      assert.equal(values.requestRetry, '0');
      return { port: '8318', requestRetry: '2', codexCacheAffinityStrategy: 'stable-id' };
    })
  );
  assert.equal(result.server.port, 8318);
  assert.equal(result.routing.retry['request-retry'], 2);
  assert.equal(result.upstream.codex['cache-affinity'].strategy, 'stable-id');
  assert.equal(result.port, undefined);
  assert.equal(result['request-retry'], undefined);
  assert.deepEqual(result['api-keys'], parse(grouped)['api-keys']);
});

test('v8 payload edits preserve AST comments and unknown fields', () => {
  const output = apply(grouped, (values) => ({
    payloadOverrideRules: values.payloadOverrideRules.map((rule) => ({
      ...rule,
      params: rule.params.map((param) => ({ ...param, value: '2' })),
    })),
  }));
  assert.ok(output.includes('keep-rule'));
  assert.equal(parse(output).requests.payload.override[0].future, 'keep');
  assert.equal(parse(output).requests.payload.override[0].params.temperature, 2);
  assert.equal(parse(output).payload, undefined);
});

test('editing canonical retry values safely replaces a null routing parent', () => {
  const output = parse(
    apply('server: {port: 8317}\nrouting: null\n', () => ({ requestRetry: '2' }))
  );
  assert.equal(output.routing.retry['request-retry'], 2);
});

test('invalid root and invalid client-key shape are not empty configurations', () => {
  assert.throws(() => projectConfigForVisual('[]'));
  assert.throws(() => projectConfigForVisual('not-a-config'));
});

test('visual edits always write canonical v8 paths (no layout classification)', () => {
  const result = parse(
    apply('server: {port: 8317}\n', () => ({ port: '8318', apiKeysText: 'new' }))
  );
  assert.equal(result.server.port, 8318);
  assert.deepEqual(result.access['api-keys'], ['new']);
  assert.equal(result.port, undefined);
  assert.equal(result['api-keys'], undefined);
});

test('backend boolean defaults and explicit false survive v8 writes', () => {
  for (const source of ['server: {port: 8317}\n', 'config-version: 8\n']) {
    const output = apply(source, (values) => {
      assert.equal(values.wsAuth, true);
      assert.equal(values.quotaSwitchProject, false);
      assert.equal(values.quotaSwitchPreviewModel, false);
      assert.equal(values.antigravitySignatureCacheEnabled, true);
      return { wsAuth: false, antigravitySignatureCacheEnabled: false };
    });
    const view = projectConfigForVisual(output).toJS();
    assert.equal(view['ws-auth'], false);
    assert.equal(view['antigravity-signature-cache-enabled'], false);
  }
  const output = apply(
    'quota-exceeded: {switch-project: true, switch-preview-model: true}\n',
    () => ({ debug: true })
  );
  assert.deepEqual(parse(output)['quota-exceeded'], {
    'switch-project': true,
    'switch-preview-model': true,
  });
});

test('YAML 1.1 booleans use typed backend semantics, not string truthiness', () => {
  for (const [text, expected] of [
    ['off', false],
    ['NO', false],
    ['n', false],
    ['Yes', true],
    ['ON', true],
    ['Y', true],
  ]) {
    const source =
      `observability: {logs: {debug: ${text}}}\n` +
      `oauth: {providers: {aistudio: {ws-auth: ${text}}}}\n` +
      `upstream: {codex: {identity-confuse: ${text}}}\n`;
    apply(source, (values) => {
      assert.equal(values.debug, expected);
      assert.equal(values.wsAuth, expected);
      assert.equal(values.codexIdentityConfuse, expected);
      return { port: '8317' };
    });
  }
});

test('safe integers are enforced while supported negative sentinels remain writable', () => {
  for (const field of [
    'maxRetryCredentials',
    'maxRetryInterval',
    'authAutoRefreshWorkers',
    'transientErrorCooldownSeconds',
  ]) {
    assert.equal(
      getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, [field]: '-1' })[field],
      undefined
    );
    assert.equal(
      getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, [field]: '9007199254740993' })[
        field
      ],
      'integer'
    );
  }
  for (const field of [
    'requestRetry',
    'logsMaxTotalSizeMb',
    'codexAbnormalReasoningRetryMaxRetries',
  ]) {
    assert.equal(
      getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, [field]: '9007199254740993' })[
        field
      ],
      'non_negative_integer'
    );
  }
  const output = apply('routing: {retry: {max-retry-credentials: 2}}\n', () => ({
    maxRetryCredentials: '9007199254740993',
  }));
  assert.equal(parse(output).routing.retry['max-retry-credentials'], 2);
  const sentinels = parse(
    apply('server: {port: 8317}\n', () => ({
      maxRetryCredentials: '-1',
      streaming: { keepaliveSeconds: '-1' },
    }))
  );
  assert.equal(sentinels.routing.retry['max-retry-credentials'], -1);
  assert.equal(sentinels.requests.streaming['keepalive-seconds'], -1);
});

test('canonical v8 structs project field by field and explicit empty resets them', () => {
  const raw = 'upstream: {codex: {client-metadata: {mode: repair, workspace-policy: drop}}}\n';
  const view = projectConfigForVisual(raw).toJS();
  assert.equal(view.codex['client-metadata'].mode, 'repair');
  assert.equal(view.codex['client-metadata']['workspace-policy'], 'drop');
  assert.deepEqual(
    projectConfigForVisual('upstream: {codex: {client-metadata: {}}}\n').toJS().codex[
      'client-metadata'
    ],
    {}
  );
  assert.throws(() => projectConfigForVisual('access: {api-keys: {bad: true}}\n'));
});
