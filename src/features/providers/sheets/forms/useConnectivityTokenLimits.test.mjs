import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Port of upstream 7b754b23 OpenAI connectivity token-limit tests: the probe
// must send max_completion_tokens exactly for models configured with
// useMaxCompletionTokens, resolved through the backend's name/alias matcher
// (trim, strip one trailing parenthesized suffix, case-insensitive).
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { useConnectivityTest } = await vite.ssrLoadModule(
  '/src/features/providers/sheets/forms/useConnectivityTest.ts'
);
const { apiCallApi } = await vite.ssrLoadModule('/src/services/api/apiCall.ts');
test.after(() => vite.close());

function captureHook(hook) {
  let result;
  function Harness() {
    result = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

const messages = {
  baseUrlRequired: 'base required',
  endpointInvalid: 'invalid endpoint',
  apiKeyRequired: 'key required',
  modelRequired: 'model required',
  timeout: () => 'timeout',
  requestFailed: 'failed',
};
const success = { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };

const models = [
  { name: 'reasoner', alias: 'reasoning-alias', useMaxCompletionTokens: true },
  { name: 'legacy', alias: 'legacy-alias', useMaxCompletionTokens: false },
  { name: 'default', alias: '' },
  { name: 'alias-owner', alias: 'collision', useMaxCompletionTokens: true },
  { name: 'collision', alias: '', useMaxCompletionTokens: false },
  { name: ' Configured (high) ', alias: ' Friendly (low) ', useMaxCompletionTokens: true },
];

const args = {
  brand: 'openaiCompatibility',
  baseUrl: 'https://upstream.example/v1',
  apiKey: 'fixture-key',
  apiKeyEntries: [{ apiKey: 'fixture-key', proxyUrl: '' }],
  models,
  formHeaders: [],
};

const cases = [
  ['reasoner', true],
  ['legacy', false],
  ['default', false],
  ['unknown', false],
  ['reasoning-alias', true],
  ['legacy-alias', false],
  ['collision', false],
  [' REASONER (high) ', true],
  [' REASONING-ALIAS(anything) ', true],
  ['configured', true],
  ['friendly', true],
  ['reasoner(unclosed', false],
  ['(high)', false],
  ['', true],
  ['   ', true],
  [undefined, true],
];

for (const [testModel, completion] of cases) {
  test(`selected model ${JSON.stringify(testModel)} uses completion tokens: ${completion}`, async (t) => {
    const bodies = [];
    t.mock.method(apiCallApi, 'request', async (request) => {
      bodies.push(JSON.parse(request.data));
      return success;
    });
    const hook = captureHook(() => useConnectivityTest({ ...args, testModel }, messages));
    await hook.runOpenAIKey(0);
    assert.equal(bodies.length, 1);
    const body = bodies[0];
    assert.equal(body.max_completion_tokens !== undefined, completion, JSON.stringify(body));
    assert.equal(body.max_tokens !== undefined, !completion, JSON.stringify(body));
  });
}
