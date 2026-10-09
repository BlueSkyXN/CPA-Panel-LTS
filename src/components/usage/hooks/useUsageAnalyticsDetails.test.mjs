import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useUsageAnalyticsDetails.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;

async function createHarness(respond = async () => ({ items: [], total: 0, next_cursor: '' })) {
  const slots = [];
  let index = 0;
  let effects = [];
  const requests = [];
  const auth = { apiBase: 'https://synthetic.invalid', managementKey: 'synthetic' };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const useAuthStore = (selector) => selector(auth);
  useAuthStore.getState = () => auth;
  const harness = {
    useAuthStore,
    useState(initial) {
      const i = index++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (value) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) {
      const i = index++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn, deps) { return harness.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = index++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
    usageQueryApi: { async details(request, signal) { requests.push({ request, signal }); return respond(request, signal); } },
  };
  const key = `__analyticsHook${Math.random().toString(36).slice(2)}`;
  globalThis[key] = harness;
  const replacements = [
    [/import \{[^;]+\} from 'react';/, `const {useCallback,useEffect,useMemo,useRef,useState}=globalThis.${key};`],
    [/import \{ useAuthStore \} from [^;]+;/, `const {useAuthStore}=globalThis.${key};`],
    [/import \{ usageQueryApi \} from [^;]+;/, `const {usageQueryApi}=globalThis.${key};`],
    [/import \{ collectUsageDetails \} from [^;]+;/, 'const collectUsageDetails=()=>[];'],
    [/import \{ queryItemDetail \} from [^;]+;/, 'const queryItemDetail=(item)=>item;'],
    [/import \{ matchesAnalyticsFilters \} from [^;]+;/, 'const matchesAnalyticsFilters=()=>true;'],
  ];
  let code = compiled;
  for (const [pattern, replacement] of replacements) { assert.match(code, pattern); code = code.replace(pattern, replacement); }
  const { useUsageAnalyticsDetails } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key];
  return {
    auth, requests,
    render(session, window, options) {
      index = 0; effects = [];
      const result = useUsageAnalyticsDetails(session, null, window, options);
      for (const effect of effects) effect();
      return result;
    },
    close() { for (const slot of slots) slot.cleanup?.(); },
  };
}

