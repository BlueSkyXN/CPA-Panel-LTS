import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { apiClient } from '@/services/api/client';
import { usageQueryApi } from '@/services/api/usageQuery';
import type { UsageQuerySession } from '@/types/usageQuery';
import { isRecord } from '@/utils/helpers';

interface State {
  scope: string;
  mode: 'unknown' | 'query' | 'legacy' | 'error';
  session: UsageQuerySession | null;
  error: string;
  loading: boolean;
  refreshedAt: number;
  load: (force?: boolean) => Promise<void>;
}
export const usageConnectionScope = () => {
  const { apiBase, managementKey } = useAuthStore.getState();
  return JSON.stringify([apiBase, managementKey]);
};
let request: { scope: string; promise: Promise<void> } | null = null;
let generation = 0;
export const useUsageQueryStore = create<State>((set, get) => ({
  scope: '',
  mode: 'unknown',
  session: null,
  error: '',
  loading: false,
  refreshedAt: 0,
  load: async (force = false) => {
    const scope = usageConnectionScope();
    if (request?.scope === scope) return request.promise;
    if (!force && get().scope === scope && Date.now() - get().refreshedAt < 240_000) return;
    const id = ++generation;
    const task = (async () => {
      set({
        scope,
        loading: true,
        error: '',
        ...(get().scope !== scope ? { mode: 'unknown' as const, session: null } : {}),
      });
      try {
        let session: UsageQuerySession | null = null;
        try {
          session = await usageQueryApi.capabilities();
        } catch (error) {
          if (!isRecord(error) || error.status !== 404) throw error;
          // 确认同一前缀下的旧管理接口正常，才认定为旧 Core；其他失败不拉全量。
          const legacy = await apiClient.get<unknown>('/usage-statistics-enabled');
          if (!isRecord(legacy) || typeof legacy['usage-statistics-enabled'] !== 'boolean')
            throw error;
        }
        if (id !== generation || scope !== usageConnectionScope()) return;
        set({
          scope,
          session,
          mode: session ? 'query' : 'legacy',
          loading: false,
          refreshedAt: Date.now(),
        });
      } catch (error) {
        if (id !== generation || scope !== usageConnectionScope()) return;
        set({
          loading: false,
          mode: 'error',
          error: error instanceof Error ? error.message : 'Usage query failed',
        });
        throw error;
      }
    })();
    const active = { scope, promise: task };
    request = active;
    try {
      await task;
    } finally {
      if (request === active) request = null;
    }
  },
}));
