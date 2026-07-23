import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const importTypeScriptModule = async (url) => {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
};

const { analyzeUsageImport } = await importTypeScriptModule(
  new URL('./importPreflight.ts', import.meta.url)
);
const {
  decodeUsageImportReceipt,
  getUsageImportErrorCode,
  getUsageImportErrorTranslationKey,
  isMigratedV1UsageImportReceipt,
  USAGE_IMPORT_ERROR_CODES,
} = await importTypeScriptModule(
  new URL('../../services/api/usageImportContract.ts', import.meta.url)
);

const detail = (tokens, overrides = {}) => ({
  timestamp: '2026-07-10T12:00:00.123456789Z',
  latency_ms: 10,
  source: 'auths/codex.json',
  auth_index: '0',
  tokens,
  failed: false,
  generate: true,
  ...overrides,
});

const v1Tokens = (overrides = {}) => ({
  input_tokens: 10,
  output_tokens: 1,
  reasoning_tokens: 0,
  cached_tokens: 0,
  total_tokens: 11,
  ...overrides,
});

const v2Tokens = (overrides = {}) => ({
  input_tokens: 12,
  output_tokens: 2,
  reasoning_tokens: 0,
  cached_tokens: 3,
  cache_read_tokens: 3,
  total_tokens: 14,
  ...overrides,
});

const v1Payload = (...details) => ({
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

const v2Payload = (...details) => {
  const totalTokens = details.reduce((total, item) => total + item.tokens.total_tokens, 0);
  return {
    version: 2,
    usage: {
      total_requests: details.length,
      success_count: details.length,
      failure_count: 0,
      total_tokens: totalTokens,
      apis: {
        'POST /v1/responses': {
          total_requests: details.length,
          total_tokens: totalTokens,
          models: {
            'gpt-5.6-sol': {
              total_requests: details.length,
              total_tokens: totalTokens,
              details,
            },
          },
        },
      },
      requests_by_day: { '2026-07-10': details.length },
      requests_by_hour: { 12: details.length },
      tokens_by_day: { '2026-07-10': totalTokens },
      tokens_by_hour: { 12: totalTokens },
    },
  };
};

const clone = (value) => JSON.parse(JSON.stringify(value));

test('accepts canonical v2 and rejects unsupported or malformed envelopes', () => {
  assert.equal(analyzeUsageImport(v2Payload(detail(v2Tokens()))).valid, true);

  const cases = [
    [null, 'usage_shape_invalid'],
    [{ usage: { apis: {} } }, 'usage_version_unsupported'],
    [{ version: 0, usage: { apis: {} } }, 'usage_version_unsupported'],
    [{ version: 3, usage: { apis: {} } }, 'usage_version_unsupported'],
    [{ version: '2', usage: { apis: {} } }, 'usage_shape_invalid'],
    [{ version: 2 }, 'usage_shape_invalid'],
    [{ version: 2, usage: [] }, 'usage_shape_invalid'],
  ];

  for (const [payload, issue] of cases) {
    const result = analyzeUsageImport(payload);
    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, [issue]);
  }
});

test('rejects malformed nested containers and known field types', () => {
  const mutations = [
    (payload) => (payload.usage.apis = []),
    (payload) => (payload.usage.apis = null),
    (payload) => (payload.usage.apis['POST /v1/responses'] = []),
    (payload) => (payload.usage.apis['POST /v1/responses'] = null),
    (payload) => (payload.usage.apis['POST /v1/responses'].models = []),
    (payload) => (payload.usage.apis['POST /v1/responses'].models = null),
    (payload) => (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'] = []),
    (payload) => (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'] = null),
    (payload) => (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details = {}),
    (payload) => (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details = null),
    (payload) => (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0] = []),
    (payload) => (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0] = null),
    (payload) =>
      (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].tokens = []),
    (payload) =>
      (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].source = 7),
    (payload) =>
      (payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].failed = 'false'),
    (payload) => (payload.usage.requests_by_day = []),
    (payload) => (payload.usage.requests_by_day = null),
    (payload) => (payload.usage.tokens_by_hour['12'] = '14'),
  ];

  for (const mutate of mutations) {
    const payload = v2Payload(detail(v2Tokens()));
    mutate(payload);
    assert.deepEqual(analyzeUsageImport(payload).issues, ['usage_shape_invalid']);
  }
});

