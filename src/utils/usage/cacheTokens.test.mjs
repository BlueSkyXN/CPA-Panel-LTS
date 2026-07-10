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
  isGpt56CacheWriteModel,
  resolveCacheWriteUnitPrice,
  splitUsageTokensForCost,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

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
  assert.equal(resolveCacheWriteUnitPrice('gpt-5.6-sol', 10, 1), 12.5);
  assert.equal(calculateFallbackUsageTotalTokens(tokens, 'gpt-5.6-sol'), 1210);
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
  assert.ok(Math.abs(cost - 0.00117) < 1e-12, `cost = ${cost}, want approximately 0.00117`);
});

test('GPT-5.6 variants and Codex family aliases receive the 1.25x default write price', () => {
  for (const model of ['gpt-5.6-sol', 'openai/gpt-5.6-terra', 'luna']) {
    assert.equal(isGpt56CacheWriteModel(model), true);
    assert.equal(resolveCacheWriteUnitPrice(model, 10, 1), 12.5);
  }

  assert.equal(resolveCacheWriteUnitPrice('gpt-5.6-sol', 10, 1, 7), 7);
  assert.equal(resolveCacheWriteUnitPrice('claude-sonnet-4-5', 10, 1), 1);
});

test('cost calculation prices normal input, cache read, cache write, and output independently', () => {
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

  assert.equal(cost, 10.3);
});
