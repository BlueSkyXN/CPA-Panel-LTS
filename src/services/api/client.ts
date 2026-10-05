/**
 * Axios API 客户端
 * 替代原项目 src/core/api-client.js
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { ApiClientConfig, ApiError } from '@/types';
import {
  BUILD_DATE_HEADER_KEYS,
  CPA_BUILD_DATE_HEADER_KEYS,
  CPA_SUPPORT_PLUGIN_HEADER_KEYS,
  CPA_VERSION_HEADER_KEYS,
  HOME_BUILD_DATE_HEADER_KEYS,
  HOME_VERSION_HEADER_KEYS,
  LTS_EXTENSION_API_PREFIX,
  MANAGEMENT_API_PREFIX,
  REQUEST_TIMEOUT_MS,
  VERSION_HEADER_KEYS,
} from '@/utils/constants';
import { normalizeApiBase } from '@/utils/connection';
import { normalizeReportedVersion } from '@/utils/version';
import type { ServerRuntimeKind } from '@/types';
import { parseApiErrorResponse } from './apiError';
import { beginSessionWrite, isSessionFrozen } from '@/services/connectionSession';

/**
 * v8 是 Core 的原生管理协议；lts 前缀仅承载 Core 尚无 v8 等价路由的 LTS 扩展
 * （完整 usage、Flow、插件 readiness、插件自有路由等）。两者共享同一份连接状态。
 */
export type ManagementApiScope = 'v8' | 'lts';

type ConnectionScopedRequestConfig = AxiosRequestConfig & {
  __cpaConnectionGeneration?: number;
  __cpaApiScope?: ManagementApiScope;
  __finishSessionWrite?: () => void;
};

type RequestConfig = AxiosRequestConfig;

// 这些 Management POST 仅查询统计，不属于需要阻止实例切换的写操作。
const READ_ONLY_USAGE_POSTS = new Set([
  '/usage/query/summary',
  '/usage/query/details',
  '/usage/query/pricing',
]);

function isMutationRequest(config: AxiosRequestConfig): boolean {
  const method = (config.method || 'get').toLowerCase();
  return (
    !['get', 'head', 'options'].includes(method) &&
    !(method === 'post' && READ_ONLY_USAGE_POSTS.has(config.url || ''))
  );
}

class ManagementTransport {
  readonly instance: AxiosInstance;
  private apiRoot: string = '';
  private managementKey: string = '';
  private connectionGeneration = 0;

