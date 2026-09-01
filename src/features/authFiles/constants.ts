import type { TFunction } from 'i18next';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconIflow from '@/assets/icons/iflow.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import type { AuthFileItem } from '@/types';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { parseTimestamp } from '@/utils/timestamp';

export type ThemeColors = { bg: string; text: string; border?: string };
export type AuthFileModelItem = {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
};
export type AuthFileIconAsset = string;

export type QuotaProviderType = 'antigravity' | 'claude' | 'codex' | 'gemini-cli' | 'kimi' | 'xai';
export type OAuthConfigLoadError = 'loading' | 'unsupported' | 'load' | null;

export const canWriteOAuthConfig = (options: {
  baselineReady: boolean;
  loadError: string | null;
  unsupported: boolean;
}): boolean => options.baselineReady && options.loadError === null && !options.unsupported;

export const QUOTA_PROVIDER_TYPES = new Set<QuotaProviderType>([
  'antigravity',
  'claude',
  'codex',
  'gemini-cli',
  'kimi',
  'xai',
]);

export const OAUTH_PROVIDER_PRESETS = [
  'gemini-cli',
  'vertex',
  'aistudio',
  'antigravity',
  'xai',
  'claude',
  'codex',
  'kimi',
];

const OAUTH_PROVIDER_EXCLUDES = new Set(['all', 'unknown', 'empty']);

export const MIN_CARD_PAGE_SIZE = 3;
export const MAX_CARD_PAGE_SIZE = 30;
export const AUTH_FILE_REFRESH_WARNING_MS = 24 * 60 * 60 * 1000;

export const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;
export const TRUTHY_TEXT_VALUES = new Set(['true', '1', 'yes', 'y', 'on']);
export const FALSY_TEXT_VALUES = new Set(['false', '0', 'no', 'n', 'off']);
export const AUTH_FILE_WEBSOCKET_PROVIDERS = new Set(['codex', 'xai']);
export const AUTH_FILE_USING_API_PROVIDERS = new Set(['xai']);

// 标签类型颜色配置 — 基于各提供商 Logo 品牌色调配，确保彼此不重复
export const TYPE_COLORS: Record<string, ThemeColors> = {
  qwen: { bg: '#ede5fd', text: '#5530c7' },
  kimi: { bg: '#dce8ff', text: '#0560cf' },
  gemini: { bg: '#e3f2fd', text: '#1565c0' },
  'gemini-cli': { bg: '#e0e8ff', text: '#1e4fa3' },
  aistudio: { bg: '#f0f2f5', text: '#2f343c' },
  claude: { bg: '#fbece4', text: '#c05621' },
  codex: { bg: '#eae7ff', text: '#3538d4' },
  antigravity: { bg: '#e0f7fa', text: '#006064' },
  xai: { bg: '#f3f4f6', text: '#111827', border: '1px solid #d1d5db' },
  iflow: { bg: '#f5e3fc', text: '#9025c8' },
  vertex: { bg: '#e4edfd', text: '#2b5fbc' },
  empty: { bg: '#f5f5f5', text: '#616161' },
  unknown: { bg: '#f0f0f0', text: '#666666', border: '1px dashed #999999' },
};

export const AUTH_FILE_ICONS: Record<string, AuthFileIconAsset> = {
  antigravity: iconAntigravity,
  aistudio: iconGemini,
  claude: iconClaude,
  codex: iconCodex,
  gemini: iconGemini,
  'gemini-cli': iconGemini,
  xai: iconGrok,
  iflow: iconIflow,
  kimi: iconKimiLight,
  qwen: iconQwen,
  vertex: iconVertex,
};

export const clampCardPageSize = (value: number) =>
  Math.min(MAX_CARD_PAGE_SIZE, Math.max(MIN_CARD_PAGE_SIZE, Math.round(value)));

export const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};

export const normalizeProviderKey = normalizeOAuthProviderKey;

export const buildOAuthProviderOptions = (values: Iterable<unknown>): string[] => {
  const extraProviders = new Set<string>();

  Array.from(values).forEach((value) => {
    const key = normalizeProviderKey(String(value ?? ''));
    if (!key || OAUTH_PROVIDER_EXCLUDES.has(key)) return;
    extraProviders.add(key);
  });

  const baseSet = new Set(OAUTH_PROVIDER_PRESETS.map((value) => normalizeProviderKey(value)));
  const extraList = Array.from(extraProviders)
    .filter((value) => !baseSet.has(value))
    .sort((a, b) => a.localeCompare(b));

  return [...OAUTH_PROVIDER_PRESETS, ...extraList];
};

export const getAuthFileStatusMessage = (file: AuthFileItem): string => {
  const raw = file['status_message'] ?? file.statusMessage;
  if (typeof raw === 'string') return raw.trim();
  if (raw == null) return '';
  return String(raw).trim();
};

