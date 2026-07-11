import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./reasoningEffort.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { classifyUsageReasoningEffort, isGPT56UltraWireModel } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('known Sol and Terra Max usage is presented as the Ultra wire value', () => {
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra(ultra)', 'openai/gpt-5.6-sol']) {
    assert.deepEqual(classifyUsageReasoningEffort(model, ' Max '), {
      raw: 'Max',
      kind: 'max-ultra-wire',
    });
  }
});

test('Luna, custom, and unknown models preserve their raw effort semantics', () => {
  assert.deepEqual(classifyUsageReasoningEffort('gpt-5.6-luna', 'max'), {
    raw: 'max',
    kind: 'raw',
  });
  assert.deepEqual(classifyUsageReasoningEffort('custom:gpt-5.6-sol', 'max'), {
    raw: 'max',
    kind: 'raw',
  });
  assert.deepEqual(classifyUsageReasoningEffort('custom-codex-ultra', 'Ultra'), {
    raw: 'Ultra',
    kind: 'raw',
  });
});

test('missing effort remains explicitly legacy or unknown', () => {
  assert.deepEqual(classifyUsageReasoningEffort('gpt-5.6-sol', '  '), {
    raw: null,
    kind: 'legacy-unknown',
  });
});

test('the GPT-5.6 wire allowlist is narrow and does not match custom aliases', () => {
  assert.equal(isGPT56UltraWireModel('codex/gpt-5.6-terra'), true);
  assert.equal(isGPT56UltraWireModel('gpt-5.6-luna'), false);
  assert.equal(isGPT56UltraWireModel('vendor/gpt-5.6-sol'), false);
  assert.equal(isGPT56UltraWireModel('custom:gpt-5.6-terra'), false);
});
