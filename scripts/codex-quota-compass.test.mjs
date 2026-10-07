import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./codex-quota-compass.user.js', import.meta.url), 'utf8');
const hostId = 'codex-quota-compass-host';

const createHarness = (url) => {
  const location = new URL(url, 'https://chatgpt.com');
  const hosts = new Map();
  const listeners = new Map();
  const timers = [];
  const requests = [];
  const navigate = (_state, _title, path) => {
    if (path !== undefined && path !== null) location.href = new URL(path, location).href;
  };
  const createElement = () => ({
    dataset: {},
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    setAttribute() {},
    attachShadow() {
      const elements = new Map();
      this.shadowRoot = {
        querySelector(selector) {
          if (selector === '.cqc-tip') return null;
          if (!elements.has(selector)) elements.set(selector, createElement());
          return elements.get(selector);
        },
      };
      return this.shadowRoot;
    },
    remove() {
      hosts.delete(this.id);
    },
  });
  const window = {
    history: { pushState: navigate, replaceState: navigate },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    },
  };
  const resetAt = Math.floor(Date.now() / 1000) + 3600;
  const fetch = async (path) => {
    requests.push(path);
    const pathname = new URL(path, location).pathname;
    let payload;
    if (pathname === '/api/auth/session') {
      payload = {};
    } else if (pathname === '/backend-api/wham/usage') {
      payload = {
        plan_type: 'plus',
        rate_limit: {
          secondary_window: {
            limit_window_seconds: 604800,
            used_percent: 25,
            reset_at: resetAt,
            reset_after_seconds: 3600,
          },
        },
        rate_limit_reset_credits: { available_count: 0 },
      };
    } else if (pathname === '/backend-api/wham/analytics/daily-workspace-usage-counts') {
      payload = { data: [] };
    } else {
      throw new Error(`Unexpected request: ${pathname}`);
    }
    return { ok: true, json: async () => payload };
  };

  vm.runInNewContext(source, {
    window,
    location,
    document: {
      body: { appendChild: (host) => hosts.set(host.id, host) },
      getElementById: (id) => hosts.get(id) ?? null,
      createElement,
    },
    URLSearchParams,
    fetch,
  });

  return {
    requests,
    hasUi: () => hosts.has(hostId),
    navigate: (path, method = 'pushState') => window.history[method](null, '', path),
    popstate(path) {
      location.href = new URL(path, location).href;
      for (const handler of listeners.get('popstate') ?? []) handler();
    },
    click(selector) {
      const element = hosts.get(hostId)?.shadowRoot.querySelector(selector);
      assert.ok(element, `Missing UI element: ${selector}`);
      element.listeners.get('click')();
    },
    async flushTimers(maxDelay = Infinity) {
      let index;
      while ((index = timers.findIndex((timer) => timer.delay <= maxDelay)) !== -1) {
        timers.splice(index, 1)[0].callback();
        await new Promise(setImmediate);
      }
      await new Promise(setImmediate);
    },
  };
};

const assertQuotaRequests = (requests) => {
  assert.deepEqual(
    requests.map((path) => new URL(path, 'https://chatgpt.com').pathname),
    [
      '/api/auth/session',
      '/backend-api/wham/usage',
      '/backend-api/wham/analytics/daily-workspace-usage-counts',
    ]
  );
};

test('metadata enables same-origin SPA entry and keeps the version synchronized', () => {
  assert.deepEqual([...source.matchAll(/^\/\/ @match\s+(\S+)/gm)].map((match) => match[1]), [
    'https://chatgpt.com/*',
  ]);
  const metadataVersion = source.match(/^\/\/ @version\s+(\S+)/m)?.[1];
  const appVersion = source.match(/const APP_VERSION = '([^']+)'/)?.[1];
  assert.ok(metadataVersion);
  assert.equal(appVersion, metadataVersion);
});

for (const path of [
  '/settings/usage',
  '/settings/usage?tab=overview',
  '/settings/usage?tab=analytics',
  '/settings/usage/',
  '/codex/cloud',
  '/codex/cloud/tasks/example',
]) {
  test(`direct entry mounts and fetches quota on ${path}`, async () => {
    const harness = createHarness(path);
    assert.equal(harness.hasUi(), true);
    assert.equal(harness.requests.length, 0);
    await harness.flushTimers();
    assertQuotaRequests(harness.requests);
  });
}

for (const path of [
  '/',
  '/c/example',
  '/settings',
  '/settings/usage-extra',
  '/codex/cloud-extra',
  'https://example.com/settings/usage?tab=overview',
  'https://chatgpt.com.example.com/settings/usage',
]) {
  test(`does not mount or fetch quota outside allowed pages: ${path}`, async () => {
    const harness = createHarness(path);
    await harness.flushTimers();
    assert.equal(harness.hasUi(), false);
    assert.deepEqual(harness.requests, []);
  });
}

test('SPA entry, tab changes, exit and history navigation retain the route gate', async () => {
  const harness = createHarness('/');
  harness.navigate('/settings/usage?tab=overview');
  await harness.flushTimers();
  assert.equal(harness.hasUi(), true);
  assertQuotaRequests(harness.requests);

  harness.navigate('/settings/usage?tab=analytics', 'replaceState');
  await harness.flushTimers();
  assert.equal(harness.hasUi(), true);
  assertQuotaRequests(harness.requests);

  harness.navigate('/c/example');
  await harness.flushTimers();
  assert.equal(harness.hasUi(), false);
  assertQuotaRequests(harness.requests);

  harness.popstate('/settings/usage?tab=analytics');
  await harness.flushTimers();
  assert.equal(harness.hasUi(), true);
  assertQuotaRequests(harness.requests);

  harness.popstate('/c/example');
  await harness.flushTimers();
  assert.equal(harness.hasUi(), false);
  assertQuotaRequests(harness.requests);
});

test('leaving a quota page before autoload prevents background requests', async () => {
  const harness = createHarness('/settings/usage?tab=overview');
  harness.navigate('/');
  await harness.flushTimers(0);
  assert.equal(harness.hasUi(), false);
  await harness.flushTimers();
  assert.deepEqual(harness.requests, []);
});

test('manual refresh fetches again without adding polling', async () => {
  const harness = createHarness('/settings/usage?tab=analytics');
  await harness.flushTimers();
  assertQuotaRequests(harness.requests);
  harness.click('.cqc-refresh');
  await harness.flushTimers();
  assert.equal(harness.requests.length, 6);
  assertQuotaRequests(harness.requests.slice(3));
  await harness.flushTimers();
  assert.equal(harness.requests.length, 6);
});
