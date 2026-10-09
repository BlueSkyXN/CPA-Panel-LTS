import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createServer } from 'vite';
const originalWindow = globalThis.window; globalThis.window = new EventTarget();
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const helpers = await vite.ssrLoadModule('/src/utils/usage/analyticsFilters.ts');
const { buildUsageAnalytics } = await vite.ssrLoadModule('/src/utils/usage/analyticsModel.ts');
const cache = await vite.ssrLoadModule('/src/stores/usageAnalyticsCache.ts');
const { usageAnalyticsApi } = await vite.ssrLoadModule('/src/services/api/usageAnalytics.ts');
const { usageQueryApi } = await vite.ssrLoadModule('/src/services/api/usageQuery.ts');
const { useAuthStore } = await vite.ssrLoadModule('/src/stores/useAuthStore.ts');
const originalQuery = usageAnalyticsApi.query, originalDetails = usageQueryApi.details;
const source = await readFile(new URL('./useUsageAnalytics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const session = { version: 1, bound: 'synthetic', now_ms: 10000, max_page_size: 200, models: ['a'], analytics_version: 1 };
const window = { startMs: 1000, endMs: 10000 };
const options = { models: ['a'], identities: [{ source: 'synthetic-source', auth_index: '1' }] };
const result = (q) => ({ version: 1, analytics_version: 1, bound: q.bound, now_ms: q.now_ms, from_ms: q.from_ms ?? null, to_ms: q.to_ms ?? null, timezone: q.timezone, total: 0, analyzed: 0, options, data: buildUsageAnalytics([], null) });
const tick = () => new Promise(resolve => setImmediate(resolve));
let requests;
test.beforeEach(() => {
  cache.clearUsageAnalyticsCache(); requests = [];
  usageAnalyticsApi.query = async (q) => { requests.push(q); return result(q); };
  usageQueryApi.details = async () => { throw new Error('Unexpected detail request'); };
});
test.after(async () => { cache.clearUsageAnalyticsCache(); usageAnalyticsApi.query = originalQuery; usageQueryApi.details = originalDetails; await vite.close(); globalThis.window = originalWindow; });
async function harness() {
  const slots = []; let index = 0; let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    ...helpers, ...cache, buildUsageAnalytics, usageQueryApi,
    useAuthStore: (selector) => selector(useAuthStore.getState()),
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
    useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const key = `__aggregateHook${Math.random().toString(36).slice(2)}`; globalThis[key] = hooks;
  const code = compiled.replace(/import \{([^;]+)\} from [^;]+;/g, (_, names) => `const {${names}}=globalThis.${key};`);
  const { useUsageAnalytics } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`); delete globalThis[key];
  return { render(s = session, w = window, f = {}, active = true, enabled = true, range = '24h') { index = 0; effects = []; const r = useUsageAnalytics(s, w, f, active, enabled, range); for (const effect of effects) effect(); return r; }, close() { for (const slot of slots) slot.cleanup?.(); } };
}
test('first load aggregates once; remount and source selection reuse cached options', async () => {
  const a = await harness(); a.render(); await tick(); assert.equal(a.render().result.total, 0); a.close();
  const b = await harness(); assert.ok(b.render().result); await tick(); assert.equal(requests.length, 1);
  const f = { model: 'a', source: { value: 'source:synthetic', label: 'Synthetic', identities: [{ source: 't:synthetic-source', auth_index: '1' }] } };
  b.render(session, window, f); await tick(); assert.equal(requests.length, 2); assert.deepEqual(requests[1].filter, { model: 'a', identities: options.identities }); b.close();
  const c = await harness(); assert.ok(c.render(session, window, f).result); await tick(); assert.equal(requests.length, 2); c.close();
});
test('refresh keeps only the same logical range and filters, and errors never fall back', async () => {
  const h = await harness(); h.render(); await tick(); h.render();
  usageAnalyticsApi.query = async () => { throw Object.assign(new Error('synthetic timeout'), { details: { code: 'usage_query_timeout' } }); };
  const next = { ...session, bound: 'next', now_ms: 11000 }, w = { startMs: 2000, endMs: 11000 };
  const pending = h.render(next, w); assert.equal(pending.stale, true); assert.equal(pending.result.bound, session.bound); await tick();
  const failed = h.render(next, w); assert.equal(failed.loading, false); assert.equal(failed.code, 'usage_query_timeout'); assert.equal(failed.result.bound, session.bound);
  assert.equal(h.render(next, w, { model: 'b' }).result, null); h.close();
});
test('inactive pages do not query and late responses after disconnect are discarded', async () => {
  const h = await harness(); h.render(session, window, {}, false); assert.equal(requests.length, 0);
  let done, signal; usageAnalyticsApi.query = (q, s) => { signal = s; return new Promise(resolve => { done = () => resolve(result(q)); }); };
  h.render(); h.close(); assert.equal(signal.aborted, true); done(); await tick();
  const next = await harness(); assert.equal(next.render(session, window, {}, false).result, null); next.close();
});
