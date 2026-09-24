import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const {
  compactCount,
  sumTrafficFromAuthFiles,
  collectQuotaCanarySamples,
  pickQuotaCanary,
  quotaCanaryTone,
  trimVersionLabel,
} = await vite.ssrLoadModule('/src/utils/towerPulse.ts');

test.after(async () => {
  await vite.close();
});

test('compactCount keeps small numbers and scales thousands', () => {
  assert.equal(compactCount(0), '0');
  assert.equal(compactCount(-5), '0');
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(1000), '1k');
  assert.equal(compactCount(1234), '1.2k');
  assert.equal(compactCount(12345), '12.3k');
  assert.equal(compactCount(123456), '123k');
});

test('sumTrafficFromAuthFiles merges per-file recent request buckets', () => {
  const traffic = sumTrafficFromAuthFiles([
    { recentRequests: [{ success: 2, failed: 1 }, { success: 3, failed: 0 }] },
    { recentRequests: [{ success: 5, failed: 4 }] },
    {},
  ]);
  assert.deepEqual(traffic, { success: 10, failure: 5 });
  assert.deepEqual(sumTrafficFromAuthFiles([]), { success: 0, failure: 0 });
});

test('quota canary picks the lowest remaining window across providers', () => {
  const samples = collectQuotaCanarySamples({
    claude: {
      'a.json': {
        status: 'success',
        windows: [
          { id: '5h', label: '5h', usedPercent: 40, resetLabel: '' },
          { id: '7d', label: '7d', usedPercent: null, resetLabel: '' },
        ],
      },
      'broken.json': { status: 'error', windows: [], error: 'boom' },
    },
    codex: {
      'b.json': {
        status: 'success',
        windows: [{ id: 'primary', label: 'Primary', usedPercent: 80, resetLabel: '' }],
      },
    },
    geminiCli: {
      'c.json': {
        status: 'success',
        buckets: [{ id: 'day', label: 'Day', remainingFraction: 0.5, resetTime: undefined }],
      },
    },
    antigravity: {
      'd.json': {
        status: 'success',
        groups: [
          {
            id: 'g',
            label: 'G',
            buckets: [{ id: 'w', label: 'W', remainingFraction: 0.08 }],
          },
        ],
      },
    },
    kimi: {
      'e.json': {
        status: 'success',
        rows: [
          { id: 'r1', label: 'R1', used: 0, limit: 0 },
          { id: 'r2', label: 'R2', used: 30, limit: 100 },
        ],
      },
    },
  });

  const canary = pickQuotaCanary(samples);
  assert.ok(canary);
  assert.equal(canary.tag, 'antigravity');
  assert.equal(canary.file, 'd.json');
  assert.equal(canary.remainingPercent, 8);

  assert.equal(pickQuotaCanary(collectQuotaCanarySamples({
    claude: {},
    codex: {},
    geminiCli: {},
    antigravity: {},
    kimi: {},
  })), null);
});

test('quota canary tone thresholds flag warn and critical headroom', () => {
  assert.equal(quotaCanaryTone(80), null);
  assert.equal(quotaCanaryTone(24), 'warn');
  assert.equal(quotaCanaryTone(9), 'critical');
});

test('trimVersionLabel normalizes reported core versions', () => {
  assert.equal(trimVersionLabel(null), null);
  assert.equal(trimVersionLabel('  '), null);
  assert.equal(trimVersionLabel('6.9.49'), 'v6.9.49');
  assert.equal(trimVersionLabel('V6.9.49-lts'), 'v6.9.49-lts');
});