test('v2 requires all non-omitempty token fields with strict integer types', () => {
  for (const field of [
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cached_tokens',
    'total_tokens',
  ]) {
    const payload = v2Payload(detail(v2Tokens()));
    delete payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].tokens[field];
    assert.deepEqual(analyzeUsageImport(payload).issues, ['usage_v2_token_contract_invalid']);
  }

  for (const invalidValue of [null, '1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = analyzeUsageImport(v2Payload(detail(v2Tokens({ input_tokens: invalidValue }))));
    assert.deepEqual(result.issues, ['usage_v2_token_contract_invalid']);
  }

  for (const missingTokensValue of [undefined, null]) {
    const payload = v2Payload(detail(v2Tokens()));
    const importedDetail =
      payload.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0];
    if (missingTokensValue === undefined) delete importedDetail.tokens;
    else importedDetail.tokens = missingTokensValue;
    assert.deepEqual(analyzeUsageImport(payload).issues, ['usage_v2_token_contract_invalid']);
  }

  const emptyTokens = v2Payload(detail(v2Tokens()));
  emptyTokens.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].tokens = {};
  assert.deepEqual(analyzeUsageImport(emptyTokens).issues, ['usage_v2_token_contract_invalid']);
});

test('v2 enforces canonical cache mirrors, input coverage, totals, and retired-field rejection', () => {
  const invalidTokens = [
    { cached_tokens: 3, cache_read_tokens: 0 },
    { input_tokens: 3, cached_tokens: 3, cache_read_tokens: 3, cache_creation_tokens: 1 },
    { input_tokens: 12, output_tokens: 3, total_tokens: 14 },
    { input_tokens: 0, output_tokens: 0, reasoning_tokens: 1, cached_tokens: 0, total_tokens: 0 },
    {
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: 1,
      cached_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: Number.MAX_SAFE_INTEGER,
    },
    {
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: 0,
      cached_tokens: Number.MAX_SAFE_INTEGER,
      cache_read_tokens: Number.MAX_SAFE_INTEGER,
      cache_creation_tokens: 1,
      total_tokens: Number.MAX_SAFE_INTEGER,
    },
    { uncached_input_tokens: 9 },
  ];

  for (const overrides of invalidTokens) {
    assert.deepEqual(analyzeUsageImport(v2Payload(detail(v2Tokens(overrides)))).issues, [
      'usage_v2_token_contract_invalid',
    ]);
  }
});

test('v1 safe matrix accepts markerless no-cache details and rejects markerless cache ambiguity', () => {
  assert.equal(analyzeUsageImport(v1Payload(detail(v1Tokens()))).valid, true);

  for (const cacheTokens of [
    { cached_tokens: 1 },
    { cache_read_tokens: 1, cached_tokens: 1 },
    { cache_creation_tokens: 1 },
  ]) {
    const result = analyzeUsageImport(v1Payload(detail(v1Tokens(cacheTokens))));
    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, ['usage_v1_cache_semantics_ambiguous']);
  }
});

test('v1 treats omitted legacy zero reasoning and cached fields as zero', () => {
  const markerless = analyzeUsageImport(
    v1Payload(detail({ input_tokens: 10, output_tokens: 1, total_tokens: 11 }))
  );
  assert.equal(markerless.valid, true);

  const markerBearing = v1Payload(
    detail({
      input_tokens: 3085,
      output_tokens: 253,
      cache_read_tokens: 7,
      cache_creation_tokens: 19514,
      uncached_input_tokens: 3085,
      total_tokens: 22859,
    })
  );
  const canonicalCurrent = v2Payload(
    detail(
      v2Tokens({
        input_tokens: 22606,
        output_tokens: 253,
        cached_tokens: 7,
        cache_read_tokens: 7,
        cache_creation_tokens: 19514,
        total_tokens: 22859,
      })
    )
  ).usage;
  const projected = analyzeUsageImport(markerBearing, canonicalCurrent);
  assert.equal(projected.valid, true);
  assert.equal(projected.overlapCount, 1);
});

