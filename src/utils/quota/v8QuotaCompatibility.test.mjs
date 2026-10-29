import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
const oldWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { buildKimiQuotaRows, mergeXaiBillingSummaries } = await vite.ssrLoadModule(
  '/src/utils/quota/builders.ts'
);
const { parseKimiQuotaUrl, resolveKimiQuotaUrl } = await vite.ssrLoadModule(
  '/src/services/api/kimiQuota.ts'
);
const { isKimiFile } = await vite.ssrLoadModule('/src/utils/quota/validators.ts');
const { CLAUDE_CONFIG } = await vite.ssrLoadModule('/src/components/quota/quotaConfigs.ts');
const { apiCallApi } = await vite.ssrLoadModule('/src/services/api/apiCall.ts');
const { authFilesApi } = await vite.ssrLoadModule('/src/services/api/authFiles.ts');
const { apiClient } = await vite.ssrLoadModule('/src/services/api/client.ts');
const oldRequest = apiCallApi.request;
const oldDownload = authFilesApi.downloadText;
test.after(async () => {
  apiCallApi.request = oldRequest;
  authFilesApi.downloadText = oldDownload;
  globalThis.window = oldWindow;
  await vite.close();
});

test('Kimi monthly ratio is independent and invalid/missing values never appear as zero', () => {
  assert.equal(
    buildKimiQuotaRows({ usages: { limit_month_total: { used_ratio: '0.25' } } })[0].used,
    25
  );
  assert.equal(buildKimiQuotaRows({ usages: { limit_month_total: { used_ratio: 0 } } })[0].used, 0);
  for (const value of [undefined, null, '', false, NaN, -1, 1.1]) {
    assert.equal(
      buildKimiQuotaRows({ usages: { limit_month_total: { used_ratio: value } } }).length,
      0
    );
  }
});

test('Kimi URL resolution follows explicit domain, canonical base URL, then credential type', () => {
  const file = { name: 'kimi-ai-synthetic.json', provider: 'kimi-ai' };
  const url = (value) => parseKimiQuotaUrl(JSON.stringify(value), file);
  assert.equal(url({ type: 'kimi-ai' }), 'https://api.kimi.ai/coding/v1/usages');
  assert.equal(url({ domain: 'com', type: 'kimi-ai' }), 'https://api.kimi.com/coding/v1/usages');
  assert.equal(
    url({ base_url: 'https://api.kimi.com', type: 'kimi-ai' }),
    'https://api.kimi.com/coding/v1/usages'
  );
  assert.equal(
    url({ base_url: null, 'base-url': 'https://api.kimi.com', type: 'kimi-ai' }),
    'https://api.kimi.ai/coding/v1/usages'
  );
  assert.equal(
    url({ base_url: 'https://untrusted.invalid', type: 'kimi-ai' }),
    'https://api.kimi.ai/coding/v1/usages'
  );
  assert.throws(
    () => parseKimiQuotaUrl('{synthetic-invalid', file),
    (error) => !error.message.includes('synthetic-invalid')
  );
  assert.equal(isKimiFile({ provider: 'kimi_ai' }), true);
});

test('Kimi credential download cannot continue on a different connection', async () => {
  apiClient.setConfig({ apiBase: 'https://old.invalid', managementKey: 'synthetic' });
  authFilesApi.downloadText = async () => {
    apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'synthetic' });
    return '{}';
  };
  await assert.rejects(
    resolveKimiQuotaUrl({ name: 'synthetic.json', provider: 'kimi' }),
    /connection changed/
  );
});

test('xAI unknown weekly usage does not borrow monthly percentages', () => {
  const base = { productUsage: [], historyCount: 0 };
  const weekly = { ...base, periodType: 'weekly', usagePercent: null, periodStart: 'week-start' };
  const monthly = { ...base, periodType: 'monthly', usagePercent: 40, periodStart: 'month-start' };
  const result = mergeXaiBillingSummaries(weekly, monthly);
  assert.equal(result.periodType, 'weekly');
  assert.equal(result.usagePercent, null);
  assert.equal(result.periodStart, 'week-start');
});

test('Claude active Team organization takes precedence over account subscription flags', async () => {
  apiCallApi.request = async ({ url }) => ({
    statusCode: 200,
    body: url.endsWith('/profile')
      ? {
          account: { has_claude_max: true, has_claude_pro: true },
          organization: { organization_type: 'claude_team', subscription_status: 'active' },
        }
      : { five_hour: { utilization: 10 } },
  });
  const result = await CLAUDE_CONFIG.fetchQuota(
    { name: 'synthetic.json', auth_index: 'synthetic-index' },
    (key) => key
  );
  assert.equal(result.planType, 'plan_team');
});
