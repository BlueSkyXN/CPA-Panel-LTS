/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus, ServerRuntimeKind } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { readProfiles, saveProfile, tabAuthStorage } from '@/services/storage/connectionProfiles';
import { apiClient } from '@/services/api/client';
import { versionApi } from '@/services/api/version';
import { pluginsApi } from '@/services/api/plugins';
import { useConfigStore } from './useConfigStore';
import { useUsageStatsStore } from './useUsageStatsStore';
import { useModelsStore } from './useModelsStore';
import { useQuotaStore } from './useQuotaStore';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { generateId } from '@/utils/helpers';

type PluginSupportState = Pick<
  AuthState,
  'supportsPlugin' | 'pluginSupportKnown' | 'pluginSupportSource'
>;

interface AuthStoreState extends AuthState {
  profileId: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;

  // 操作
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (
    version: string | null,
    buildDate?: string | null,
    runtimeKind?: ServerRuntimeKind | null
  ) => void;
  updateServerRuntimeKind: (runtimeKind: ServerRuntimeKind) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
  updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;

const probePluginSupport = async (): Promise<boolean> => {
  try {
    await pluginsApi.list();
    return true;
  } catch {
    return false;
  }
};

const resolvePluginSupport = async (
  connectionGeneration: number,
  getPluginSupportState: () => PluginSupportState
): Promise<PluginSupportState | null> => {
  if (!apiClient.isCurrentConnection(connectionGeneration)) {
    return null;
  }

  let pluginSupport = getPluginSupportState();
  if (!pluginSupport.pluginSupportKnown) {
    const probeSupported = await probePluginSupport();
    if (!apiClient.isCurrentConnection(connectionGeneration)) {
      return null;
    }
    pluginSupport = getPluginSupportState();
    if (!pluginSupport.pluginSupportKnown) {
      return {
        supportsPlugin: probeSupported,
        pluginSupportKnown: true,
        pluginSupportSource: 'probe',
      };
    }
  }

  return pluginSupport;
};

const detectRuntimeKind = async (currentRuntimeKind: ServerRuntimeKind): Promise<ServerRuntimeKind> => {
  if (currentRuntimeKind !== 'unknown') {
    return currentRuntimeKind;
  }

  try {
    return await versionApi.detectRuntimeKind();
  } catch (error) {
    console.warn('Runtime kind detection failed:', error);
    return 'unknown';
  }
};

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      // 初始状态
      isAuthenticated: false,
      profileId: '',
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      serverVersion: null,
      serverBuildDate: null,
      serverRuntimeKind: 'unknown',
      supportsPlugin: false,
      pluginSupportKnown: false,
      pluginSupportSource: 'unknown',
      connectionStatus: 'disconnected',
      connectionError: null,

      // 恢复会话并自动登录
      restoreSession: () => {
        if (restoreSessionPromise) return restoreSessionPromise;

        restoreSessionPromise = (async () => {
          const wasLoggedIn = sessionStorage.getItem('isLoggedIn') === 'true';
          const { apiBase, managementKey, rememberPassword } = get();
          const resolvedBase = normalizeApiBase(apiBase || detectApiBaseFromLocation());
          const resolvedKey = managementKey || '';
          const resolvedRememberPassword = rememberPassword;

          set({
            apiBase: resolvedBase,
            managementKey: resolvedKey,
            rememberPassword: resolvedRememberPassword
          });
          apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

          if (wasLoggedIn && resolvedBase && resolvedKey) {
            try {
              return await get().login({
                apiBase: resolvedBase,
                managementKey: resolvedKey,
                rememberPassword: resolvedRememberPassword
              });
            } catch (error) {
              console.warn('Auto login failed:', error);
              return false;
            }
          }

          return false;
        })();

        return restoreSessionPromise;
      },

      // 登录
      login: async (credentials) => {
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;
        const connectionGeneration = apiClient.setConfig({
          apiBase,
          managementKey
        });

        try {
          set({
            connectionStatus: 'connecting',
            serverVersion: null,
            serverBuildDate: null,
            serverRuntimeKind: 'unknown',
            supportsPlugin: false,
            pluginSupportKnown: false,
            pluginSupportSource: 'unknown'
          });
          useConfigStore.getState().clearCache();
          useModelsStore.getState().clearCache();
          useQuotaStore.getState().clearQuotaCache();

          // 测试连接 - 获取配置
          await useConfigStore.getState().fetchConfig(undefined, true);
          if (!apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }
          const runtimeKind = await detectRuntimeKind(get().serverRuntimeKind);
          if (!apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }
          const pluginSupport = await resolvePluginSupport(connectionGeneration, () => {
            const { supportsPlugin, pluginSupportKnown, pluginSupportSource } = get();
            return { supportsPlugin, pluginSupportKnown, pluginSupportSource };
          });
          if (!pluginSupport || !apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }

          // 登录成功
          const existing = readProfiles().find((profile) => profile.id === get().profileId && profile.apiBase === apiBase);
          const profileId = existing?.id || generateId();
          saveProfile({
            id: profileId, name: existing?.name || apiBase, apiBase,
            environment: existing?.environment || '', rememberPassword,
            ...(rememberPassword ? { managementKey } : {}), lastUsedAt: Date.now(),
          });
          set({
            profileId,
            isAuthenticated: true,
            apiBase,
            managementKey,
            rememberPassword,
            connectionStatus: 'connected',
            connectionError: null,
            ...pluginSupport,
            ...(runtimeKind !== 'unknown' ? { serverRuntimeKind: runtimeKind } : {})
          });
          if (rememberPassword) {
            sessionStorage.setItem('isLoggedIn', 'true');
          } else {
            sessionStorage.removeItem('isLoggedIn');
          }
          return true;
        } catch (error: unknown) {
          if (!apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }
          const message =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : 'Connection failed';
          set({
            connectionStatus: 'error',
            connectionError: message || 'Connection failed'
          });
          throw error;
        }
      },