export const HEALTHY_AUTH_FILE_STATUS_MESSAGES = new Set([
  'ok',
  'healthy',
  'ready',
  'success',
  'available',
]);

export const hasAuthFileStatusWarning = (file: AuthFileItem): boolean => {
  const message = getAuthFileStatusMessage(file);
  return Boolean(message) && !HEALTHY_AUTH_FILE_STATUS_MESSAGES.has(message.toLowerCase());
};

/** Disabled credentials are an operator choice, not a problem result. */
export const isProblemAuthFile = (file: AuthFileItem): boolean => {
  const status = typeof file.status === 'string' ? file.status.trim().toLowerCase() : '';
  if (file.disabled === true || status === 'disabled') return false;
  return file.unavailable === true || status === 'error' || hasAuthFileStatusWarning(file);
};

export const getTypeLabel = (t: TFunction, type: string): string => {
  const providerKey = normalizeProviderKey(type);
  const key = `auth_files.filter_${providerKey}`;
  const translated = t(key);
  if (translated !== key) return translated;
  if (providerKey === 'iflow') return 'iFlow';
  return type.charAt(0).toUpperCase() + type.slice(1);
};

export const getTypeColor = (type: string): ThemeColors =>
  TYPE_COLORS[normalizeProviderKey(type)] || TYPE_COLORS.unknown;

export const getAuthFileIcon = (type: string): string | null =>
  AUTH_FILE_ICONS[normalizeProviderKey(type)] || null;

export const THEME_SURFACE_ICON_PROVIDERS = new Set(['kimi']);

export const isThemeSurfaceIconProvider = (type: string): boolean =>
  THEME_SURFACE_ICON_PROVIDERS.has(normalizeProviderKey(type));

export const getThemeSurfaceIconBackground = (): string => '#000000';

export const parsePriorityValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : undefined;
  }

  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

export const normalizeExcludedModels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  value.forEach((entry) => {
    const model = String(entry ?? '')
      .trim()
      .toLowerCase();
    if (!model || seen.has(model)) return;
    seen.add(model);
    normalized.push(model);
  });

  return normalized.sort((a, b) => a.localeCompare(b));
};

export const parseExcludedModelsText = (value: string): string[] =>
  normalizeExcludedModels(value.split(/[\n,]+/));

export const parseDisableCoolingValue = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TRUTHY_TEXT_VALUES.has(normalized)) return true;
  if (FALSY_TEXT_VALUES.has(normalized)) return false;
  return undefined;
};

export const supportsAuthFileWebsockets = (providerKey: string): boolean =>
  AUTH_FILE_WEBSOCKET_PROVIDERS.has(normalizeProviderKey(providerKey));

export const readAuthFileWebsockets = (value: Record<string, unknown>): boolean =>
  parseDisableCoolingValue(value.websockets ?? value.websocket) ?? false;

export const applyAuthFileWebsockets = (
  value: Record<string, unknown>,
  websockets: boolean
): Record<string, unknown> => {
  const next = { ...value };
  delete next.websocket;
  next.websockets = websockets;
  return next;
};

export const supportsAuthFileUsingApi = (providerKey: string): boolean =>
  AUTH_FILE_USING_API_PROVIDERS.has(normalizeProviderKey(providerKey));

export const readAuthFileUsingApi = (value: Record<string, unknown>): boolean => {
  const raw = value.using_api;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return false;

  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 't' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'f' || normalized === 'false') return false;
  return false;
};

export const applyAuthFileUsingApi = (
  value: Record<string, unknown>,
  usingApi: boolean
): Record<string, unknown> => ({ ...value, using_api: usingApi });

export function isRuntimeOnlyAuthFile(file: AuthFileItem): boolean {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

export const formatModified = (item: AuthFileItem): string => {
  const raw = item['modtime'] ?? item.modified;
  if (!raw) return '-';
  const asNumber = Number(raw);
  const date =
    Number.isFinite(asNumber) && !Number.isNaN(asNumber)
      ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
      : (parseTimestamp(raw) ?? new Date(String(raw)));
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

// 检查模型是否被 OAuth 排除
export const isModelExcluded = (
  modelId: string,
  providerType: string,
  excluded: Record<string, string[]>
): boolean => {
  const providerKey = normalizeProviderKey(providerType);
  const excludedModels = excluded[providerKey] || excluded[providerType] || [];
  return excludedModels.some((pattern) => {
    if (pattern.includes('*')) {
      // 支持通配符匹配：先转义正则特殊字符，再将 * 视为通配符
      const regexSafePattern = pattern
        .split('*')
        .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      const regex = new RegExp(`^${regexSafePattern}$`, 'i');
      return regex.test(modelId);
    }
    return pattern.toLowerCase() === modelId.toLowerCase();
  });
};