  constructor() {
    this.instance = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * 设置 API 配置
   */
  setConfig(config: ApiClientConfig): number {
    this.connectionGeneration += 1;
    this.apiRoot = normalizeApiBase(config.apiBase);
    this.managementKey = config.managementKey;

    if (config.timeout) {
      this.instance.defaults.timeout = config.timeout;
    } else {
      this.instance.defaults.timeout = REQUEST_TIMEOUT_MS;
    }

    return this.connectionGeneration;
  }

  clearConfig(): void {
    this.connectionGeneration += 1;
    this.apiRoot = '';
    this.managementKey = '';
    this.instance.defaults.timeout = REQUEST_TIMEOUT_MS;
  }

  getConnectionGeneration(): number {
    return this.connectionGeneration;
  }

  isCurrentConnection(generation: number): boolean {
    return generation === this.connectionGeneration;
  }

  baseUrl(scope: ManagementApiScope): string {
    if (!this.apiRoot) return '';
    return `${this.apiRoot}${scope === 'lts' ? LTS_EXTENSION_API_PREFIX : MANAGEMENT_API_PREFIX}`;
  }

  private isCurrentRequest(config: unknown): boolean {
    const scopedConfig = config as ConnectionScopedRequestConfig | undefined;
    return scopedConfig?.__cpaConnectionGeneration === this.connectionGeneration;
  }

  private readHeader(headers: Record<string, unknown> | undefined, keys: string[]): string | null {
    if (!headers) return null;

    const normalizeValue = (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (Array.isArray(value)) {
        const first = value.find(
          (entry) => entry !== undefined && entry !== null && String(entry).trim()
        );
        return first !== undefined ? String(first) : null;
      }
      const text = String(value);
      return text ? text : null;
    };

    const headerGetter = (headers as { get?: (name: string) => unknown }).get;
    if (typeof headerGetter === 'function') {
      for (const key of keys) {
        const match = normalizeValue(headerGetter.call(headers, key));
        if (match) return match;
      }
    }

    const entries =
      typeof (headers as { entries?: () => Iterable<[string, unknown]> }).entries === 'function'
        ? Array.from((headers as { entries: () => Iterable<[string, unknown]> }).entries())
        : Object.entries(headers);

    const normalized = Object.fromEntries(
      entries.map(([key, value]) => [String(key).toLowerCase(), value])
    );
    for (const key of keys) {
      const match = normalizeValue(normalized[key.toLowerCase()]);
      if (match) return match;
    }
    return null;
  }

  private readBooleanHeader(
    headers: Record<string, unknown> | undefined,
    keys: string[]
  ): boolean | null {
    const value = this.readHeader(headers, keys);
    if (value === null) return null;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
  }

  /**
   * 设置请求/响应拦截器
   */
  private setupInterceptors(): void {
    // 请求拦截器
    this.instance.interceptors.request.use(
      (config) => {
        const mutation = isMutationRequest(config);
        if (isSessionFrozen() && mutation) throw new Error('Connection switch in progress');
        const scopedConfig = config as typeof config & ConnectionScopedRequestConfig;
        scopedConfig.__cpaConnectionGeneration = this.connectionGeneration;
        if (mutation) scopedConfig.__finishSessionWrite = beginSessionWrite();

        // 设置 baseURL：默认 v8 原生协议，LTS 扩展客户端显式声明 lts scope。
        config.baseURL = this.baseUrl(scopedConfig.__cpaApiScope ?? 'v8');

        // 添加认证头
        if (this.managementKey) {
          config.headers.Authorization = `Bearer ${this.managementKey}`;
        }

        return config;
      },
      (error) => {
        throw this.handleError(error);
      },
      { synchronous: true }
    );

    // 响应拦截器
    this.instance.interceptors.response.use(
      (response) => {
        (response.config as ConnectionScopedRequestConfig).__finishSessionWrite?.();
        if (!this.isCurrentRequest(response.config)) {
          return response;
        }

        const headers = response.headers as Record<string, string | undefined>;
        const homeVersion = normalizeReportedVersion(
          this.readHeader(headers, HOME_VERSION_HEADER_KEYS)
        );
        const homeBuildDate = this.readHeader(headers, HOME_BUILD_DATE_HEADER_KEYS);
        const cpaVersion = normalizeReportedVersion(
          this.readHeader(headers, CPA_VERSION_HEADER_KEYS)
        );
        const cpaBuildDate = this.readHeader(headers, CPA_BUILD_DATE_HEADER_KEYS);
        const version =
          homeVersion ||
          cpaVersion ||
          normalizeReportedVersion(this.readHeader(headers, VERSION_HEADER_KEYS));
        const buildDate =
          homeBuildDate || cpaBuildDate || this.readHeader(headers, BUILD_DATE_HEADER_KEYS);
        const supportsPlugin = this.readBooleanHeader(headers, CPA_SUPPORT_PLUGIN_HEADER_KEYS);
        const runtimeKind: ServerRuntimeKind | null =
          homeVersion || homeBuildDate ? 'home' : cpaVersion || cpaBuildDate ? 'cpa' : null;

        // 触发版本更新事件（后续通过 store 处理）
        if (version || buildDate || runtimeKind) {
          window.dispatchEvent(
            new CustomEvent('server-version-update', {
              detail: { version: version || null, buildDate: buildDate || null, runtimeKind },
            })
          );
        }
        if (supportsPlugin !== null) {
          window.dispatchEvent(
            new CustomEvent('server-plugin-support-update', {
              detail: { supportsPlugin },
            })
          );
        }

        return response;
      },
      (error) => {
        if (axios.isAxiosError(error))
          (error.config as ConnectionScopedRequestConfig | undefined)?.__finishSessionWrite?.();
        return Promise.reject(this.handleError(error));
      }
    );
  }

  /**
   * 错误处理
   */
  private handleError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const responseData: unknown = error.response?.data;
      const parsedError = parseApiErrorResponse(responseData, error.message);
      const apiError = new Error(parsedError.message) as ApiError;
      apiError.name = 'ApiError';
      apiError.status = error.response?.status;
      apiError.code = error.code;
      apiError.apiCode = parsedError.apiCode;
      apiError.details = responseData;
      apiError.data = responseData;
      // 保留响应头：v8 配置读取在 404 时同样返回当前 ETag。
      apiError.headers = error.response?.headers as Record<string, unknown> | undefined;

      // 401 未授权 - 触发登出事件
      if (error.response?.status === 401 && this.isCurrentRequest(error.config)) {
        window.dispatchEvent(new Event('unauthorized'));
      }

      return apiError;
    }

