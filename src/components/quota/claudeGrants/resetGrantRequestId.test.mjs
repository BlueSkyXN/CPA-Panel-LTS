import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { generateResetGrantRequestId } = await vite.ssrLoadModule('/src/components/quota/claudeGrants/resetGrantRequestId.ts');
const { ANTHROPIC_RESET_REQUEST_ID_RE } = await vite.ssrLoadModule('/src/services/api/claudeResetGrants.ts');
test.after(() => vite.close());

/**
 * @typedef {Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>} RandomSource
 */

/**
 * @param {unknown} source
 * @param {() => void} run
 */
function withGlobalCrypto(source, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: source });
    run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
}

test('native randomUUID takes priority and preserves its crypto receiver', () => {
  const uuid = '01234567-89ab-4cde-8fab-0123456789ab';
  let nativeCalls = 0;
  /** @type {RandomSource} */
  const source = {
    randomUUID() {
      assert.equal(this, source);
      nativeCalls++;
      return uuid;
    },
    getRandomValues() {
      throw new Error('fallback random source must not be called');
    },
  };
  assert.equal(generateResetGrantRequestId(source), uuid);
  assert.match(generateResetGrantRequestId(source), ANTHROPIC_RESET_REQUEST_ID_RE);
  assert.equal(nativeCalls, 2);
});

test('fallback fills exactly 16 bytes and preserves zero-padded lowercase hexadecimal', () => {
  let randomCalls = 0;
  /** @type {RandomSource} */
  const source = {
    getRandomValues(bytes) {
      assert.equal(this, source);
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(bytes.byteLength, 16);
      bytes.set([0, 1, 2, 15, 16, 31, 127, 128, 255, 254, 32, 64, 3, 4, 5, 6]);
      randomCalls++;
      return bytes;
    },
  };
  const requestId = generateResetGrantRequestId(source);
  assert.equal(requestId, '0001020f101f7f80fffe204003040506');
  assert.match(requestId, /^[0-9a-f]{32}$/);
  assert.match(requestId, ANTHROPIC_RESET_REQUEST_ID_RE);
  assert.equal(randomCalls, 1);
});

test('a source without either secure capability fails with fixed safe error text', () => {
  for (const source of [{}, { randomUUID: undefined, getRandomValues: undefined }]) {
    assert.throws(() => generateResetGrantRequestId(source), {
      message: 'Secure random source is unavailable',
    });
  }
});

test('default source is read from global crypto at call time, not module import time', () => {
  const firstUuid = '01234567-89ab-4cde-8fab-0123456789ab';
  const secondUuid = 'fedcba98-7654-4321-8abc-fedcba987654';
  withGlobalCrypto({ randomUUID: () => firstUuid }, () => {
    assert.equal(generateResetGrantRequestId(), firstUuid);
  });
  withGlobalCrypto({ randomUUID: () => secondUuid }, () => {
    assert.equal(generateResetGrantRequestId(), secondUuid);
    assert.equal(generateResetGrantRequestId(undefined), secondUuid);
  });
});

test('missing global crypto refuses generation without insecure randomness', () => {
  withGlobalCrypto(undefined, () => {
    assert.throws(() => generateResetGrantRequestId(), {
      message: 'Secure random source is unavailable',
    });
  });
});

test('native randomUUID failure is not hidden by switching to a different source', () => {
  const failure = new Error('native secure random source failed');
  let fallbackCalls = 0;
  assert.throws(
    () =>
      generateResetGrantRequestId({
        randomUUID() {
          throw failure;
        },
        getRandomValues() {
          fallbackCalls++;
          throw new Error('fallback random source must not be called');
        },
      }),
    (error) => error === failure
  );
  assert.equal(fallbackCalls, 0);
});

test('getRandomValues failure does not produce a request ID', () => {
  const failure = new Error('secure random fill failed');
  assert.throws(
    () =>
      generateResetGrantRequestId({
        getRandomValues() {
          throw failure;
        },
      }),
    (error) => error === failure
  );
});
