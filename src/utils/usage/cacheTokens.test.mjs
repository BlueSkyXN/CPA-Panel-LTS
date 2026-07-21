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
  getUsageNonCacheReadInputTokenCount,
  resolveCacheWriteUnitPrice,
  resolveUsageTotalTokens,
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

test('canonical cache fields win and cached_tokens permanently mirrors cache reads', () => {
  assert.deepEqual(
    getUsageCacheTokenCounts({
      cache_read_tokens: 7,
      cached_tokens: 99,
      cache_creation_tokens: 11,
    }),
    { cacheReadTokens: 7, cacheWriteTokens: 11 }
  );

  assert.deepEqual(getUsageCacheTokenCounts({ cached_tokens: 5 }), {
    cacheReadTokens: 5,
    cacheWriteTokens: 0,
  });

  assert.deepEqual(getUsageCacheTokenCounts({ cache_tokens: 9, cache_write_tokens: 13 }), {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
});

test('Panel derives the non-cache-read input cache-rate complement', () => {
  const normalizedTokens = {
    input_tokens: 100,
    cache_read_tokens: 30,
    cache_creation_tokens: 40,
  };

  assert.equal(getUsageNonCacheReadInputTokenCount(normalizedTokens), 70);
  assert.equal(getUsageNonCacheReadInputTokenCount({ input_tokens: 3, cache_read_tokens: 5 }), 0);
});

test('pricing always subtracts cache reads and writes from normal prompt input', () => {
  const tokens = {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 30,
    cache_creation_tokens: 40,
  };
  const expectedSplit = {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
    promptTokens: 30,
  };

  assert.deepEqual(splitUsageTokensForCost(tokens, 'gpt-5.6-sol'), expectedSplit);
  assert.deepEqual(splitUsageTokensForCost(tokens, 'claude-sonnet-4-5'), expectedSplit);
  assert.deepEqual(splitUsageTokensForCost(tokens, 'custom/provider-alias'), expectedSplit);
});

test('cache-write pricing remains independent after local prompt splitting', () => {
  assert.equal(splitUsageTokensForCost(COST_FIXTURE, 'gpt-5.6-sol').promptTokens, 300_000);
  assertApproxCost(calculateUsageCost(COST_FIXTURE, 'gpt-5.6-sol', COST_PRICES), 9.3);
  assertApproxCost(
    calculateUsageCost(COST_FIXTURE, 'claude-sonnet-4-5', {
      ...COST_PRICES,
      cacheWrite: 0,
    }),
    5.3
  );
  assertApproxCost(
    calculateUsageCost(COST_FIXTURE, 'custom/provider-alias', {
      ...COST_PRICES,
      cacheWrite: 2,
    }),
    6.1
  );
});

test('total fallback does not add cache tokens that normalized input already contains', () => {
  const tokens = {
    input_tokens: 1_200,
    output_tokens: 10,
    reasoning_tokens: 1,
    cache_read_tokens: 128,
    cache_creation_tokens: 1_024,
  };

  assert.equal(calculateFallbackUsageTotalTokens(tokens, 'any-model'), 1_211);
  assert.equal(resolveUsageTotalTokens({ ...tokens, total_tokens: 2_234 }, 'any-model'), 2_234);
  assert.equal(resolveUsageTotalTokens(tokens, 'any-model'), 1_211);
});

test('explicit cache-write overrides preserve Auto and free semantics', () => {
  assert.equal(resolveCacheWriteUnitPrice('any-model', 10, 1), 10);
  assert.equal(resolveCacheWriteUnitPrice('any-model', 10, 1, 7), 7);
  assert.equal(resolveCacheWriteUnitPrice('any-model', 10, 1, 0), 0);
});
