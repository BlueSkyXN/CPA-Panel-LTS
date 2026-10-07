import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ resolveFullUsageStatus }, { normalizeConfigResponse }, adapters, { indexUsageDetailsByAuthIndex, indexUsageDetailsBySource }] =
  await Promise.all([
    vite.ssrLoadModule('/src/features/providers/fullUsageStatus.ts'),
    vite.ssrLoadModule('/src/services/api/transformers.ts'),
    vite.ssrLoadModule('/src/features/providers/adapters.ts'),
    vite.ssrLoadModule('/src/utils/usageIndex.ts'),
  ]);
test.after(() => vite.close());

const detail = (authIndex, failed, minutesAgo = 1) => ({
  timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  source: 'synthetic-source',
  auth_index: authIndex,
  tokens: { input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, cached_tokens: 0, total_tokens: 2 },
  failed,
});

test('Workbench status bars use full usage attributed by the v8 auth_index', () => {
  const config = normalizeConfigResponse({
    'api-keys': {
      gemini: [
        {
          name: 'gemini-1',
          keys: [
            { 'api-key': 'synthetic-a', auth_index: 'auth-a' },
            { 'api-key': 'synthetic-b', auth_index: 'auth-b' },
          ],
        },
      ],
      'openai-compatibility': [
        {
          name: 'compat',
          'base-url': 'https://compat.invalid/v1',
          keys: [{ 'api-key': 'synthetic-c', auth_index: 'auth-c' }],
        },
      ],
    },
  });
  const usageDetails = [detail('auth-a', false), detail('auth-a', true), detail('auth-b', false), detail('auth-c', false)];
  const usage = {
    keyStats: {
      bySource: {},
      byAuthIndex: {
        'auth-a': { success: 1, failure: 1 },
        'auth-b': { success: 1, failure: 0 },
        'auth-c': { success: 1, failure: 0 },
      },
    },
    usageDetailsBySource: indexUsageDetailsBySource(usageDetails),
    usageDetailsByAuthIndex: indexUsageDetailsByAuthIndex(usageDetails),
  };

  const a = resolveFullUsageStatus(adapters.geminiToResource(config.geminiApiKeys[0], 0), usage);
  assert.deepEqual(a.stats, { success: 1, failure: 1 });
  assert.equal(a.statusData.totalSuccess, 1);
  assert.equal(a.statusData.totalFailure, 1);

  const b = resolveFullUsageStatus(adapters.geminiToResource(config.geminiApiKeys[1], 1), usage);
  assert.deepEqual(b.stats, { success: 1, failure: 0 });
  assert.equal(b.statusData.totalFailure, 0);

  const c = resolveFullUsageStatus(adapters.openaiToResource(config.openaiCompatibility[0], 0), usage);
  assert.deepEqual(c.stats, { success: 1, failure: 0 });
  assert.equal(c.statusData.totalSuccess, 1);
});
