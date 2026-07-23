import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./logLines.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { mergeIncrementalLogLines } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('merges ordinary incremental log overlap without duplicates', () => {
  assert.deepEqual(mergeIncrementalLogLines(['one', 'two'], ['two', 'three']), [
    'one',
    'two',
    'three',
  ]);
});

test('replaces a previewed trailing partial when the completed line arrives', () => {
  assert.deepEqual(
    mergeIncrementalLogLines(['first', 'partial'], ['partial complete', 'new'], true),
    ['first', 'partial complete', 'new']
  );
});

test('replaces an unchanged preview without duplicating the completed line', () => {
  assert.deepEqual(mergeIncrementalLogLines(['first', 'partial'], ['partial'], true), [
    'first',
    'partial',
  ]);
});
