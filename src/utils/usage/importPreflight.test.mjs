import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./importPreflight.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { analyzeUsageImport } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

const detail = (tokens, overrides = {}) => ({
  timestamp: '2026-07-10T12:00:00.123456789Z',
  source: 'auths/codex.json',
  auth_index: '0',
  failed: false,
  tokens,
  ...overrides,
});

const payload = (...details) => ({
  version: 1,
  usage: {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-5.6-sol': { details },
        },
      },
    },
  },
});

const legacyCreation = detail({
  input_tokens: 1200,
  output_tokens: 10,
  cached_tokens: 1024,
  cache_read_tokens: 0,
  cache_creation_tokens: 1024,
  total_tokens: 1210,
});

const canonicalCreation = detail({
  input_tokens: 1200,
  output_tokens: 10,
  cached_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 1024,
  total_tokens: 2234,
});

test('legacy and canonical creation-only records share one import identity despite total drift', () => {
  const result = analyzeUsageImport(payload(legacyCreation, canonicalCreation));

  assert.equal(result.valid, true);
  assert.equal(result.detailCount, 2);
  assert.equal(result.legacyCacheAliasCount, 1);
  assert.equal(result.canonicalCacheWriteCount, 1);
  assert.equal(result.duplicateCount, 1);
});

test('a real cache read is not mistaken for a legacy creation alias', () => {
  const result = analyzeUsageImport(
    payload(
      detail({
        input_tokens: 1200,
        output_tokens: 10,
        cached_tokens: 1024,
        cache_read_tokens: 1024,
        cache_creation_tokens: 1024,
        total_tokens: 2234,
      })
    )
  );

  assert.equal(result.legacyCacheAliasCount, 0);
  assert.equal(result.canonicalCacheWriteCount, 1);
  assert.equal(result.duplicateCount, 0);
});

test('legacy import reports an overlap with an equivalent current canonical record', () => {
  const currentUsage = payload(canonicalCreation).usage;
  const result = analyzeUsageImport(payload(legacyCreation), currentUsage);

  assert.equal(result.currentUsageAvailable, true);
  assert.equal(result.currentDetailCount, 1);
  assert.equal(result.overlapCount, 1);
});

test('canonical import reports an overlap with an equivalent current legacy record', () => {
  const currentUsage = payload(legacyCreation).usage;
  const result = analyzeUsageImport(payload(canonicalCreation), currentUsage);

  assert.equal(result.currentUsageAvailable, true);
  assert.equal(result.currentDetailCount, 1);
  assert.equal(result.overlapCount, 1);
});

test('duplicate count includes repeated canonical identities only after the first', () => {
  const result = analyzeUsageImport(
    payload(legacyCreation, canonicalCreation, JSON.parse(JSON.stringify(canonicalCreation)))
  );

  assert.equal(result.detailCount, 3);
  assert.equal(result.duplicateCount, 2);
});

test('unsupported and malformed payloads are rejected before upload', () => {
  const unsupported = analyzeUsageImport({ version: 2, usage: { apis: {} } });
  assert.equal(unsupported.valid, false);
  assert.deepEqual(unsupported.issues, ['unsupported_version']);

  const malformed = analyzeUsageImport({ version: 1, usage: [] });
  assert.equal(malformed.valid, false);
  assert.deepEqual(malformed.issues, ['missing_usage']);

  const missingApis = analyzeUsageImport({ version: 1, usage: {} });
  assert.equal(missingApis.valid, false);
  assert.deepEqual(missingApis.issues, ['invalid_usage_apis']);
});

test('analysis is read-only and keeps the uploaded snapshot unchanged', () => {
  const importPayload = payload(legacyCreation);
  const before = JSON.parse(JSON.stringify(importPayload));

  analyzeUsageImport(importPayload, payload(canonicalCreation).usage);

  assert.deepEqual(importPayload, before);
});
