export type PatProvider = 'codebuddy' | 'qoder';

export const isPatProvider = (value: unknown): value is PatProvider =>
  value === 'codebuddy' || value === 'qoder';

export function newPatAuthFileName(provider: PatProvider): string {
  // getRandomValues 在普通 HTTP 管理页面也可用；randomUUID 仅限安全上下文。
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `${provider}-${id}.json`;
}

export function buildPatAuth(
  provider: PatProvider,
  label: string,
  value: string,
  previous?: Record<string, unknown>
): Record<string, unknown> {
  const pat = value.trim();
  if (
    !pat ||
    pat.includes('\n') ||
    pat.includes('\r') ||
    pat.includes('\0') ||
    (provider === 'qoder' && !pat.startsWith('pt-'))
  ) {
    throw new Error('invalid_pat');
  }
  if (previous && previous.type !== provider) throw new Error('provider_mismatch');
  if (previous?.auth_mode === 'local_cli') throw new Error('local_cli_not_pat');
  const auth = { ...previous, type: provider, auth_mode: 'pat', pat, label: label.trim() };
  // 更新长期凭据时不能留下与新 PAT 冲突的旧凭据；其余账号配置保持不变。
  delete (auth as Record<string, unknown>).access_token;
  delete (auth as Record<string, unknown>).api_key;
  return auth;
}

export interface PatQuotaValues {
  name: string;
  status: string;
  unit: string;
  total: string;
  used: string;
  remaining: string;
  expiresAt: string;
  available?: boolean;
}

export interface PatSummary {
  label: string;
  accountName: string;
  accountStatus: string;
  planName: string;
  planStatus: string;
  quota: PatQuotaValues;
  packages: PatQuotaValues[];
  updatedAt: string;
  cached: boolean;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: Record<string, unknown>, key: string): string => {
  const exact = text(value[`${key}_exact`]);
  if (/^-?\d+(?:\.\d+)?$/.test(exact)) return exact;
  const number = value[key];
  return typeof number === 'number' && Number.isFinite(number) ? String(number) : '—';
};
const quotaValues = (input: unknown): PatQuotaValues => {
  const value = record(input);
  return {
    name: text(value.name),
    status: text(value.status) || 'unknown',
    unit: text(value.unit),
    total: amount(value, 'total'),
    used: amount(value, 'used'),
    remaining: amount(value, 'remaining'),
    expiresAt: text(value.expires_at) || text(value.cycle_end),
    available: typeof value.available === 'boolean' ? value.available : undefined,
  };
};

export function parsePatSummary(
  input: unknown,
  provider: PatProvider,
  authIndex: string
): PatSummary {
  const source = record(input);
  if (source.provider !== provider || source.auth_index !== authIndex)
    throw new Error('invalid_summary');
  const account = record(source.account);
  const plan = record(source.plan);
  const quota = record(source.quota);
  return {
    label: text(source.label),
    accountName: text(account.name) || text(account.email),
    accountStatus: text(account.status) || 'unknown',
    planName: text(plan.name) || text(plan.plan_tier),
    planStatus: text(plan.status) || 'unknown',
    quota: quotaValues(quota),
    packages: Array.isArray(quota.packages) ? quota.packages.map(quotaValues) : [],
    updatedAt: text(source.updated_at),
    cached: source.cached === true,
  };
}
