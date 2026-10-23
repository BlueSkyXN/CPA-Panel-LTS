import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./proxyProbe.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { interpretProxyProbe, proxyProbeErrorCode } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('a reachable probe is success and direct is a skipped success', () => {
  assert.deepEqual(interpretProxyProbe({ status: 'ok', code: 'reachable' }), {
    state: 'success',
    code: 'reachable',
  });
  assert.deepEqual(interpretProxyProbe({ status: 'skipped', code: 'direct' }), {
    state: 'success',
    code: 'direct',
  });
});

test('known probe failures keep their code and unknown payloads fall back', () => {
  assert.deepEqual(interpretProxyProbe({ status: 'error', code: 'proxy_auth_failed' }), {
    state: 'error',
    code: 'proxy_auth_failed',
  });
  assert.deepEqual(interpretProxyProbe({ status: 'ok', code: 'something-else' }), {
    state: 'error',
    code: 'probe_failed',
  });
  assert.deepEqual(interpretProxyProbe(null), { state: 'error', code: 'probe_failed' });
});

test('missing probe endpoints are reported as unsupported instead of a transport failure', () => {
  assert.equal(proxyProbeErrorCode({ status: 404, message: 'not found' }), 'unsupported');
  assert.equal(proxyProbeErrorCode({ status: 405 }), 'unsupported');
  assert.equal(
    proxyProbeErrorCode({ status: 502, details: { code: 'tls_failed' } }),
    'tls_failed'
  );
  assert.equal(proxyProbeErrorCode({ code: 'ECONNABORTED', message: 'timeout' }), 'timeout');
  assert.equal(proxyProbeErrorCode(new Error('socket hang up')), 'probe_failed');
});
