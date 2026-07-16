import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./cacheTokens.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const {
  calculateFallbackUsageTotalTokens,
  calculateUsageCost,
  getUsageCacheTokenCounts,
  getUsageUncachedInputTokenCount,
  isGpt56CacheWriteModel,
  resolveUsageTotalTokens,
  resolveCacheWriteUnitPrice,
  splitUsageTokensForCost,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const COST_FIXTURE = {
  input_tokens: 1_000_000,
  output_tokens: 100_000,
  cache_read_tokens: 300_000,
  cache_creation_tokens: 400_000,
};
const COST_PRICES = { prompt: 10, completion: 20, cache: 1 };

const assertApproxCost = (actual, expected) => {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `cost = ${actual}, want approximately ${expected}`
  );
};

test('canonical cache fields win while legacy aliases remain supported', () => {
  assert.deepEqual(
    getUsageCacheTokenCounts({
      cache_read_tokens: 7,
      cached_tokens: 99,
      cache_creation_tokens: 11,
      cache_write_tokens: 88,
    }),
    { cacheReadTokens: 7, cacheWriteTokens: 11 }
  );

  assert.deepEqual(
    getUsageCacheTokenCounts({ cached_tokens: 5, cache_tokens: 9, cache_write_tokens: 13 }),
    { cacheReadTokens: 9, cacheWriteTokens: 13 }
  );

  assert.deepEqual(
    getUsageCacheTokenCounts({
      cache_read_tokens: 0,
      cached_tokens: 99,
      cache_creation_tokens: 0,
      cache_write_tokens: 88,
    }),
    { cacheReadTokens: 0, cacheWriteTokens: 0 }
  );
});

test('GPT-5.6 cost split removes cache read and write from normal prompt input', () => {
  assert.deepEqual(
    splitUsageTokensForCost(
      {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 30,
        cache_creation_tokens: 40,
      },
      'gpt-5.6-sol'
    ),
    {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      promptTokens: 30,
    }
  );
});

test('Core GPT-5.6 usage fixture keeps cache read and write independent', () => {
  const tokens = {
    input_tokens: 1200,
    output_tokens: 10,
    cached_tokens: 128,
    cache_read_tokens: 128,
    cache_creation_tokens: 1024,
    total_tokens: 1210,
  };

  assert.deepEqual(getUsageCacheTokenCounts(tokens), {
    cacheReadTokens: 128,
    cacheWriteTokens: 1024,
  });
  assert.deepEqual(splitUsageTokensForCost(tokens, 'gpt-5.6-sol'), {
    inputTokens: 1200,
    outputTokens: 10,
    cacheReadTokens: 128,
    cacheWriteTokens: 1024,
    promptTokens: 48,
  });
  assert.equal(resolveCacheWriteUnitPrice('gpt-5.6-sol', 10, 1), 10);
  assert.equal(calculateFallbackUsageTotalTokens(tokens, 'gpt-5.6-sol'), 1210);
});

test('explicit Core totals win while missing-total legacy details use the Panel fallback', () => {
  const tokens = {
    input_tokens: 1200,
    output_tokens: 10,
    cache_creation_tokens: 1024,
  };

  assert.equal(resolveUsageTotalTokens({ ...tokens, total_tokens: 2234 }, 'gpt-5.6-sol'), 2234);
  assert.equal(resolveUsageTotalTokens(tokens, 'gpt-5.6-sol'), 1210);
});

test('uncached input is authoritative for OpenAI/Codex and Claude under the same model alias', () => {
  const modelAlias = 'tenant/shared-model-alias';

  assertApproxCost(
    calculateUsageCost(
      { ...COST_FIXTURE, uncached_input_tokens: 300_000 },
      modelAlias,
      COST_PRICES
    ),
    9.3
  );
  assertApproxCost(
    calculateUsageCost(
      { ...COST_FIXTURE, uncached_input_tokens: 1_000_000 },
      modelAlias,
      COST_PRICES
    ),
    16.3
  );
});

