import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const modelPricesSource = await readFile(new URL('./modelPrices.ts', import.meta.url), 'utf8');
const modelPricesCompiled = ts.transpileModule(modelPricesSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { normalizePersistedModelPrices, parseNonNegativePrice } = await import(
  `data:text/javascript;base64,${Buffer.from(modelPricesCompiled).toString('base64')}`
);

const cacheTokensSource = await readFile(new URL('./cacheTokens.ts', import.meta.url), 'utf8');
const cacheTokensCompiled = ts.transpileModule(cacheTokensSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { resolveCacheWriteUnitPrice } = await import(
  `data:text/javascript;base64,${Buffer.from(cacheTokensCompiled).toString('base64')}`
);

const basePrice = { prompt: 10, completion: 20, cache: 1 };

test('legacy v2 Auto stays omitted and intentionally uses the current prompt-price default', () => {
  const normalized = normalizePersistedModelPrices({
    missing: basePrice,
    zero: { ...basePrice, cacheWrite: 0 },
  });

  assert.deepEqual(normalized.missing, basePrice);
  assert.equal(Object.hasOwn(normalized.missing, 'cacheWrite'), false);
  assert.deepEqual(normalized.zero, { ...basePrice, cacheWrite: 0 });
  assert.equal(
    resolveCacheWriteUnitPrice(
      'legacy-v2-model',
      normalized.missing.prompt,
      normalized.missing.cache,
      normalized.missing.cacheWrite
    ),
    normalized.missing.prompt
  );
  assert.equal(
    resolveCacheWriteUnitPrice(
      'legacy-v2-model',
      normalized.zero.prompt,
      normalized.zero.cache,
      normalized.zero.cacheWrite
    ),
    0
  );
});

test('persisted model prices preserve complete numeric strings for backward compatibility', () => {
  const normalized = normalizePersistedModelPrices({
    numericStrings: {
      prompt: '10',
      completion: '20.5',
      cache: '1.25',
      cacheWrite: '0',
    },
    positiveWrite: { ...basePrice, cacheWrite: '2.5' },
  });

  assert.deepEqual(normalized.numericStrings, {
    prompt: 10,
    completion: 20.5,
    cache: 1.25,
    cacheWrite: 0,
  });
  assert.deepEqual(normalized.positiveWrite, { ...basePrice, cacheWrite: 2.5 });
});

test('persisted required prices distinguish missing fields from present invalid fields', () => {
  const invalidValues = [
    { label: 'null', value: null },
    { label: 'boolean', value: false },
    { label: 'string', value: 'not-a-price' },
    { label: 'negative', value: -1 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ];
  const invalidEntries = {};

  for (const field of ['prompt', 'completion', 'cache']) {
    for (const { label, value } of invalidValues) {
      invalidEntries[`${field}-${label}`] = { ...basePrice, [field]: value };
    }
  }

  const normalized = normalizePersistedModelPrices({
    missingPrompt: { completion: 20, cache: 1 },
    missingCompletion: { prompt: 10, cache: 1 },
    missingCache: { prompt: 10, completion: 20 },
    ...invalidEntries,
  });

  assert.deepEqual(normalized.missingPrompt, { prompt: 0, completion: 20, cache: 1 });
  assert.deepEqual(normalized.missingCompletion, { prompt: 10, completion: 0, cache: 1 });
  assert.deepEqual(normalized.missingCache, { prompt: 10, completion: 20, cache: 10 });

  for (const model of Object.keys(invalidEntries)) {
    assert.equal(
      Object.hasOwn(normalized, model),
      false,
      `${model} should be discarded instead of receiving a fallback price`
    );
  }
});

test('invalid persisted cache-write values are omitted instead of becoming explicit zero', () => {
  const invalidValues = {
    nullValue: null,
    empty: '',
    whitespace: '   ',
    boolean: false,
    array: [],
    bad: 'not-a-number',
    partialNumeric: '2.5usd',
    negative: -1,
  };
  const persisted = Object.fromEntries(
    Object.entries(invalidValues).map(([model, cacheWrite]) => [
      model,
      { ...basePrice, cacheWrite },
    ])
  );
  const normalized = normalizePersistedModelPrices(persisted);

  for (const model of Object.keys(invalidValues)) {
    assert.deepEqual(normalized[model], basePrice, `${model} should retain the base prices`);
    assert.equal(
      Object.hasOwn(normalized[model], 'cacheWrite'),
      false,
      `${model} should omit invalid cacheWrite`
    );
  }
});

test('non-empty invalid price inputs are rejected instead of being silently saved as zero', () => {
  assert.equal(parseNonNegativePrice('0'), 0);
  assert.equal(parseNonNegativePrice('2.5'), 2.5);

  for (const invalidInput of ['-1', '2.5usd', 'NaN', 'Infinity', 'false']) {
    assert.equal(
      parseNonNegativePrice(invalidInput),
      undefined,
      `${invalidInput} should be rejected`
    );
  }
});
