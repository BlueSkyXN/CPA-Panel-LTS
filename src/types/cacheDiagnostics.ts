export type CacheFieldState = 'present' | 'absent' | 'invalid';
export interface CacheTokenObservation {
  state: CacheFieldState;
  value?: number;
  source?: string;
}
export interface CacheObservation {
  version: 1;
  read: CacheTokenObservation;
  write: CacheTokenObservation;
}
export interface CachePayload {
  known: boolean;
  reason?: string;
  bytes: number;
  fields: Record<string, { digest: string; value?: string }>;
}
export interface CacheDecision {
  sequence: number;
  decision_id?: string;
  execution_id?: string;
  selection_id?: string;
  layer: string;
  method: string;
  result: string;
  reason?: string;
  auth_index?: string;
  object_hash?: string;
  identity_hash?: string;
  prefix_length?: number;
  prefix_unit?: string;
  examined?: number;
  changes: string[];
}
export interface CacheAttempt {
  number: number;
  decision_id?: string;
  execution_id: string;
  provider: string;
  model: string;
  auth_index?: string;
  auth_type?: string;
  transport: string;
  endpoint: string;
  status?: number;
  outcome: string;
  input?: CachePayload;
  request: CachePayload;
  response_id?: string;
  response_model?: string;
  response_status?: string;
  observation_state?: string;
  comparison_id_sent: string;
  diagnostic_returned: boolean;
  diagnostic?: {
    type: string;
    reason?: string;
    cache_missed_tokens?: number;
    comparison_reusable_tokens?: number;
  };
  cache_observation?: CacheObservation;
  response_truncated: boolean;
}
export interface CacheTrace {
  version: 1;
  id: string;
  instance_id: string;
  logical_request_id: string;
  session_hash?: string;
  model: string;
  source_format: string;
  created_at: string;
  updated_at: string;
  input: CachePayload;
  events: CacheDecision[];
  attempts: CacheAttempt[];
  truncated: boolean;
}
export interface CacheAffinitySnapshot {
  status: string;
  at: string;
  truncated: boolean;
  rows: Array<{
    kind: string;
    object_hash: string;
    group_hash: string;
    prefix_length?: number;
    prefix_unit: string;
    last_activity: string;
    expires_at: string;
    expired: boolean;
  }>;
}
export interface CacheSessionSnapshot {
  instance_id: string;
  oauth?: CacheAffinitySnapshot;
  status: string;
  at: string;
  session_hash: string;
  truncated: boolean;
  bindings: Array<{
    kind: string;
    auth_index?: string;
    prefix_length?: number;
    prefix_unit?: string;
    expires_at: string;
    expired: boolean;
  }>;
}
