import { apiClient, pluginsApi, pluginStoreApi } from '@/services/api';
import type {
  PluginListEntry,
  PluginListResponse,
  PluginStoreEntry,
  PluginStoreResponse,
} from '@/types';

const PLUGIN_STATE_TIMEOUT_MS = 15_000;
const PLUGIN_STATE_INTERVAL_MS = 500;

const EMPTY_PLUGIN_LIST_RESPONSE: PluginListResponse = {
  pluginsEnabled: false,
  pluginsDir: '',
  plugins: [],
};

const EMPTY_PLUGIN_STORE_RESPONSE: PluginStoreResponse = {
  pluginsEnabled: false,
  pluginsDir: '',
  sources: [],
  sourceErrors: [],
  plugins: [],
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

export interface PluginStateWaitResult {
  response: PluginListResponse;
  plugin: PluginListEntry | null;
  timedOut: boolean;
  stale: boolean;
}

export interface PluginStoreStateWaitResult {
  response: PluginStoreResponse;
  plugin: PluginStoreEntry | null;
  timedOut: boolean;
  stale: boolean;
}

export async function waitForPluginState(
  id: string,
  predicate: (plugin: PluginListEntry, response: PluginListResponse) => boolean,
  timeoutMs = PLUGIN_STATE_TIMEOUT_MS,
  intervalMs = PLUGIN_STATE_INTERVAL_MS,
  expectedGeneration = apiClient.getConnectionGeneration()
): Promise<PluginStateWaitResult> {
  const deadline = Date.now() + timeoutMs;
  let latest = EMPTY_PLUGIN_LIST_RESPONSE;

  const fetchLatest = async (): Promise<PluginListResponse | null> => {
    if (!apiClient.isCurrentConnection(expectedGeneration)) {
      return null;
    }
    try {
      const next = await pluginsApi.list();
      if (!apiClient.isCurrentConnection(expectedGeneration)) {
        return null;
      }
      return next;
    } catch (error) {
      if (!apiClient.isCurrentConnection(expectedGeneration)) {
        return null;
      }
      throw error;
    }
  };

  const initial = await fetchLatest();
  if (!initial) {
    return { response: latest, plugin: null, timedOut: false, stale: true };
  }
  latest = initial;

  for (;;) {
    const plugin = latest.plugins.find((item) => item.id === id) ?? null;
    if (plugin && predicate(plugin, latest)) {
      return { response: latest, plugin, timedOut: false, stale: false };
    }
    if (Date.now() >= deadline) {
      return { response: latest, plugin, timedOut: true, stale: false };
    }
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    const next = await fetchLatest();
    if (!next) {
      return { response: latest, plugin: null, timedOut: false, stale: true };
    }
    latest = next;
  }
}

export async function waitForPluginStoreState(
  id: string,
  sourceId: string,
  predicate: (plugin: PluginStoreEntry, response: PluginStoreResponse) => boolean,
  timeoutMs = PLUGIN_STATE_TIMEOUT_MS,
  intervalMs = PLUGIN_STATE_INTERVAL_MS,
  expectedGeneration = apiClient.getConnectionGeneration()
): Promise<PluginStoreStateWaitResult> {
  const deadline = Date.now() + timeoutMs;
  let latest = EMPTY_PLUGIN_STORE_RESPONSE;

  const fetchLatest = async (): Promise<PluginStoreResponse | null> => {
    if (!apiClient.isCurrentConnection(expectedGeneration)) {
      return null;
    }
    try {
      const next = await pluginStoreApi.list();
      if (!apiClient.isCurrentConnection(expectedGeneration)) {
        return null;
      }
      return next;
    } catch (error) {
      if (!apiClient.isCurrentConnection(expectedGeneration)) {
        return null;
      }
      throw error;
    }
  };

  const initial = await fetchLatest();
  if (!initial) {
    return { response: latest, plugin: null, timedOut: false, stale: true };
  }
  latest = initial;

  for (;;) {
    const plugin =
      latest.plugins.find((item) => item.id === id && (!sourceId || item.sourceId === sourceId)) ??
      null;
    if (plugin && predicate(plugin, latest)) {
      return { response: latest, plugin, timedOut: false, stale: false };
    }
    if (Date.now() >= deadline) {
      return { response: latest, plugin, timedOut: true, stale: false };
    }
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    const next = await fetchLatest();
    if (!next) {
      return { response: latest, plugin: null, timedOut: false, stale: true };
    }
    latest = next;
  }
}
