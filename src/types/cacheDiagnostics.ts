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
export interface CacheFieldDiff {
  field: string;
  kind: 'added' | 'removed' | 'changed';
  beforeValue?: string;
  afterValue?: string;
  turnExpected: boolean;
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
  input_tokens?: number;
  cache_references: CacheRouteReference[];
  cache_write_by_ttl?: Record<string, number>;
  cache_control?: { breakpoints: number; five_minutes?: number; one_hour?: number };
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
  trace_id?: string;
  input_session?: CacheRouteReference;
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

export type CacheRouteKind =
  'input_session' | 'outbound_session' | 'cache_group' | 'pck' | 'named_cache';

export interface CacheRouteKey {
  kind: CacheRouteKind;
  digest: string;
  scope?: string;
}

export interface CacheRouteReference extends CacheRouteKey {
  method: 'inbound' | 'client' | 'outbound' | 'strict_prefix' | 'retained_group';
  source?: string;
}

export interface CacheRouteSelection {
  method: string;
  result: string;
  prefix_length?: number;
  prefix_unit?: string;
}

export interface CacheRouteSummary {
  version: 1;
  references: CacheRouteReference[];
  selection?: CacheRouteSelection;
  attempt_count: number;
  no_parsed_response?: boolean;
  truncated?: boolean;
  official_loss?: boolean;
}

export interface CacheTraceLocation {
  instance_id?: string;
  diagnostics_id?: string;
  request_id?: string;
  attempt?: number;
  trace_id?: string;
}

export type CachePreviousSource = 'previous_response_id' | 'thread.previous_message_id' | 'diagnostics.previous_message_id';

export interface CacheTraceRow extends CacheTraceLocation {
  at: string;
  model: string;
  auth_index?: string;
  trace_id?: string;
  logical_request_id?: string;
  response_id?: string;
  available: boolean;
  attempt_count?: number;
  status?: number;
  outcome?: string;
  matched: string[];
  input_tokens?: number;
  cache_observation?: CacheObservation;
  cache_route?: CacheRouteSummary;
  previous?: CacheTraceLocation;
  previous_source?: CachePreviousSource;
}

export type CacheTraceFocus = '' | 'zero_read' | 'retry' | 'official_loss';

export interface CacheTraceQuery {
  q?: string;
  instance_id?: string;
  focus?: CacheTraceFocus;
  kind?: CacheRouteKind;
  digest?: string;
  scope?: string;
  cursor?: string;
}

export interface CacheTracePage {
  version: 1;
  current_instance_id: string;
  items: CacheTraceRow[];
  next_cursor?: string;
}

export interface CacheDiagnosticsCapabilities {
  version?: number;
  recording_enabled?: boolean;
  trace_search_version?: number;
  store?: { instance_id?: string };
}
