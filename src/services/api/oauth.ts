/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient, ltsExtensionClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'kimi'
  | 'kimi-ai'
  | 'xai'
  | 'copilot';

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

export interface CopilotLoginInfo {
  provider?: string;
  verification_uri?: string;
  user_code?: string;
  expires_at?: string;
  interval_seconds?: number;
}

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'xai'];
const V8_AUTH_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  anthropic: 'claude',
};
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini',
};

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: { projectId?: string; signal?: AbortSignal }) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    // v8 dispatches by provider query; Core names the Anthropic flow `claude`.
    params.provider = V8_AUTH_PROVIDER_MAP[provider] ?? provider;
    return apiClient.get<OAuthStartResponse>('/oauth/auth-url', {
      params,
      signal: options?.signal,
    });
  },

  getAuthStatus: (state: string, signal?: AbortSignal) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>('/oauth/status', {
      params: { state },
      signal,
    }),

  // Copilot 设备码登录的 user_code 展示通道：Core 插件 management 路由，
  // state 是 copilot-auth-url 返回的登录流 ID；device_code 不外发。
  copilotLoginInfo: (state: string, signal?: AbortSignal) =>
    // Plugin-owned management routes are served only under the LTS extension prefix.
    ltsExtensionClient.get<CopilotLoginInfo>(`/plugins/copilot/login-info`, {
      params: { state },
      signal,
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string, signal?: AbortSignal) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>(
      '/oauth/callback',
      {
        provider: callbackProvider,
        redirect_url: redirectUrl,
      },
      { signal }
    );
  },
};
