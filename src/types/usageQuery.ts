import type { UsageDetail } from '@/utils/usage';

export interface UsageQuerySession {
  version: 1;
  bound: string;
  now_ms: number;
  models: string[];
  max_page_size: number;
}
export interface UsageQueryIdentity {
  source: string;
  auth_index: string;
}
export interface UsageQueryFilter {
  model?: string;
  api?: string;
  auth_index?: string;
  identities?: UsageQueryIdentity[];
  tier?: 'fast' | 'std';
  effort?: string;
  failed?: boolean;
  cached?: boolean;
  metric?: string;
  minimum?: number;
  maximum?: number;
}
export type UsageQueryModule =
  | 'models'
  | 'api_models'
  | 'credentials'
  | 'hours'
  | 'days'
  | 'minutes'
  | 'rates'
  | 'status'
  | 'health';
export interface UsageQueryRequest {
  bound?: string;
  now_ms?: number;
  from_ms?: number;
  to_ms?: number;
  hour_from_ms?: number;
  timezone?: string;
  modules?: UsageQueryModule[];
  filter?: UsageQueryFilter;
  limit?: number;
  cursor?: string;
  include_options?: boolean;
  rules?: Record<string, { long_threshold?: number }>;
}
export interface UsageQueryRatio {
  numerator: number;
  denominator: number;
  samples: number;
}
export interface UsageQueryPriceGroup {
  model: string;
  tier: 'std' | 'fast';
  evidence: 'effective' | 'response' | 'outbound' | 'request' | 'assumed';
  band: 'short' | 'long';
  requests: number;
  tokens: number;
  prompt: number;
  cache_read: number;
  cache_write: number;
  output: number;
}
export interface UsageQueryMetrics {
  requests: number;
  success: number;
  failure: number;
  tokens: number;
  input: number;
  output: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
  prompt: number;
  latency_ms: number;
  latency_samples: number;
  ttfb_samples: number;
  output_tps: UsageQueryRatio;
  average_tps: UsageQueryRatio;
  visible_tps: UsageQueryRatio;
  reasoning_ratio: UsageQueryRatio;
  prices?: UsageQueryPriceGroup[];
}
export interface UsageQueryGroup {
  api?: string;
  model?: string;
  source?: string;
  auth_index?: string;
  start_ms?: number;
  metrics: UsageQueryMetrics;
}
export interface UsageQuerySummary {
  version: 1;
  bound: string;
  now_ms: number;
  totals: UsageQueryMetrics;
  groups: Partial<Record<UsageQueryModule, UsageQueryGroup[]>>;
}
export interface UsageQueryItem {
  id: string;
  api: string;
  model: string;
  detail: UsageDetail;
}
export interface UsageQueryOptions {
  models: string[];
  apis: string[];
  identities: UsageQueryIdentity[];
  auth_indices: string[];
  efforts: string[];
  metrics: UsageQueryMetrics;
}
export interface UsageQueryDetails {
  version: 1;
  bound: string;
  items: UsageQueryItem[];
  total: number;
  next_cursor?: string;
  metrics: UsageQueryMetrics;
  options?: UsageQueryOptions;
}
