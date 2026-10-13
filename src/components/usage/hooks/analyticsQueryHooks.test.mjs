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
  const exportSource = await readFile(new URL('./usageDetailsExport.ts', import.meta.url), 'utf8');
  const exportCode = ts.transpileModule(exportSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  Object.assign(hooks, await import(`data:text/javascript;base64,${Buffer.from(exportCode).toString('base64')}`));
  const key = `__analyticsQuery${Math.random().toString(36).slice(2)}`; globalThis[key] = hooks;
  code = code.replace(/import \{[^;]+\} from 'react';/, `const {useEffect,useMemo,useRef,useState}=globalThis.${key};`)
    .replace(/import \{ useAuthStore \} from [^;]+;/, `const {useAuthStore}=globalThis.${key};`)
    .replace(/import \{ usageQueryApi \} from [^;]+;/, `const {usageQueryApi}=globalThis.${key};`)
    .replace(/import \{\s*legacyAnalyticsOptions,?\s*\} from [^;]+;/, 'const legacyAnalyticsOptions=()=>({models:[],identities:[]});')
    .replace(/import \{ normalizeUsageSourceId \} from [^;]+;/, 'const normalizeUsageSourceId=(value)=>value;')
    .replace(/import \{[^}]+\} from '\.\/usageDetailsExport';/, `const {UsageDetailsExport,canRetryUsageExport,usageExportFailure}=globalThis.${key};`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  delete globalThis[key];
  const hook = module.useUsageAnalyticsOptions ?? module.useUsageQueryDetails;
  return {
    requests, auth,
    render(...args) { index = 0; effects = []; const value = hook(...args); for (const effect of effects) effect(); return value; },
    close() { for (const slot of slots) slot.cleanup?.(); },
  };
}
const exportText = (details) => details.map((row) => row.__queryId).join(',');
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
    assert.deepEqual(await result.exportDetails(exportText), []);
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