    const fallbackMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error occurred';
    const fallback = new Error(fallbackMessage) as ApiError;
    fallback.name = 'ApiError';
    return fallback;
  }
}

/** 共享连接状态的 Management API 客户端；scope 只决定协议前缀。 */
class ApiClient {
  constructor(
    private readonly transport: ManagementTransport,
    private readonly scope: ManagementApiScope
  ) {}

  /** Shared axios instance (tests install adapters here; both scopes use it). */
  get instance(): AxiosInstance {
    return this.transport.instance;
  }

  setConfig(config: ApiClientConfig): number {
    return this.transport.setConfig(config);
  }

  clearConfig(): void {
    this.transport.clearConfig();
  }

  getConnectionGeneration(): number {
    return this.transport.getConnectionGeneration();
  }

  /** Upstream 名称：读-改-写操作在连接切换（含 ABA）后必须放弃。 */
  getConnectionRevision(): number {
    return this.transport.getConnectionGeneration();
  }

  isCurrentConnection(generation: number): boolean {
    return this.transport.isCurrentConnection(generation);
  }

  private scoped(config?: RequestConfig): ConnectionScopedRequestConfig {
    return { ...config, __cpaApiScope: this.scope };
  }

  async get<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.transport.instance.get<T>(url, this.scoped(config));
    return response.data;
  }

  async post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.transport.instance.post<T>(url, data, this.scoped(config));
    return response.data;
  }

  async put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.transport.instance.put<T>(url, data, this.scoped(config));
    return response.data;
  }

  async patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    const response = await this.transport.instance.patch<T>(url, data, this.scoped(config));
    return response.data;
  }

  async delete<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    const response = await this.transport.instance.delete<T>(url, this.scoped(config));
    return response.data;
  }

  /** 获取原始响应（用于下载、ETag 等需要响应头的场景） */
  async getRaw(url: string, config?: RequestConfig): Promise<AxiosResponse> {
    return this.transport.instance.get(url, this.scoped(config));
  }

  async postForm<T = unknown>(url: string, formData: FormData, config?: RequestConfig): Promise<T> {
    const response = await this.transport.instance.post<T>(
      url,
      formData,
      this.scoped({
        ...config,
        headers: { ...(config?.headers || {}), 'Content-Type': 'multipart/form-data' },
      })
    );
    return response.data;
  }

  async requestRaw(config: RequestConfig): Promise<AxiosResponse> {
    return this.transport.instance.request(this.scoped(config));
  }
}

// 导出单例
const transport = new ManagementTransport();
/** v8 原生 Management API（`/v8/management`）。 */
export const apiClient = new ApiClient(transport, 'v8');
/** LTS 扩展 Management API（`/v0/management`），与 apiClient 共享认证与连接代际。 */
export const ltsExtensionClient = new ApiClient(transport, 'lts');
