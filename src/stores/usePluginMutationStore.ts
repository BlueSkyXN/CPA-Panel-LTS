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
 */

import { create } from 'zustand';

interface PluginMutationState {
  /** 当前登记的连接标识（`profileId:apiBase`）；变化即清空两侧登记。 */
  connectionKey: string;
  installedTokens: ReadonlySet<string>;
  storeTokens: ReadonlySet<string>;
  syncConnection: (connectionKey: string) => void;
  beginInstalledMutation: () => string;
  endInstalledMutation: (token: string) => void;
  beginStoreMutation: () => string;
  endStoreMutation: (token: string) => void;
}

let tokenSeq = 0;
const nextToken = (kind: string) => `${kind}:${++tokenSeq}`;

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

export const usePluginMutationStore = create<PluginMutationState>((set) => ({
  connectionKey: '',
  installedTokens: new Set<string>(),
  storeTokens: new Set<string>(),
  syncConnection: (connectionKey) =>
    set((state) => {
      if (state.connectionKey === connectionKey) return state;
      return {
        connectionKey,
        installedTokens: new Set<string>(),
        storeTokens: new Set<string>(),
      };
    }),
  beginInstalledMutation: () => {
    const token = nextToken('installed');
    set((state) => ({ installedTokens: withToken(state.installedTokens, token, true) }));
    return token;
  },
  endInstalledMutation: (token) =>
    set((state) => {
      if (!state.installedTokens.has(token)) return state;
      return { installedTokens: withToken(state.installedTokens, token, false) };
    }),
  beginStoreMutation: () => {
    const token = nextToken('store');
    set((state) => ({ storeTokens: withToken(state.storeTokens, token, true) }));
    return token;
  },
  endStoreMutation: (token) =>
    set((state) => {
      if (!state.storeTokens.has(token)) return state;
      return { storeTokens: withToken(state.storeTokens, token, false) };
    }),
}));

/** 已装插件页有变更在途（删除/启停/配置打开）。 */
export const useInstalledPluginBusy = () =>
  usePluginMutationStore((state) => state.installedTokens.size > 0);

/** Store 页有安装或更新在途。 */
export const usePluginStoreBusy = () =>
  usePluginMutationStore((state) => state.storeTokens.size > 0);