const exportSource = await readFile(new URL('./usageDetailsExport.ts', import.meta.url), 'utf8');
const exportCode = ts.transpileModule(exportSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { UsageDetailsExport, usageExportFailure, canRetryUsageExport } = await import(`data:text/javascript;base64,${Buffer.from(exportCode).toString('base64')}`);
const item = (id) => ({ id, api: 'synthetic', model: 'a', detail: { source: 'synthetic', timestamp: '2026-10-13T00:00:00Z' } });
const page = (ids, total, next = '', extra = {}) => ({ bound: 'synthetic', items: ids.map(item), total, next_cursor: next, metrics, ...extra });
const transient = () => Object.assign(new Error('synthetic outage'), { status: 503 });
const runExport = (job, fetchPage, controller = new AbortController(), isCurrent = () => true, progress = () => {}) =>
  job.run(fetchPage, controller.signal, isCurrent, progress, 0);

test('export starts at the first cursor and reports validated batches with fixed filters', async () => {
  const filter = { model: 'a', tier_flow: 'fast_to_std', effort: 'high' };
  const job = new UsageDetailsExport({ bound: 'synthetic', filter, from_ms: 1, to_ms: 10, cursor: 'viewing-page-3', limit: 200 }, (items) => items);
  const requests = []; const progress = [];
  const rows = await runExport(job, async (q) => {
    requests.push(q);
    return q.cursor ? page(['3'], 3) : page(['1', '2'], 3, 'next');
  }, undefined, undefined, (p) => progress.push(p));
  assert.deepEqual(rows.flat().map((row) => row.id), ['1', '2', '3']);
  assert.deepEqual(requests.map((q) => q.cursor), ['', 'next']);
  assert.ok(requests.every((q) => q.filter === filter && q.bound === 'synthetic' && q.include_options === false && q.limit === 200 && q.from_ms === 1 && q.to_ms === 10));
  assert.deepEqual(progress.map((p) => p.loaded), [0, 2, 3]);
});

test('transient export errors retry only the unfinished cursor and then resume its checkpoint', async () => {
  const job = new UsageDetailsExport({ bound: 'synthetic' }, (items) => items);
  const requests = []; let fail = true;
  const fetchPage = async (q) => {
    requests.push(q.cursor);
    if (!q.cursor) return page(['1'], 2, 'next');
    if (fail) throw transient();
    return page(['2'], 2);
  };
  await assert.rejects(runExport(job, fetchPage), /synthetic outage/);
  assert.deepEqual(requests, ['', 'next', 'next', 'next']);
  assert.deepEqual(job.progress, { loaded: 1, total: 2, retry: 0 });
  fail = false;
  const rows = await runExport(job, fetchPage);
  assert.deepEqual(rows.flat().map((row) => row.id), ['1', '2']);
  assert.deepEqual(requests, ['', 'next', 'next', 'next', 'next']);
});

test('export cancellation interrupts retry backoff without another request', async () => {
  const job = new UsageDetailsExport({ bound: 'synthetic' }, (items) => items);
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(job.run(async () => { calls++; throw transient(); }, controller.signal, () => true,
    (p) => { if (p.retry) controller.abort(); }, 10000), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('a connection switch or cancellation during the final response cannot complete an export', async () => {
  for (const cancel of [false, true]) {
    const job = new UsageDetailsExport({ bound: 'synthetic' }, (items) => items);
    const controller = new AbortController(); let current = true;
    await assert.rejects(runExport(job, async () => {
      if (cancel) controller.abort(); else current = false;
      return page(['1'], 1);
    }, controller, () => current), { name: 'AbortError' });
    assert.equal(job.progress.loaded, 0);
  }
});

test('non-transient errors are not retried and expired snapshots are distinguished', async () => {
  for (const status of [400, 401, 403, 409]) {
    const job = new UsageDetailsExport({ bound: 'synthetic' }, (items) => items); let calls = 0;
    const error = Object.assign(new Error('synthetic error'), { status });
    await assert.rejects(runExport(job, async () => { calls++; throw error; }));
    assert.equal(calls, 1);
    assert.equal(canRetryUsageExport(error), false);
    assert.equal(usageExportFailure(error), status === 409 ? 'expired' : 'failed');
  }
});

test('inconsistent export batches are rejected before advancing the checkpoint', async () => {
  const invalidPages = [
    page(['2'], 3, 'next'), // repeated cursor
    page(['1'], 3, 'last'), // repeated record from previous batch
    page(['2', '2'], 3), // duplicate within one batch
    page(['2'], 3), // premature end
    page([], 3, 'last'), // cursor makes no progress
    page(['2', '3', '4'], 3), // exceeds total
    page(['2'], 2), // total changed
    page(['2', '3'], 3, 'last'), // continuation after expected total
    page(['2', '3'], 3, '', { bound: 'new-bound' }),
    page(['2'], 2.5),
  ];
  for (const invalid of invalidPages) {
    const job = new UsageDetailsExport({ bound: 'synthetic' }, (items) => items); let calls = 0;
    await assert.rejects(runExport(job, async () => ++calls === 1 ? page(['1'], 3, 'next') : invalid),
      (error) => usageExportFailure(error) === 'incomplete' && !canRetryUsageExport(error));
    assert.deepEqual(job.progress, { loaded: 1, total: 3, retry: 0 });
    assert.equal(calls, 2);
  }
});

test('paging retains the displayed page on failure and can retry the requested page', async () => {
  let fail = true;
  const h = await harness('./useUsageQueryDetails.ts', async (q) => {
    if (!q.cursor) return page(['first'], 101, 'next', { options });
    if (fail) throw transient();
    return page(['last'], 101);
  });
  const filter = () => ({});
  try {
    h.render(session, {}, filter); await tick();
    let result = h.render(session, {}, filter);
    result.setPage(1);
    result = h.render(session, {}, filter);
    assert.equal(result.loading, true); assert.equal(result.page, 0);
    assert.equal(result.data.items[0].id, 'first');
    await tick(); result = h.render(session, {}, filter);
    assert.equal(result.error, 'synthetic outage'); assert.equal(result.page, 0);
    assert.equal(result.requestedPage, 1); assert.equal(result.data.total, 101);
    fail = false; result.retry(); h.render(session, {}, filter); await tick();
    result = h.render(session, {}, filter);
    assert.equal(result.error, ''); assert.equal(result.page, 1);
    assert.equal(result.data.items[0].id, 'last');
  } finally { h.close(); }
});

test('retained pages do not cross filter or connection boundaries', async () => {
  const h = await harness('./useUsageQueryDetails.ts', async () => page(['first'], 1, '', { options }));
  try {
    const filter = () => ({ model: 'a' });
    h.render(session, {}, filter); await tick();
    assert.equal(h.render(session, {}, filter).data.items[0].id, 'first');
    assert.equal(h.render(session, {}, () => ({ model: 'b' })).data, null);
    await tick(); h.auth.apiBase = 'new-synthetic';
    assert.equal(h.render(session, {}, filter).data, null);
  } finally { h.close(); }
});

test('export hook aborts on query changes or unmount and rejects concurrent starts', async () => {
  for (const unmount of [false, true]) {
    let resolveExport;
    const h = await harness('./useUsageQueryDetails.ts', async (q) => {
      if (q.include_options) return page(['1'], 1, '', { options });
      return new Promise((resolve) => { resolveExport = resolve; });
    });
    const filter = () => ({});
    try {
      h.render(session, {}, filter); await tick();
      const result = h.render(session, {}, filter);
      const exporting = result.exportDetails(exportText);
      assert.equal(await result.exportDetails(exportText), null);
      const signal = h.requests.at(-1).signal;
      const finishOldExport = resolveExport;
      if (unmount) h.close(); else h.render(session, {}, () => ({ model: 'b' }));
      assert.equal(signal.aborted, true);
      finishOldExport(page(['1'], 1));
      assert.equal(await exporting, null);
      assert.equal(result.isExportCurrent(), false);
    } finally { h.close(); }
  }
});

test('export hook retains a failed batch for manual continuation and clears it on cancel', async () => {
  let exportingCalls = 0; let fail = true;
  const cursors = [];
  const h = await harness('./useUsageQueryDetails.ts', async (q) => {
    if (q.include_options) return page(['1'], 2, 'next', { options });
    exportingCalls++; cursors.push(q.cursor);
    if (!q.cursor) return page(['1'], 2, 'next');
    if (fail) throw transient();
    return page(['2'], 2);
  });
  const filter = () => ({});
  try {
    h.render(session, {}, filter); await tick();
    let result = h.render(session, {}, filter);
    assert.equal(await result.exportDetails(exportText), null);
    result = h.render(session, {}, filter);
    assert.equal(result.exportState.status, 'error'); assert.equal(result.exportState.loaded, 1);
    assert.equal(result.exportState.canResume, true); assert.equal(exportingCalls, 4);
    fail = false;
    const rows = await result.exportDetails(exportText, true);
    assert.deepEqual(await Promise.all(rows.map((part) => part.text())), ['1', '2']);
    assert.deepEqual(cursors, ['', 'next', 'next', 'next', 'next']);
    result = h.render(session, {}, filter);
    assert.equal(result.exportState.status, 'generating'); assert.equal(result.isExportCurrent(), true);
    result.finishExport(); result = h.render(session, {}, filter);
    assert.equal(result.exportState.status, 'complete'); assert.equal(result.isExportCurrent(), false);
    result.cancelExport(); result = h.render(session, {}, filter);
    assert.equal(result.exportState.status, 'cancelled'); assert.equal(result.exportState.canResume, false);
  } finally { h.close(); }
});


test('recent pages use a five-page cache, evict old pages, and explicit retry bypasses it', async () => {
  const h = await harness('./useUsageQueryDetails.ts', async (q) => {
    const offset = Number(q.cursor || 0);
    return page([String(offset)], 701, String(offset + 100), { options });
  });
  const filter = () => ({});
  const render = () => h.render(session, {}, filter);
  try {
    render(); await tick();
    for (let i = 1; i <= 5; i++) {
      render().setPage(i); render(); await tick();
      assert.equal(render().page, i);
    }
    assert.equal(h.requests.length, 6);
    render().setPage(4); render(); await tick();
    assert.equal(render().page, 4); assert.equal(h.requests.length, 6);
    render().setPage(0); render(); await tick();
    assert.equal(render().page, 0); assert.equal(h.requests.length, 7);
    render().retry(); render(); await tick();
    assert.equal(h.requests.length, 8);
    h.auth.apiBase = 'new-instance'; render(); await tick();
    assert.equal(h.requests.length, 9);
  } finally { h.close(); }
});

test('converted export batches are atomic and resume without reprocessing completed batches', async () => {
  const converted = [];
  const job = new UsageDetailsExport({ bound: 'synthetic' }, (items, first) => {
    converted.push(items.map((row) => row.id));
    return `${first ? 'header:' : ','}${items.map((row) => row.id).join(',')}`;
  });
  await assert.rejects(runExport(job, async (q) => {
    if (q.cursor) throw transient();
    return page(['1', '2'], 3, 'next');
  }));
  assert.deepEqual(converted, [['1', '2']]);
  const parts = await runExport(job, async () => page(['3'], 3));
  assert.equal(parts.join(''), 'header:1,2,3');
  assert.deepEqual(converted, [['1', '2'], ['3']]);
  const controller = new AbortController();
  const cancelled = new UsageDetailsExport({ bound: 'synthetic' }, () => { controller.abort(); return 'discard'; });
  await assert.rejects(runExport(cancelled, async () => page(['1'], 1), controller), { name: 'AbortError' });
  assert.equal(cancelled.progress.loaded, 0);
});
