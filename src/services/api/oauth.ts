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
  | 'copilot'
  | 'devin'
  | 'meta';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  user_code?: string;
  expires_in?: number;
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

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'xai', 'devin'];
const V8_AUTH_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  anthropic: 'claude',
};
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini',
};

export interface SiwcBindResponse {
  status: 'ok'; url: string; state: string; flow: 'siwc_bind'; expires_in: number;
}
export function captureSiwcBindingApi() {
  const client = apiClient.captureConnection();
  return {
    start: (name: string) => client.post<SiwcBindResponse>('/oauth/siwc/bind', { name }),
    cancel: (state: string) => client.delete('/oauth/session', { params: { state } }),
    status: (state: string, signal?: AbortSignal) => client.get<{status:'ok'|'wait'|'error';error?:string}>('/oauth/status', {params:{state},signal}),
    callback: (redirect_url: string, signal?: AbortSignal) => client.post('/oauth/callback', {provider:'codex',redirect_url}, {signal}),
  };
}

export interface OAuthStartOptions {
  projectId?: string;
  signal?: AbortSignal;
  client?: ReturnType<typeof apiClient.captureConnection>;
  /**
   * Login proxy. Core only accepts `proxy_url` in a POST body (a
   * query-string proxy_url is rejected), so a non-empty value switches the
   * request to POST with provider/is_webui in the body; blank keeps the
   * original GET form. Port of upstream 6b1b94a7 with the per-credential
   * persistence confirmed against Core 27f3abfb: the proxy is used for this
   * login and, once it succeeds, saved to the new credential for later
   * requests; only the page-side input is memory-only.
   */
  proxyUrl?: string;
}

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: OAuthStartOptions) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    // v8 dispatches by provider query; Core names the Anthropic flow `claude`.
    params.provider = V8_AUTH_PROVIDER_MAP[provider] ?? provider;
    const proxyUrl = options?.proxyUrl?.trim();
    if (proxyUrl) {
      // Core rejects proxy_url in the query string; provider/is_webui move
      // into the body. project_id stays a query parameter (Core reads the
      // project id only from the query string).
      const queryParams: Record<string, string | boolean> = {};
      if (provider === 'gemini-cli' && options?.projectId) {
        queryParams.project_id = options.projectId;
      }
      return (options?.client ?? apiClient).post<OAuthStartResponse>(
        '/oauth/auth-url',
        {
          provider: params.provider,
          is_webui: params.is_webui,
          proxy_url: proxyUrl,
        },
        {
          params: queryParams,
          signal: options?.signal,
        }
      );
    }
    return (options?.client ?? apiClient).get<OAuthStartResponse>('/oauth/auth-url', {
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
