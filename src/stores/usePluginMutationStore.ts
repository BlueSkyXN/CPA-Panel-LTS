/**
 * 跨路由插件变更互斥（port of upstream 1e29f88f，按 LTS 双路由架构适配）
 *
 * LTS 的 /plugins 与 /plugin-store 是两个独立路由组件；路由切换不会中断
 * 在途请求，因此「已装插件删除/启停中转 store 安装」与「store 安装中删除
 * 已装插件」两类竞态真实可达。此 store 提供跨两个路由共享的 busy 信号。
 */

import { create } from 'zustand';

interface PluginMutationState {
  /** 已装插件页有变更在途（删除/启停/配置打开）。 */
  installedBusy: boolean;
  /** Store 页有安装或更新在途。 */
  storeBusy: boolean;
  setInstalledBusy: (busy: boolean) => void;
  setStoreBusy: (busy: boolean) => void;
}

export const usePluginMutationStore = create<PluginMutationState>((set) => ({
  installedBusy: false,
  storeBusy: false,
  setInstalledBusy: (busy) => set({ installedBusy: busy }),
  setStoreBusy: (busy) => set({ storeBusy: busy }),
}));
