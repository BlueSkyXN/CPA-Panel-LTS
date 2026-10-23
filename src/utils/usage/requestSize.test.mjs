import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
test.after(() => vite.close());
const { extractRequestSize, isLargeRequestConnectFailure, upstreamPayloadBytes, LARGE_REQUEST_BYTES } =
  await vite.ssrLoadModule('/src/utils/usage/requestSize.ts');
const { collectUsageDetails } = await vite.ssrLoadModule('/src/utils/usage.ts');

test('extractRequestSize trusts size fields only for size_version 1', () => {
  const raw = {
    trace_id: ' t-1 ',
    size_version: 1,
    client_request_bytes: 120,
    client_request_encoding: 'ZSTD',
    upstream_transport: 'websocket',
    upstream_request_bytes: 272,
    upstream_request_wire_bytes: 204,
    upstream_request_encoding: 'zstd',
    upstream_response_bytes: 0,
  };
  assert.deepEqual(extractRequestSize(raw), {
    trace_id: 't-1',
    size_version: 1,
    client_request_bytes: 120,
    client_request_encoding: 'zstd',
    upstream_transport: 'websocket',
    upstream_request_bytes: 272,
    upstream_request_wire_bytes: 204,
    upstream_request_encoding: 'zstd',
  });
  assert.deepEqual(extractRequestSize({ ...raw, size_version: 2 }), { trace_id: 't-1' });
  assert.deepEqual(extractRequestSize({}), {});
  assert.deepEqual(
    extractRequestSize({ size_version: 1, upstream_transport: 'grpc', upstream_request_bytes: -1, trace_id: 'a/b' }),
    { size_version: 1 }
  );
});

test('payload size falls back to wire size and drives the large connect failure hint', () => {
  assert.equal(upstreamPayloadBytes({ upstream_request_wire_bytes: 10 }), 10);
  assert.equal(upstreamPayloadBytes({ upstream_request_bytes: 20, upstream_request_wire_bytes: 10 }), 20);
  assert.equal(upstreamPayloadBytes({}), null);
  const failure = { failed: true, failure_reason: 'upstream_connect_failure', upstream_request_bytes: LARGE_REQUEST_BYTES };
  assert.equal(isLargeRequestConnectFailure(failure), true);
  assert.equal(isLargeRequestConnectFailure({ ...failure, upstream_request_bytes: LARGE_REQUEST_BYTES - 1 }), false);
  assert.equal(isLargeRequestConnectFailure({ ...failure, failed: false }), false);
  assert.equal(isLargeRequestConnectFailure({ ...failure, failure_reason: 'connection_reset' }), false);
  assert.equal(isLargeRequestConnectFailure({ failed: true, failure_reason: 'upstream_connect_failure' }), false);
});

test('usage details carry request size fields from the Core export', () => {
  const usage = {
    apis: {
      'POST /v1/responses': {
        models: {
          'gpt-6-astra': {
            details: [
              {
                timestamp: '2026-10-11T21:15:30+08:00',
                source: 'k',
                auth_index: '1',
                tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                failed: false,
                size_version: 1,
                upstream_transport: 'websocket',
                upstream_request_bytes: 1080631,
              },
              {
                timestamp: '2026-10-11T21:15:31+08:00',
                source: 'k',
                auth_index: '1',
                tokens: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                failed: false,
              },
            ],
          },
        },
      },
    },
  };
  const [sized, plain] = collectUsageDetails(usage);
  assert.equal(sized.upstream_transport, 'websocket');
  assert.equal(sized.upstream_request_bytes, 1080631);
  assert.equal(sized.size_version, 1);
  assert.equal(plain.size_version, undefined);
  assert.equal(plain.upstream_transport, undefined);
});