test('v1 validates legacy required fields and uncached marker bounds before canonical migration', () => {
  const valid = analyzeUsageImport(
    v1Payload(
      detail(
        v1Tokens({
          input_tokens: 12,
          output_tokens: 2,
          cached_tokens: 3,
          cache_read_tokens: 3,
          uncached_input_tokens: 9,
          total_tokens: 14,
        })
      )
    )
  );
  assert.equal(valid.valid, true);

  for (const marker of [null, '9', -1, 13, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = analyzeUsageImport(
      v1Payload(
        detail(
          v1Tokens({
            input_tokens: 12,
            cached_tokens: 3,
            cache_read_tokens: 3,
            uncached_input_tokens: marker,
            total_tokens: 14,
          })
        )
      )
    );
    assert.deepEqual(result.issues, ['usage_v1_token_contract_invalid']);
  }

  for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) {
    const missingField = v1Payload(detail(v1Tokens()));
    delete missingField.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].tokens[
      field
    ];
    assert.deepEqual(analyzeUsageImport(missingField).issues, [
      'usage_v1_token_contract_invalid',
    ]);
  }
});

test('v1 released marker fixtures project to the same canonical v2 identities', () => {
  const cases = [
    {
      name: 'cache read',
      legacy: {
        input_tokens: 100,
        output_tokens: 10,
        uncached_input_tokens: 80,
        cached_tokens: 20,
        cache_read_tokens: 20,
        total_tokens: 110,
      },
      canonical: {
        input_tokens: 100,
        output_tokens: 10,
        cached_tokens: 20,
        cache_read_tokens: 20,
        total_tokens: 110,
      },
    },
    {
      name: 'cache creation alias',
      legacy: {
        input_tokens: 1_200,
        output_tokens: 10,
        uncached_input_tokens: 176,
        cached_tokens: 1_024,
        cache_read_tokens: 0,
        cache_creation_tokens: 1_024,
        total_tokens: 1_210,
      },
      canonical: {
        input_tokens: 1_200,
        output_tokens: 10,
        cached_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 1_024,
        total_tokens: 1_210,
      },
    },
    {
      name: 'cache read and creation',
      legacy: {
        input_tokens: 100,
        output_tokens: 10,
        uncached_input_tokens: 70,
        cached_tokens: 20,
        cache_read_tokens: 20,
        cache_creation_tokens: 10,
        total_tokens: 110,
      },
      canonical: {
        input_tokens: 100,
        output_tokens: 10,
        cached_tokens: 20,
        cache_read_tokens: 20,
        cache_creation_tokens: 10,
        total_tokens: 110,
      },
    },
    {
      name: 'known zero',
      legacy: {
        input_tokens: 0,
        output_tokens: 0,
        uncached_input_tokens: 0,
        cached_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 0,
      },
      canonical: {
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 0,
      },
    },
  ];

  for (const fixture of cases) {
    const imported = v1Payload(detail(v1Tokens(fixture.legacy)));
    const current = v2Payload(detail(v2Tokens(fixture.canonical))).usage;
    const result = analyzeUsageImport(imported, current);
    assert.equal(result.valid, true, fixture.name);
    assert.equal(result.overlapCount, 1, fixture.name);
  }
});

test('released Core v1 current usage projects to canonical v2 overlap identity', () => {
  const releasedCurrent = v1Payload(
    detail(
      v1Tokens({
        input_tokens: 3085,
        output_tokens: 253,
        cached_tokens: 7,
        cache_read_tokens: 7,
        cache_creation_tokens: 19514,
        uncached_input_tokens: 3085,
        total_tokens: 22859,
      })
    )
  ).usage;
  const candidateImport = v2Payload(
    detail(
      v2Tokens({
        input_tokens: 22606,
        output_tokens: 253,
        cached_tokens: 7,
        cache_read_tokens: 7,
        cache_creation_tokens: 19514,
        total_tokens: 22859,
      })
    )
  );

  const result = analyzeUsageImport(candidateImport, releasedCurrent);
  assert.equal(result.valid, true);
  assert.equal(result.currentUsageAvailable, true);
  assert.equal(result.overlapCount, 1);
});

