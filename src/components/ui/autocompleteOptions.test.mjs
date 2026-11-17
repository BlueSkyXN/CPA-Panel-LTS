import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { filterAutocompleteOptions, normalizeAutocompleteOptions } = await vite.ssrLoadModule(
  '/src/components/ui/autocompleteOptions.ts'
);
test.after(() => vite.close());

const options = normalizeAutocompleteOptions([
  'claude-sonnet-4-6',
  'claude-opus-4-1',
  { value: 'gpt-5', label: 'OpenAI flagship' },
]);

test('keeps every option reachable when reopened with a selected value', () => {
  assert.deepEqual(filterAutocompleteOptions(options, 'claude-sonnet-4-6', false), options);
});

test('narrows by value or label while typing', () => {
  assert.deepEqual(
    filterAutocompleteOptions(options, 'OPUS', true).map((opt) => opt.value),
    ['claude-opus-4-1']
  );
  assert.deepEqual(
    filterAutocompleteOptions(options, 'flagship', true).map((opt) => opt.value),
    ['gpt-5']
  );
});

test('shows everything when the typed query is blank', () => {
  assert.deepEqual(filterAutocompleteOptions(options, '  ', true), options);
});

test('normalizes string and object options', () => {
  assert.deepEqual(normalizeAutocompleteOptions(['a', { value: 'b' }]), [
    { value: 'a', label: 'a' },
    { value: 'b', label: 'b' },
  ]);
});
