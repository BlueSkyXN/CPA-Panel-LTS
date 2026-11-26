/**
 * 跨路由插件变更互斥（port of upstream 1e29f88f，按 LTS 双路由架构适配）
 *
 * LTS 的 /plugins 与 /plugin-store 是两个独立路由组件；路由切换不会中断
 * 在途请求，因此「已装插件删除/启停中转 store 安装」与「store 安装中删除
 * 已装插件」两类竞态真实可达。此 store 提供跨两个路由共享的 busy 信号。
 *
 * 锁按 token 登记，由发起变更的异步操作自己持有：
 * - 组件卸载不释放锁（请求仍在跑），只有请求真正 settle 才释放；
 * - 重新进入路由不会用空的组件状态覆盖在途锁（旧实现会在 remount 时提前解锁）；
 * - 连接切换清空登记，旧连接的迟到结果不会锁住新连接。
 *
 * 取得锁必须是「检查 + 登记」一步完成（`tryBegin*`）：组件里的 busy 判断读的是
 * 上一次渲染的闭包，同一 JS 任务内连续两次触发时两次都会看到「空闲」，
 * 于是各拿一个 token、各发一次请求。`tryBegin*` 同步读取当前登记，第二次
 * 调用立即失败，调用方不得再发请求。
 */

import { create } from 'zustand';
import { apiClient } from '@/services/api/client';

interface PluginMutationState {
  /** 当前登记的连接标识（结合连接世代；变化即清空两侧登记）。 */
  connectionKey: string;
  connectionGeneration: number;
  installedTokens: ReadonlySet<string>;
  storeTokens: ReadonlySet<string>;
  syncConnection: (connectionKey?: string) => void;
  clearLocks: () => void;
  /** 取得已装插件侧锁；已被占用（任一侧）时返回 null，调用方不得发请求。 */
  tryBeginInstalledMutation: () => string | null;
  endInstalledMutation: (token: string) => void;
  /** 取得 store 侧锁；已被占用（任一侧）时返回 null，调用方不得发请求。 */
  tryBeginStoreMutation: () => string | null;
  endStoreMutation: (token: string) => void;
}

let tokenSeq = 0;
const nextToken = (kind: string, generation: number) => `${kind}:${generation}:${++tokenSeq}`;

const withToken = (
  tokens: ReadonlySet<string>,
  token: string,
  add: boolean
): ReadonlySet<string> => {
  const next = new Set(tokens);
  if (add) {
    next.add(token);
  } else {
    next.delete(token);
  }
  return next;
};

export const usePluginMutationStore = create<PluginMutationState>((set, get) => {
  const ensureCurrentGeneration = (): number => {
    const currentGeneration = apiClient.getConnectionGeneration();
    const state = get();
    if (state.connectionGeneration !== currentGeneration) {
      set({
        connectionGeneration: currentGeneration,
        installedTokens: new Set<string>(),
        storeTokens: new Set<string>(),
      });
    }
    return currentGeneration;
  };

  // 两个方向共用一把锁：已装插件变更与 store 安装不得并发。
  const busy = () => {
    const state = get();
    if (!apiClient.isCurrentConnection(state.connectionGeneration)) {
      return false;
    }
    return state.installedTokens.size > 0 || state.storeTokens.size > 0;
  };
  return {
    connectionKey: '',
    connectionGeneration: apiClient.getConnectionGeneration(),
    installedTokens: new Set<string>(),
    storeTokens: new Set<string>(),
    syncConnection: (connectionKey = '') => {
      const currentGeneration = apiClient.getConnectionGeneration();
      set((state) => {
        if (
          state.connectionKey === connectionKey &&
          state.connectionGeneration === currentGeneration
        ) {
          return state;
        }
        return {
          connectionKey,
          connectionGeneration: currentGeneration,
          installedTokens: new Set<string>(),
          storeTokens: new Set<string>(),
        };
      });
    },
    clearLocks: () =>
      set({
        connectionKey: '',
        connectionGeneration: apiClient.getConnectionGeneration(),
        installedTokens: new Set<string>(),
        storeTokens: new Set<string>(),
      }),
    tryBeginInstalledMutation: () => {
      // No await between the check and the set: within one task the second
      // synchronous caller observes the token registered by the first.
      const generation = ensureCurrentGeneration();
      if (busy()) return null;
      const token = nextToken('installed', generation);
      set((state) => ({
        connectionGeneration: generation,
        installedTokens: withToken(state.installedTokens, token, true),
      }));
      return token;
    },
    endInstalledMutation: (token) =>
      set((state) => {
        if (!state.installedTokens.has(token)) return state;
        return { installedTokens: withToken(state.installedTokens, token, false) };
      }),
    tryBeginStoreMutation: () => {
      const generation = ensureCurrentGeneration();
      if (busy()) return null;
      const token = nextToken('store', generation);
      set((state) => ({
        connectionGeneration: generation,
        storeTokens: withToken(state.storeTokens, token, true),
      }));
      return token;
    },
    endStoreMutation: (token) =>
      set((state) => {
        if (!state.storeTokens.has(token)) return state;
        return { storeTokens: withToken(state.storeTokens, token, false) };
      }),
  };
});

/** 已装插件页有变更在途（删除/启停/配置打开）。 */
export const useInstalledPluginBusy = () =>
  usePluginMutationStore(
    (state) =>
      state.installedTokens.size > 0 && apiClient.isCurrentConnection(state.connectionGeneration)
  );

/** Store 页有安装或更新在途。 */
export const usePluginStoreBusy = () =>
  usePluginMutationStore(
    (state) =>
      state.storeTokens.size > 0 && apiClient.isCurrentConnection(state.connectionGeneration)
  );