test('manual loading is scoped to connection, query bound and exact time range', async () => {
  const h = await createHarness();
  try {
    const session = { bound: 'synthetic-bound', now_ms: Date.parse('2026-10-07T00:00:00Z') };
    const window = { startMs: session.now_ms - 30 * 86400000, endMs: session.now_ms };
    let result = h.render(session, window);
    assert.equal(result.needsManualLoad, true);
    assert.equal(h.requests.length, 0);
    result.load();
    result = h.render(session, window);
    assert.equal(h.requests.length, 1);
    assert.equal(result.needsManualLoad, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.render(session, { ...window, startMs: window.startMs - 1 }).needsManualLoad, true);
    assert.equal(h.render(session, null).needsManualLoad, true);
    assert.equal(h.render({ ...session, bound: 'another-bound' }, window).needsManualLoad, true);
    h.auth.apiBase = 'https://another.invalid';
    assert.equal(h.render(session, window).needsManualLoad, true);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});

test('short windows still load automatically and stale requests are canceled', async () => {
  const h = await createHarness();
  try {
    const session = { bound: 'synthetic-bound', now_ms: Date.parse('2026-10-07T00:00:00Z') };
    const window = { startMs: session.now_ms - 3600000, endMs: session.now_ms };
    assert.equal(h.render(session, window).needsManualLoad, false);
    assert.equal(h.requests.length, 1);
    h.render(session, null);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});


const tick = () => new Promise((resolve) => setImmediate(resolve));
const session = { bound: 'sample-bound', now_ms: Date.parse('2026-10-07T00:00:00Z'), max_page_size: 100 };
const shortWindow = { startMs: session.now_ms - 3600000, endMs: session.now_ms };

test('pagination retains total and marks a partial failure until restarted', async () => {
  let fail = true;
  const h = await createHarness(async (request) => {
    if (!request.cursor) return { items: [{ id: 'first' }], total: 2, next_cursor: 'second' };
    if (fail) throw new Error('Synthetic second-page failure');
    return { items: [{ id: 'second' }], total: 2, next_cursor: '' };
  });
  try {
    h.render(session, shortWindow);
    await tick();
    let result = h.render(session, shortWindow);
    assert.equal(result.status, 'error');
    assert.equal(result.loadedCount, 1);
    assert.equal(result.totalCount, 2);
    assert.equal(h.requests[0].request.limit, 100);
    fail = false;
    result.load();
    h.render(session, shortWindow);
    await tick();
    result = h.render(session, shortWindow);
    assert.equal(result.status, 'ready');
    assert.equal(result.loadedCount, 2);
  } finally { h.close(); }
});

test('stop cancels pending work, preserves samples and discards late pages', async () => {
  let resolve;
  const h = await createHarness(async (request) => request.cursor
    ? new Promise((done) => { resolve = done; })
    : { items: [{ id: 'first' }], total: 2, next_cursor: 'second' });
  try {
    h.render(session, shortWindow);
    await tick();
    h.render(session, shortWindow).stop();
    assert.equal(h.requests[1].signal.aborted, true);
    resolve({ items: [{ id: 'late' }], total: 2, next_cursor: '' });
    await tick();
    const result = h.render(session, shortWindow);
    assert.equal(result.status, 'stopped');
    assert.equal(result.loadedCount, 1);
  } finally { h.close(); }
});

test('inactive and invalid scopes do not fetch; leaving aborts current work', async () => {
  const h = await createHarness(() => new Promise(() => {}));
  try {
    h.render(session, shortWindow, { active: false });
    h.render(session, shortWindow, { enabled: false });
    assert.equal(h.requests.length, 0);
    h.render(session, shortWindow);
    assert.equal(h.requests.length, 1);
    h.render(session, shortWindow, { active: false });
    assert.equal(h.requests[0].signal.aborted, true);
  } finally { h.close(); }
});


test('visibility changes preserve completed and explicitly stopped loads', async () => {
  const h = await createHarness();
  try {
    h.render(session, shortWindow);
    await tick();
    assert.equal(h.render(session, shortWindow).status, 'ready');
    h.render(session, shortWindow, { active: false });
    h.render(session, shortWindow);
    assert.equal(h.requests.length, 1);
    h.render(session, shortWindow).stop();
    h.render(session, shortWindow);
    h.render(session, shortWindow, { active: false });
    assert.equal(h.render(session, shortWindow).status, 'stopped');
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});


test('every page receives model/source filters; changing them aborts and restarts', async () => {
  const h = await createHarness(async (request) => request.cursor
    ? new Promise(() => {})
    : { items: [{ id: request.filter.model }], total: 2, next_cursor: 'next' });
  try {
    const filter = { model: 'model-a', identities: [{ source: 'source-a', auth_index: '1' }] };
    h.render(session, shortWindow, { filter });
    await tick();
    assert.equal(h.requests.length, 2);
    for (const request of h.requests) assert.deepEqual(request.request.filter, filter);
    h.render(session, shortWindow, { filter: structuredClone(filter) });
    assert.equal(h.requests.length, 2);
    const changed = { ...filter, model: 'model-b' };
    const result = h.render(session, shortWindow, { filter: changed });
    assert.equal(h.requests[1].signal.aborted, true);
    assert.equal(h.requests[2].request.cursor, '');
    assert.deepEqual(h.requests[2].request.filter, changed);
    assert.equal(result.loadedCount, 0);
  } finally { h.close(); }
});

test('an absent selected source is empty, never an unfiltered request', async () => {
  const h = await createHarness();
  try {
    h.render(session, shortWindow, { empty: true });
    assert.equal(h.requests.length, 0);
    const result = h.render(session, shortWindow, { empty: true });
    assert.equal(result.status, 'ready');
    assert.equal(result.totalCount, 0);
  } finally { h.close(); }
});

test('manual long-window loading resets when filters change', async () => {
  const h = await createHarness();
  try {
    const window = { startMs: session.now_ms - 30 * 86400000, endMs: session.now_ms };
    h.render(session, window, { filter: { model: 'a' } }).load();
    h.render(session, window, { filter: { model: 'a' } });
    await tick();
    assert.equal(h.render(session, window, { filter: { model: 'b' } }).needsManualLoad, true);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});
