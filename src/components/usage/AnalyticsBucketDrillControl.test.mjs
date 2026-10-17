import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const [{ AnalyticsBucketDrillControl }, { default: i18n }] = await Promise.all([
  vite.ssrLoadModule('/src/components/usage/AnalyticsBucketDrillControl.tsx'),
  vite.ssrLoadModule('/src/i18n/index.ts'),
]);
await i18n.changeLanguage('en');
test.after(async () => { await vite.close(); globalThis.window = originalWindow; });
const start = Date.parse('2026-10-17T01:00:00Z');
const render = (props = {}) => renderToStaticMarkup(createElement(AnalyticsBucketDrillControl, {
  id: 'latency', times: [start, start + 3600000], grain: 'hour', onOpen() {}, ...props,
}));

test('keyboard control has an explicit unselected option and disabled action initially', () => {
  const html = render();
  assert.match(html, /data-testid="analytics-latency-bucket"/);
  assert.match(html, /<option value="" selected="">Select a time bucket<\/option>/);
  assert.match(html, /<label/);
  assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="analytics-latency-bucket-open"/);
});

test('choices include the date and timezone, and omit out-of-window buckets', () => {
  const html = render({ window: { startMs: start + 1, endMs: start + 2000 } });
  assert.match(html, /2026/);
  assert.ok(html.includes(`value="${start}"`));
  assert.ok(!html.includes(`value="${start + 3600000}"`));
});

test('all trend cards use the same control with a grain-specific lifecycle', async () => {
  for (const file of ['LatencyTrendChart', 'ThroughputTrendChart', 'CacheEfficiencyCard', 'ErrorAnalysisCard']) {
    const source = await readFile(new URL(`./${file}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /<AnalyticsBucketDrillControl\s+key=\{period\}/);
    assert.doesNotMatch(source, /selectedBucket/);
    assert.match(source, /aria-pressed=\{period === 'hour'\}/);
    assert.match(source, /aria-pressed=\{period === 'day'\}/);
  }
});