test('v1 migration recognizes the released cache-creation alias without double counting', () => {
  const imported = v1Payload(
    detail(
      v1Tokens({
        input_tokens: 1_200,
        output_tokens: 10,
        uncached_input_tokens: 176,
        cached_tokens: 1_024,
        cache_read_tokens: 0,
        cache_creation_tokens: 1_024,
        total_tokens: 1_210,
      })
    )
  );
  const current = v2Payload(
    detail(
      v2Tokens({
        input_tokens: 1_200,
        output_tokens: 10,
        cached_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 1_024,
        total_tokens: 1_210,
      })
    )
  ).usage;

  const result = analyzeUsageImport(imported, current);
  assert.equal(result.valid, true);
  assert.equal(result.overlapCount, 1);
});

test('missing timestamps remain legacy-compatible while invalid timestamps fail shape validation', () => {
  const missingV1 = v1Payload(detail(v1Tokens()));
  delete missingV1.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].timestamp;
  assert.equal(analyzeUsageImport(missingV1).valid, true);

  const missingV2 = v2Payload(detail(v2Tokens()));
  delete missingV2.usage.apis['POST /v1/responses'].models['gpt-5.6-sol'].details[0].timestamp;
  assert.equal(analyzeUsageImport(missingV2).valid, true);

  for (const invalidTimestamp of ['not-a-timestamp', '2026-02-30T12:00:00Z']) {
    assert.deepEqual(
      analyzeUsageImport(v1Payload(detail(v1Tokens(), { timestamp: invalidTimestamp }))).issues,
      ['usage_shape_invalid']
    );
    assert.deepEqual(
      analyzeUsageImport(v2Payload(detail(v2Tokens(), { timestamp: invalidTimestamp }))).issues,
      ['usage_shape_invalid']
    );
  }
  assert.deepEqual(analyzeUsageImport(v1Payload(detail(v1Tokens(), { timestamp: 7 }))).issues, [
    'usage_shape_invalid',
  ]);
});

test('canonical identity mirrors v1 migration and RFC3339 UTC normalization', () => {
  const first = detail(
    v1Tokens({
      input_tokens: 12,
      output_tokens: 2,
      cached_tokens: 3,
      uncached_input_tokens: 9,
      total_tokens: 14,
    }),
    { timestamp: '2026-07-10T20:00:00.123456789+08:00' }
  );
  const second = detail(
    v1Tokens({
      input_tokens: 10,
      output_tokens: 2,
      cached_tokens: 3,
      uncached_input_tokens: 9,
      total_tokens: 14,
    }),
    { timestamp: '2026-07-10T12:00:00.123456789Z' }
  );
  const current = v2Payload(detail(v2Tokens())).usage;

  const result = analyzeUsageImport(v1Payload(first, second), current);
  assert.equal(result.valid, true);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.overlapCount, 1);
});

test('missing, null, and Go zero timestamps are uncertain and excluded from identity checks', () => {
  const missing = detail(v1Tokens());
  delete missing.timestamp;
  const nullTimestamp = detail(v1Tokens(), { timestamp: null });
  const goZeroTimestamp = detail(v1Tokens(), { timestamp: '0001-01-01T00:00:00Z' });

  const result = analyzeUsageImport(
    v1Payload(missing, nullTimestamp, goZeroTimestamp),
    v2Payload(detail(v2Tokens())).usage
  );
  assert.equal(result.valid, true);
  assert.equal(result.uncertainIdentityCount, 3);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.overlapCount, 0);
});

test('RFC3339 fractional seconds mirror Go RFC3339Nano identity normalization', () => {
  const wholeSecond = detail(v1Tokens(), { timestamp: '2026-07-10T12:00:00Z' });
  const zeroFraction = detail(v1Tokens(), { timestamp: '2026-07-10T12:00:00.000Z' });
  const nanoseconds = detail(v1Tokens(), { timestamp: '2026-07-10T12:00:01.123456789Z' });
  const beyondNanoseconds = detail(v1Tokens(), {
    timestamp: '2026-07-10T12:00:01.1234567899Z',
  });
  const zeroTimeWithFraction = detail(v1Tokens(), {
    timestamp: '0001-01-01T00:00:00.000Z',
  });

  const result = analyzeUsageImport(
    v1Payload(wholeSecond, zeroFraction, nanoseconds, beyondNanoseconds, zeroTimeWithFraction)
  );
  assert.equal(result.valid, true);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.uncertainIdentityCount, 1);
});

