/**
 * Quota constants for API URLs, headers, and group definitions.
 */

import type { GeminiCliQuotaGroupDefinition } from '@/types';

// Antigravity API configuration
export const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
];

export const ANTIGRAVITY_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export const ANTIGRAVITY_CLI_VERSION = '1.0.13';
export const ANTIGRAVITY_CLIENT_NAME = 'aidev_client';
export const ANTIGRAVITY_CLIENT_PLATFORM = {
  osType: 'darwin',
  arch: 'arm64',
} as const;

type AntigravityUserAgentOptions = {
  version?: string;
  clientName?: string;
  osType?: string;
  arch?: string;
};

export const buildAntigravityUserAgent = ({
  version = ANTIGRAVITY_CLI_VERSION,
  clientName = ANTIGRAVITY_CLIENT_NAME,
  osType = ANTIGRAVITY_CLIENT_PLATFORM.osType,
  arch = ANTIGRAVITY_CLIENT_PLATFORM.arch,
}: AntigravityUserAgentOptions = {}) =>
  `antigravity/cli/${version} (${clientName}; os_type=${osType}; arch=${arch})`;

export const ANTIGRAVITY_USER_AGENT = buildAntigravityUserAgent();

export const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': ANTIGRAVITY_USER_AGENT,
};

// Gemini CLI API configuration
export const GEMINI_CLI_QUOTA_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

export const GEMINI_CLI_CODE_ASSIST_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export const GEMINI_CLI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
};

export const GEMINI_CLI_QUOTA_GROUPS: GeminiCliQuotaGroupDefinition[] = [
  {
    id: 'gemini-flash-lite-series',
    label: 'Gemini Flash Lite Series',
    preferredModelId: 'gemini-2.5-flash-lite',
    modelIds: ['gemini-2.5-flash-lite'],
  },
  {
    id: 'gemini-flash-series',
    label: 'Gemini Flash Series',
    preferredModelId: 'gemini-3-flash-preview',
    modelIds: ['gemini-3-flash-preview', 'gemini-2.5-flash'],
  },
  {
    id: 'gemini-pro-series',
    label: 'Gemini Pro Series',
    preferredModelId: 'gemini-3.1-pro-preview',
    modelIds: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro'],
  },
];

export const GEMINI_CLI_GROUP_ORDER = new Map(
  GEMINI_CLI_QUOTA_GROUPS.map((group, index) => [group.id, index] as const)
);

export const GEMINI_CLI_GROUP_LOOKUP = new Map(
  GEMINI_CLI_QUOTA_GROUPS.flatMap((group) =>
    group.modelIds.map((modelId) => [modelId, group] as const)
  )
);

export const GEMINI_CLI_IGNORED_MODEL_PREFIXES = ['gemini-2.0-flash'];

// Claude API configuration
export const CLAUDE_PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export const CLAUDE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-beta': 'oauth-2025-04-20',
};

export const CLAUDE_USAGE_WINDOW_KEYS = [
  { key: 'five_hour', id: 'five-hour', labelKey: 'claude_quota.five_hour' },
  { key: 'seven_day', id: 'seven-day', labelKey: 'claude_quota.seven_day' },
  {
    key: 'seven_day_oauth_apps',
    id: 'seven-day-oauth-apps',
    labelKey: 'claude_quota.seven_day_oauth_apps',
  },
  { key: 'seven_day_opus', id: 'seven-day-opus', labelKey: 'claude_quota.seven_day_opus' },
  { key: 'seven_day_sonnet', id: 'seven-day-sonnet', labelKey: 'claude_quota.seven_day_sonnet' },
  { key: 'seven_day_cowork', id: 'seven-day-cowork', labelKey: 'claude_quota.seven_day_cowork' },
  { key: 'iguana_necktie', id: 'seven-day-fable', labelKey: 'claude_quota.seven_day_fable' },
] as const;

// Codex API configuration
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

export const CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';

export const CODEX_DAILY_USAGE_URL =
  'https://chatgpt.com/backend-api/wham/analytics/daily-workspace-usage-counts';

export const CODEX_TEAM_USAGE_LEADERBOARD_URL =
  'https://chatgpt.com/backend-api/wham/analytics/usage-leaderboard';

export const CODEX_USD_PER_CREDIT = 40 / 1000;

export const CODEX_ANALYTICS_ROLLING_DAYS = 30;

export const CODEX_REQUEST_HEADERS = {
  Accept: 'application/json',
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
};

// Kimi API configuration
export const KIMI_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';

export const KIMI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
};

// xAI/Grok API configuration
export const XAI_BILLING_WEEKLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
export const XAI_BILLING_MONTHLY_URL = 'https://cli-chat-proxy.grok.com/v1/billing';
export const XAI_USER_URL = 'https://cli-chat-proxy.grok.com/v1/user';
export const XAI_AUTO_TOPUP_URL = 'https://cli-chat-proxy.grok.com/v1/auto-topup-rule';
export const XAI_GROK_CLIENT_VERSION = '1.0.3';

type NavigatorUADataLike = {
  platform?: string;
};

const normalizeXaiPlatform = (platform: string, userAgent: string): string => {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (value.includes('mac')) return 'macos';
  if (value.includes('win')) return 'windows';
  if (value.includes('linux')) return 'linux';
  return 'unknown';
};

const normalizeXaiArchitecture = (platform: string, userAgent: string): string => {
  const value = `${platform} ${userAgent}`.toLowerCase();
  if (/\b(?:arm64|aarch64)\b/.test(value)) return 'aarch64';
  if (/\b(?:x86_64|x64|win64|amd64)\b/.test(value)) return 'x86_64';
  // Browsers commonly reduce desktop platform strings to MacIntel/Win32 and
  // omit the CPU token from the UA. Preserve that exposed x86-compatible
  // identity instead of inventing ARM; explicit ARM markers above still win.
  if (/\b(?:macintel|win32)\b/.test(value)) return 'x86_64';
  return 'unknown';
};

export const buildXaiGrokUserAgent = (
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  userAgentDataPlatform =
    typeof navigator === 'undefined'
      ? ''
      : ((navigator as Navigator & { userAgentData?: NavigatorUADataLike }).userAgentData
          ?.platform ?? '')
): string => {
  const platformIdentity = `${userAgentDataPlatform} ${platform}`.trim();
  const osName = normalizeXaiPlatform(platformIdentity, userAgent);
  const archName = normalizeXaiArchitecture(platformIdentity, userAgent);
  return (
    `grok-pager/${XAI_GROK_CLIENT_VERSION} ` +
    `grok-shell/${XAI_GROK_CLIENT_VERSION} (${osName}; ${archName})`
  );
};

export const buildXaiRequestHeaders = (): Record<string, string> => ({
  Authorization: 'Bearer $TOKEN$',
  'x-xai-token-auth': 'xai-grok-cli',
  'x-grok-client-version': XAI_GROK_CLIENT_VERSION,
  'x-grok-client-mode': 'interactive',
  accept: 'application/json',
  'user-agent': buildXaiGrokUserAgent(),
});