test('explicit cache-write zero and positive overrides apply after uncached input resolution', () => {
  const modelAlias = 'tenant/shared-model-alias';
  const openAiTokens = { ...COST_FIXTURE, uncached_input_tokens: 300_000 };
  const claudeTokens = { ...COST_FIXTURE, uncached_input_tokens: 1_000_000 };

  assertApproxCost(
    calculateUsageCost(openAiTokens, modelAlias, { ...COST_PRICES, cacheWrite: 0 }),
    5.3
  );
  assertApproxCost(
    calculateUsageCost(claudeTokens, modelAlias, { ...COST_PRICES, cacheWrite: 0 }),
    12.3
  );
  assertApproxCost(
    calculateUsageCost(openAiTokens, modelAlias, { ...COST_PRICES, cacheWrite: 2 }),
    6.1
  );
  assertApproxCost(
    calculateUsageCost(claudeTokens, modelAlias, { ...COST_PRICES, cacheWrite: 2 }),
    13.1
  );
});

test('known zero uncached input is accepted instead of falling back to model heuristics', () => {
  const split = splitUsageTokensForCost(
    { ...COST_FIXTURE, uncached_input_tokens: 0 },
    'gpt-5.6-sol'
  );

  assert.equal(split.promptTokens, 0);
  assert.equal(
    getUsageUncachedInputTokenCount({
      input_tokens: COST_FIXTURE.input_tokens,
      uncached_input_tokens: 0,
    }),
    0
  );
});

test('uncached input export helper preserves valid counts and rejects non-authoritative values', () => {
  assert.equal(
    getUsageUncachedInputTokenCount({ input_tokens: 100, uncached_input_tokens: 40 }),
    40
  );
  assert.equal(
    getUsageUncachedInputTokenCount({ input_tokens: 100, uncached_input_tokens: 101 }),
    null
  );
  assert.equal(
    getUsageUncachedInputTokenCount({ input_tokens: 100, uncached_input_tokens: '40' }),
    null
  );
  assert.equal(getUsageUncachedInputTokenCount({ input_tokens: 100 }), null);
});

test('invalid uncached input values preserve the explicit legacy GPT-5.6 fallback', () => {
  const invalidValues = [
    { label: 'null', value: null },
    { label: 'negative number', value: -1 },
    { label: 'fractional number', value: 1.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: 'overflow', value: Number.MAX_SAFE_INTEGER + 1 },
    { label: 'greater than input', value: 1_000_001 },
    { label: 'false', value: false },
    { label: 'true', value: true },
    { label: 'empty array', value: [] },
    { label: 'single-item array', value: [1] },
    { label: 'object', value: { value: 300_000 } },
    { label: 'whitespace string', value: '   ' },
    { label: 'numeric string', value: '300000' },
  ];

  for (const { label, value: uncachedInput } of invalidValues) {
    const split = splitUsageTokensForCost(
      { ...COST_FIXTURE, uncached_input_tokens: uncachedInput },
      'gpt-5.6-sol'
    );
    assert.equal(
      split.promptTokens,
      300_000,
      `${label} uncached_input_tokens should use the legacy split`
    );
  }
});

