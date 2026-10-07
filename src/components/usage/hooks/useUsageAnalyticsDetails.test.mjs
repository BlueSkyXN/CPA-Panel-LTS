import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./useUsageAnalyticsDetails.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;

async function createHarness() {
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
    usageQueryApi: { async details(request, signal) { requests.push({ request, signal }); return { items: [], next_cursor: '' }; } },
  };
  const key = `__analyticsHook${Math.random().toString(36).slice(2)}`;
  globalThis[key] = harness;
  const replacements = [
    [/import \{[^;]+\} from 'react';/, `const {useCallback,useEffect,useMemo,useRef,useState}=globalThis.${key};`],
    [/import \{ useAuthStore \} from [^;]+;/, `const {useAuthStore}=globalThis.${key};`],
    [/import \{ usageQueryApi \} from [^;]+;/, `const {usageQueryApi}=globalThis.${key};`],
    [/import \{ collectUsageDetails \} from [^;]+;/, 'const collectUsageDetails=()=>[];'],
    [/import \{ queryItemDetail \} from [^;]+;/, 'const queryItemDetail=(item)=>item;'],
  ];
  let code = compiled;
  for (const [pattern, replacement] of replacements) { assert.match(code, pattern); code = code.replace(pattern, replacement); }
  const { useUsageAnalyticsDetails } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key];
  return {
    auth, requests,
    render(session, window) {
      index = 0; effects = [];
      const result = useUsageAnalyticsDetails(session, null, window);
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