test('v1 canonical projection fails closed when its token sum is not safely representable', () => {
  const result = analyzeUsageImport(
    v1Payload(
      detail(
        v1Tokens({
          input_tokens: Number.MAX_SAFE_INTEGER,
          output_tokens: 0,
          uncached_input_tokens: Number.MAX_SAFE_INTEGER,
          cached_tokens: 1,
          cache_read_tokens: 1,
          total_tokens: Number.MAX_SAFE_INTEGER,
        })
      )
    )
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, ['usage_v1_token_contract_invalid']);
});

test('preflight analysis never mutates the uploaded snapshot', () => {
  const payload = v1Payload(
    detail(
      v1Tokens({
        input_tokens: 12,
        output_tokens: 2,
        cached_tokens: 3,
        uncached_input_tokens: 9,
        total_tokens: 14,
      })
    )
  );
  const before = clone(payload);

  analyzeUsageImport(payload, v2Payload(detail(v2Tokens())).usage);

  assert.deepEqual(payload, before);
});

test('receipt decoder is strict on known fields and ignores unknown additions', () => {
  const decoded = decodeUsageImportReceipt({
    added: 1,
    skipped: 2,
    total_requests: 7,
    failed_requests: 1,
    schema_version: 2,
    migrated_from_version: 1,
    migration: 'v1_uncached_input_tokens_to_v2',
    future_receipt_field: { retained_by_core: true },
  });

  assert.deepEqual(decoded, {
    added: 1,
    skipped: 2,
    total_requests: 7,
    failed_requests: 1,
    schema_version: 2,
    migrated_from_version: 1,
    migration: 'v1_uncached_input_tokens_to_v2',
  });
  assert.equal(isMigratedV1UsageImportReceipt(decoded), true);

  const releasedCoreReceipt = decodeUsageImportReceipt({
    added: 1,
    skipped: 0,
    total_requests: 1,
    failed_requests: 0,
    released_core_extension: true,
  });
  assert.deepEqual(releasedCoreReceipt, {
    added: 1,
    skipped: 0,
    total_requests: 1,
    failed_requests: 0,
  });
  assert.equal(isMigratedV1UsageImportReceipt(releasedCoreReceipt), false);

  assert.equal(
    decodeUsageImportReceipt({
      added: 1,
      skipped: 0,
      total_requests: 1,
      failed_requests: 0,
      schema_version: 1,
    }),
    null
  );
  assert.equal(
    decodeUsageImportReceipt({
      added: 1,
      skipped: 0,
      total_requests: 1,
      failed_requests: 0,
      schema_version: 2,
      migrated_from_version: 1,
    }),
    null
  );
  assert.equal(
    decodeUsageImportReceipt({
      added: 1,
      skipped: 0,
      total_requests: 1,
      failed_requests: 0,
      migrated_from_version: 1,
      migration: 'v1_uncached_input_tokens_to_v2',
    }),
    null
  );
});

test('stable Core error decoder recognizes only the six approved top-level codes', () => {
  assert.deepEqual(USAGE_IMPORT_ERROR_CODES, [
    'usage_version_unsupported',
    'usage_shape_invalid',
    'usage_v1_token_contract_invalid',
    'usage_v1_cache_semantics_ambiguous',
    'usage_v2_token_contract_invalid',
    'usage_aggregate_overflow',
  ]);

  for (const code of USAGE_IMPORT_ERROR_CODES) {
    assert.equal(getUsageImportErrorCode({ data: { error: 'localized by Panel', code } }), code);
    assert.equal(getUsageImportErrorCode({ details: { code } }), code);
    assert.equal(getUsageImportErrorTranslationKey(code), `usage_stats.import_error_${code}`);
  }
  assert.equal(getUsageImportErrorCode({ data: { code: 'future_usage_error' } }), null);
  assert.equal(getUsageImportErrorCode({ code: 'ERR_BAD_REQUEST' }), null);
});
