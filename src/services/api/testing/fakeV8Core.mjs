// Synthetic in-memory model of the CPA-Core-LTS v8 config contract used by Node tests:
// GET /config injects `auth_index`, every config write needs the current strong ETag in
// If-Match (428 without it, 412 when stale), and a successful write clears the ETag.
import { AxiosError } from 'axios';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

export const authIndexFor = (family, key) => `${family}:${key['api-key'] ?? 'nokey'}`;

function injectAuthIndexes(doc) {
  const view = clone(doc);
  const apiKeys = view?.['api-keys'];
  if (apiKeys && typeof apiKeys === 'object') {
    for (const [family, groups] of Object.entries(apiKeys)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group?.keys)) continue;
        for (const key of group.keys) key.auth_index = authIndexFor(family, key);
      }
    }
  }
  return view;
}

const readPath = (doc, parts) =>
  parts.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), doc);

function writePath(doc, parts, value) {
  let target = doc;
  for (const key of parts.slice(0, -1)) {
    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[parts.at(-1)] = value;
}

function stripWrittenAuthIndexes(value) {
  if (Array.isArray(value)) return value.map(stripWrittenAuthIndexes);
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'auth_index' || key === 'auth-index') continue;
      next[key] = stripWrittenAuthIndexes(child);
    }
    return next;
  }
  return value;
}

export function installFakeV8Core(apiClient, initialDoc) {
  const state = { doc: clone(initialDoc), revision: 1, calls: [], writes: [] };
  state.etag = () => `"${state.revision.toString(16).padStart(64, '0')}"`;
  /** Simulate another editor: mutate the document and advance the revision. */
  state.concurrentEdit = (mutate) => {
    mutate(state.doc);
    state.revision += 1;
  };
  apiClient.setConfig({ apiBase: 'https://core.invalid', managementKey: 'synthetic-key' });
  const previousAdapter = apiClient.instance.defaults.adapter;
  apiClient.instance.defaults.adapter = async (config) => {
    const method = String(config.method).toUpperCase();
    const url = config.url;
    const ifMatch = config.headers?.get?.('If-Match') ?? config.headers?.['If-Match'];
    const data =
      typeof config.data === 'string' && config.data ? JSON.parse(config.data) : config.data;
    state.calls.push({ method, url, base: config.baseURL, ifMatch, data });
    const respond = (status, body, headers = {}) => {
      const response = { data: body, status, statusText: String(status), headers, config };
      if (status >= 400) {
        throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, null, response);
      }
      return response;
    };
    if (!url.startsWith('/config')) return respond(404, { error: 'not_found' });
    const parts = url
      .replace(/^\/config\/?/, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    if (method === 'GET') {
      state.calls.at(-1).etag = state.etag();
      if (url === '/config.yaml') return respond(200, 'config-version: 8\n', { etag: state.etag() });
      const value = readPath(injectAuthIndexes(state.doc), parts);
      state.calls.at(-1).etag = state.etag();
      if (value === undefined) return respond(404, { error: 'not_found' }, { etag: state.etag() });
      return respond(200, value, { etag: state.etag() });
    }
    if (state.onBeforeWrite) {
      const hook = state.onBeforeWrite;
      state.onBeforeWrite = null;
      hook(state);
    }
    if (!ifMatch) return respond(428, { error: 'config_revision_required' }, { etag: state.etag() });
    if (ifMatch !== state.etag()) {
      return respond(412, { error: 'config_revision_conflict' }, { etag: state.etag() });
    }
    if (method === 'PUT' && parts.length) writePath(state.doc, parts, stripWrittenAuthIndexes(data));
    else if (method === 'DELETE' && parts.length) {
      const parent = readPath(state.doc, parts.slice(0, -1));
      if (parent && typeof parent === 'object') delete parent[parts.at(-1)];
    } else return respond(400, { error: 'unsupported_fake_write' });
    state.writes.push({ method, url, data });
    state.revision += 1;
    return respond(200, { status: 'ok', 'config-version': 8 }, { etag: '' });
  };
  state.restore = () => {
    apiClient.instance.defaults.adapter = previousAdapter;
  };
  return state;
}