test('uncached input is never authoritative when input_tokens is not a valid token count', () => {
  const invalidInputValues = [
    { label: 'null', value: null },
    { label: 'false', value: false },
    { label: 'true', value: true },
    { label: 'numeric string', value: '1000000' },
    { label: 'fractional', value: 1.5 },
    { label: 'negative', value: -1 },
    { label: 'overflow', value: Number.MAX_SAFE_INTEGER + 1 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ];

  for (const { label, value: inputTokens } of invalidInputValues) {
    const legacyTokens = { ...COST_FIXTURE, input_tokens: inputTokens };
    const explicitTokens = { ...legacyTokens, uncached_input_tokens: 123_456 };

    assert.deepEqual(
      splitUsageTokensForCost(explicitTokens, 'gpt-5.6-sol'),
      splitUsageTokensForCost(legacyTokens, 'gpt-5.6-sol'),
      `${label} input_tokens should force the legacy cost split`
    );
    assert.equal(
      calculateFallbackUsageTotalTokens(explicitTokens, 'gpt-5.6-sol'),
      calculateFallbackUsageTotalTokens(legacyTokens, 'gpt-5.6-sol'),
      `${label} input_tokens should force the legacy total fallback`
    );
  }
});

test('invalid input with known-zero uncached input still uses the legacy total fallback', () => {
  const invalidInputTokens = { ...COST_FIXTURE, input_tokens: null };

  assert.equal(
    calculateFallbackUsageTotalTokens(
      { ...invalidInputTokens, uncached_input_tokens: 0 },
      'gpt-5.6-sol'
    ),
    calculateFallbackUsageTotalTokens(invalidInputTokens, 'gpt-5.6-sol')
  );
});

test('missing uncached input keeps the legacy GPT-5.6 split and cost', () => {
  assert.equal(splitUsageTokensForCost(COST_FIXTURE, 'gpt-5.6-sol').promptTokens, 300_000);
  assertApproxCost(calculateUsageCost(COST_FIXTURE, 'gpt-5.6-sol', COST_PRICES), 9.3);
});

test('non GPT-5.6 models preserve the existing prompt-minus-cache-read behavior', () => {
  const split = splitUsageTokensForCost(
    {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
    },
    'claude-sonnet-4-5'
  );

  assert.equal(split.promptTokens, 70);
  assert.equal(split.cacheWriteTokens, 40);
  const cost = calculateUsageCost(
    {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
    },
    'claude-sonnet-4-5',
    { prompt: 10, completion: 20, cache: 1 }
  );
  assert.ok(Math.abs(cost - 0.00153) < 1e-12, `cost = ${cost}, want approximately 0.00153`);

  const configuredWriteCost = calculateUsageCost(
    {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 30,
      cache_creation_tokens: 40,
    },
    'claude-sonnet-4-5',
    { prompt: 10, completion: 20, cache: 1, cacheWrite: 2 }
  );
  assert.ok(
    Math.abs(configuredWriteCost - 0.00121) < 1e-12,
    `cost = ${configuredWriteCost}, want approximately 0.00121`
  );
});

test('only explicit GPT-5.6 model slugs are still detected, and unspecified cache-write defaults to prompt price', () => {
  for (const model of ['gpt-5.6-sol', 'openai/gpt-5.6-terra', 'custom:gpt-5.6-luna']) {
    assert.equal(isGpt56CacheWriteModel(model), true);
    assert.equal(resolveCacheWriteUnitPrice(model, 10, 1), 10);
  }

  for (const model of [
    'gpt-5.5',
    'gpt-5.4-mini',
    'vendor/terra',
    'custom:luna',
    'sol',
    'vendor/luna',
    'custom:terra',
  ]) {
    assert.equal(isGpt56CacheWriteModel(model), false);
    assert.equal(resolveCacheWriteUnitPrice(model, 10, 1), 10);
  }

  assert.equal(resolveCacheWriteUnitPrice('gpt-5.6-sol', 10, 1, 7), 7);
  assert.equal(resolveCacheWriteUnitPrice('gpt-5.6-sol', 10, 1, 0), 0);
  assert.equal(resolveCacheWriteUnitPrice('claude-sonnet-4-5', 10, 1), 10);
  assert.equal(resolveCacheWriteUnitPrice('claude-sonnet-4-5', 10, 1, 2), 2);
  assert.equal(resolveCacheWriteUnitPrice('claude-sonnet-4-5', 10, 1, 0), 0);
});

test('legacy cost calculation prices normal input, cache read, cache write, and output independently', () => {
  const cost = calculateUsageCost(
    {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_tokens: 300_000,
      cache_creation_tokens: 400_000,
    },
    'gpt-5.6-sol',
    { prompt: 10, completion: 20, cache: 1 }
  );

  assert.equal(cost, 9.3);
});