      // 登出
      logout: () => {
        const wasAuthenticated = get().isAuthenticated;
        restoreSessionPromise = null;
        apiClient.clearConfig();
        useConfigStore.getState().clearCache();
        useUsageStatsStore.getState().clearUsageStats();
        useModelsStore.getState().clearCache();
        useQuotaStore.getState().clearQuotaCache();
        set({
          isAuthenticated: false,
          apiBase: '',
          managementKey: '',
          serverVersion: null,
          serverBuildDate: null,
          serverRuntimeKind: 'unknown',
          supportsPlugin: false,
          pluginSupportKnown: false,
          pluginSupportSource: 'unknown',
          connectionStatus: 'disconnected',
          connectionError: null
        });
        sessionStorage.removeItem('isLoggedIn');
        if (wasAuthenticated) window.location.reload();
      },

      // 检查认证状态
      checkAuth: async () => {
        const { managementKey, apiBase } = get();

        if (!managementKey || !apiBase) {
          return false;
        }

        const connectionGeneration = apiClient.setConfig({ apiBase, managementKey });
        try {
          set({
            supportsPlugin: false,
            pluginSupportKnown: false,
            pluginSupportSource: 'unknown'
          });

          // 验证连接
          await useConfigStore.getState().fetchConfig();
          if (!apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }
          const runtimeKind = await detectRuntimeKind(get().serverRuntimeKind);
          if (!apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }
          const pluginSupport = await resolvePluginSupport(connectionGeneration, () => {
            const { supportsPlugin, pluginSupportKnown, pluginSupportSource } = get();
            return { supportsPlugin, pluginSupportKnown, pluginSupportSource };
          });
          if (!pluginSupport || !apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }

          set({
            isAuthenticated: true,
            connectionStatus: 'connected',
            ...pluginSupport,
            ...(runtimeKind !== 'unknown' ? { serverRuntimeKind: runtimeKind } : {})
          });

          return true;
        } catch {
          if (!apiClient.isCurrentConnection(connectionGeneration)) {
            return false;
          }
          set({
            isAuthenticated: false,
            connectionStatus: 'error',
            supportsPlugin: false,
            pluginSupportKnown: false,
            pluginSupportSource: 'unknown'
          });
          return false;
        }
      },

      // 更新服务器版本
      updateServerVersion: (version, buildDate, runtimeKind) => {
        set((state) => ({
          serverVersion: version || null,
          serverBuildDate: buildDate || null,
          serverRuntimeKind: runtimeKind || state.serverRuntimeKind
        }));
      },

      updateServerRuntimeKind: (runtimeKind) => {
        set({ serverRuntimeKind: runtimeKind });
      },

      updateServerPluginSupport: (supportsPlugin) => {
        set({ supportsPlugin, pluginSupportKnown: true, pluginSupportSource: 'header' });
      },

      // 更新连接状态
      updateConnectionStatus: (status, error = null) => {
        set({
          connectionStatus: status,
          connectionError: error
        });
      }
    }),
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => tabAuthStorage),
      partialize: (state) => ({
        profileId: state.profileId,
        apiBase: state.apiBase,
        rememberPassword: state.rememberPassword,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate,
        serverRuntimeKind: state.serverRuntimeKind
      }),
      version: 1,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as AuthStoreState;
        }
        const nextState = { ...(persistedState as Record<string, unknown>) };
        delete nextState.supportsPlugin;
        delete nextState.pluginSupportKnown;
        delete nextState.pluginSupportSource;
        return nextState as unknown as AuthStoreState;
      }
    }
  )
);

// 监听全局未授权事件
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => {
    useAuthStore.getState().logout();
  });

  window.addEventListener(
    'server-version-update',
    ((e: CustomEvent) => {
      const detail = e.detail || {};
      const runtimeKind =
        detail.runtimeKind === 'cpa' || detail.runtimeKind === 'home'
          ? detail.runtimeKind
          : null;
      useAuthStore
        .getState()
        .updateServerVersion(detail.version || null, detail.buildDate || null, runtimeKind);
    }) as EventListener
  );

  window.addEventListener(
    'server-plugin-support-update',
    ((e: CustomEvent) => {
      useAuthStore.getState().updateServerPluginSupport(e.detail?.supportsPlugin === true);
    }) as EventListener
  );
}
