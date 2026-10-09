import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function harness(file, respond) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const slots = []; const requests = []; let index = 0; let effects = [];
  const auth = { apiBase: 'synthetic', managementKey: 'synthetic' };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (value) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
    useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) {
      const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    useAuthStore: Object.assign((selector) => selector(auth), { getState: () => auth }),
    usageQueryApi: { async details(request, signal) { requests.push({ request, signal }); return respond(request, signal); } },
  };
  const key = `__analyticsQuery${Math.random().toString(36).slice(2)}`; globalThis[key] = hooks;
  code = code.replace(/import \{[^;]+\} from 'react';/, `const {useEffect,useMemo,useRef,useState}=globalThis.${key};`)
    .replace(/import \{ useAuthStore \} from [^;]+;/, `const {useAuthStore}=globalThis.${key};`)
    .replace(/import \{ usageQueryApi \} from [^;]+;/, `const {usageQueryApi}=globalThis.${key};`)
    .replace(/import \{\s*legacyAnalyticsOptions,?\s*\} from [^;]+;/, 'const legacyAnalyticsOptions=()=>({models:[],identities:[]});')
    .replace(/import \{ normalizeUsageSourceId \} from [^;]+;/, 'const normalizeUsageSourceId=(value)=>value;');
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key];
  const hook = module.useUsageAnalyticsOptions ?? module.useUsageQueryDetails;
  return {
    requests, auth,
    render(...args) { index = 0; effects = []; const value = hook(...args); for (const effect of effects) effect(); return value; },
    close() { for (const slot of slots) slot.cleanup?.(); },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const session = { bound: 'synthetic', now_ms: 10000, max_page_size: 100 };
const window = { startMs: 1000, endMs: 10000 };
const options = { models: ['a', 'b'], identities: [{ source: 'source', auth_index: '1' }] };

test('analytics options read the entire window metadata with one bounded detail request', async () => {
  const h = await harness('./useUsageAnalyticsOptions.ts', async () => ({ options }));
  try {
    h.render(session, null, window, true, true); await tick();
    assert.deepEqual(h.render(session, null, window, true, true).options, options);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].request.limit, 1);
    assert.equal(h.requests[0].request.include_options, true);
    assert.equal(h.requests[0].request.filter, undefined);
    assert.equal(h.requests[0].request.from_ms, 1000);
    h.render(session, null, window, false, true); h.render(session, null, window, true, true);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});

test('options failure is visible and retryable; inactive/invalid windows do not fetch', async () => {
  let fail = true;
  const h = await harness('./useUsageAnalyticsOptions.ts', async () => { if (fail) throw new Error('synthetic failure'); return { options }; });
  try {
    h.render(session, null, window, false, true); h.render(session, null, window, true, false);
    assert.equal(h.requests.length, 0);
    h.render(session, null, window, true, true); await tick();
    const failed = h.render(session, null, window, true, true);
    assert.equal(failed.error, 'synthetic failure'); assert.equal(failed.options, null);
    fail = false; failed.retry(); h.render(session, null, window, true, true); await tick();
    assert.deepEqual(h.render(session, null, window, true, true).options, options);
  } finally { h.close(); }
});

test('late metadata cannot cross windows or connections', async () => {
  let resolve;
  const h = await harness('./useUsageAnalyticsOptions.ts', () => new Promise((done) => { resolve = done; }));
  try {
    h.render(session, null, window, true, true);
    const oldResolve = resolve;
    h.auth.apiBase = 'new-synthetic';
    assert.equal(h.render(session, null, window, true, true).options, null);
    assert.equal(h.requests[0].signal.aborted, true);
    oldResolve({ options }); await tick();
    assert.equal(h.render(session, null, window, true, true).options, null);
  } finally { h.close(); }
});

const metrics = { requests: 5, tokens: 100, output_tps: { numerator: 100, denominator: 2, samples: 5 }, prices: [{ requests: 5 }] };
test('unresolved event identities never display or export unfiltered probe rows', async () => {
  const h = await harness('./useUsageQueryDetails.ts', async () => ({ bound: 'synthetic', items: [{ id: 'unrelated' }], total: 5, next_cursor: 'next', metrics, options }));
  try {
    const filter = () => null;
    h.render(session, {}, filter); await tick();
    const result = h.render(session, {}, filter);
    assert.equal(h.requests[0].request.limit, 1);
    assert.equal(result.data.total, 0); assert.deepEqual(result.data.items, []);
    assert.equal(result.data.next_cursor, ''); assert.equal(result.data.metrics.tokens, 0);
    assert.deepEqual(result.data.metrics.output_tps, { numerator: 0, denominator: 0, samples: 0 });
    assert.deepEqual(result.data.metrics.prices, []);
    assert.deepEqual(await result.exportDetails(), []);
    result.setPage(1); h.render(session, {}, filter);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});

test('event metadata resolution runs a filtered query before exposing rows', async () => {
  const h = await harness('./useUsageQueryDetails.ts', async (q) => ({ bound: 'synthetic', items: [{ id: q.filter.identities ? 'matched' : 'probe' }], total: 1, metrics, options }));
  try {
    const filter = (metadata) => metadata ? { model: 'a', identities: metadata.identities } : null;
    h.render(session, {}, filter); await tick();
    assert.equal(h.render(session, {}, filter).data, null); await tick();
    const result = h.render(session, {}, filter);
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1].request.filter, { model: 'a', identities: options.identities });
    assert.equal(result.data.items[0].id, 'matched');
  } finally { h.close(); }
});


test('a metadata probe without options is an error, not a successful empty result', async () => {
  const h = await harness('./useUsageQueryDetails.ts', async () => ({ bound: 'synthetic', items: [], total: 0, metrics }));
  try {
    const filter = () => null;
    h.render(session, {}, filter); await tick();
    const result = h.render(session, {}, filter);
    assert.equal(result.error, 'Missing usage query options');
    assert.equal(result.data, null);
  } finally { h.close(); }
});
