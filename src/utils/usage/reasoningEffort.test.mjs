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
const { normalizeReasoningEffort } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('normalizes surrounding whitespace without inferring model-specific semantics', () => {
  assert.equal(normalizeReasoningEffort(' Max '), 'Max');
  assert.equal(normalizeReasoningEffort('custom-effort'), 'custom-effort');
});

test('preserves non-empty unknown values as supplied', () => {
  assert.equal(normalizeReasoningEffort('experimental:42'), 'experimental:42');
  assert.equal(normalizeReasoningEffort('custom-effort'), 'custom-effort');
});

test('maps missing, empty, and non-string values to legacy or unknown', () => {
  assert.equal(normalizeReasoningEffort(undefined), null);
  assert.equal(normalizeReasoningEffort('  '), null);
  assert.equal(normalizeReasoningEffort(42), null);
});
