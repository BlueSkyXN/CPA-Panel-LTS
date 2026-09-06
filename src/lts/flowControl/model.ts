// Control characters are rejected in identifiers and free-text labels to keep
// them out of YAML output and logs. The NUL byte is intentional here.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\r\n\x00]/;
export const FLOW_STAGES = ['request', 'attempt'] as const;
export const FLOW_SCOPES = ['global', 'key', 'model', 'key-model', 'provider', 'account', 'account-model', 'credential', 'credential-model', 'key-account', 'key-account-model', 'key-credential', 'key-credential-model', 'custom'] as const;
export interface FlowWindow extends Record<string, unknown> {
    requests: number;
    'period-ms': number;
}
export interface FlowRule extends Record<string, unknown> {
    models?: string[];
    keys?: string[];
    accounts?: string[];
    id: string;
    stage: string;
    scope: string;
    label?: string;
    'group-by'?: string[];
    credential?: string;
    'auth-kind'?: string;
    key?: string;
    model?: string;
    provider?: string;
    account?: string;
    'max-concurrent': number;
    windows?: FlowWindow[];
}
export const FLOW_DEFAULT_VALUES = {
    flowControlEnabled: false,
    flowControlVersion: '3',
    flowControlRealtime: false,
    flowControlResources: false,
    flowControlIntervalMs: '',
    flowControlMaxObservers: '',
    flowControlRulesText: '[]',
    flowControlMaxWaiting: '',
    flowControlMaxWaitingPerKey: '',
    flowControlMaxBytes: '',
    flowControlMaxWaitMs: '',
    flowControlMaxBuckets: '',
    flowControlMaxHistory: '',
};
export type FlowControlValues = typeof FLOW_DEFAULT_VALUES;
export const FLOW_FIELDS = Object.keys(FLOW_DEFAULT_VALUES) as Array<keyof FlowControlValues>;
export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}
const text = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
export function readFlowControlValues(parsed: Record<string, unknown>): FlowControlValues {
    const flow = asRecord(parsed['flow-control']);
    const queue = asRecord(flow?.queue);
    const observation = asRecord(flow?.observation);
    return {
        flowControlEnabled: flow?.enabled === true,
        flowControlVersion: text(flow?.version) || (!flow || (!flow.enabled && (flow.rules === undefined || (Array.isArray(flow.rules) && flow.rules.length === 0))) ? '3' : ''),
        flowControlRealtime: observation?.realtime === true,
        flowControlResources: observation?.resources === true,
        flowControlIntervalMs: text(observation?.['interval-ms']),
        flowControlMaxObservers: text(observation?.['max-observers']),
        // Keep unknown future fields in rules intact, including disabled drafts.
        flowControlRulesText: JSON.stringify(flow?.rules ?? [], null, 2),
        flowControlMaxWaiting: text(queue?.['max-waiting']),
        flowControlMaxWaitingPerKey: text(queue?.['max-waiting-per-key']),
        flowControlMaxBytes: text(queue?.['max-bytes']),
        flowControlMaxWaitMs: text(queue?.['max-wait-ms']),
        flowControlMaxBuckets: text(flow?.['max-buckets']),
        flowControlMaxHistory: text(flow?.['max-history']),
    };
}
export function parseRules(raw: string): FlowRule[] | null {
    try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value) && value.every((rule) => !!asRecord(rule)) ? value as FlowRule[] : null;
    }
    catch {
        return null;
    }
}
export function nextRule(rules: FlowRule[]): FlowRule {
    let n = 1;
    while (rules.some((r) => r.id === `rule-${n}`))
        n++;
    return { id: `rule-${n}`, stage: 'attempt', scope: 'custom', 'group-by': ['account'], 'max-concurrent': 0 };
}
const opaque = /^(anonymous|[a-f0-9]{64}|\*)$/;
const integer = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
export interface FlowIssue {
    code: string;
    rule?: number;
}
export function flowIssues(values: FlowControlValues): FlowIssue[] {
    const issues: FlowIssue[] = [];
    const interval = values.flowControlIntervalMs.trim(), observers = values.flowControlMaxObservers.trim();
    if ((interval && (!/^\d+$/.test(interval) || !integer(Number(interval), 500, 30000))) || (observers && (!/^\d+$/.test(observers) || !integer(Number(observers), 1, 16))))
        issues.push({ code: 'invalid_observation' });
    if (!values.flowControlEnabled)
        return issues;
    const version = Number(values.flowControlVersion || 0);
    if (!integer(version, 0, 3))
        issues.push({ code: 'v3_required' });
    const scalar = (raw: string, max: number): number => {
        if (!raw.trim())
            return 0;
        if (!/^\d+$/.test(raw.trim()) || !integer(Number(raw), 0, max)) {
            issues.push({ code: 'invalid_number' });
            return 0;
        }
        return Number(raw);
    };
    const waiting = scalar(values.flowControlMaxWaiting, 10000);
    const perKey = scalar(values.flowControlMaxWaitingPerKey, 10000) || waiting;
    scalar(values.flowControlMaxBytes, 4294967296);
    const waitMs = scalar(values.flowControlMaxWaitMs, 300000);
    scalar(values.flowControlMaxBuckets, 100000);
    const history = scalar(values.flowControlMaxHistory, 2000000) || 200000;
    if (perKey > waiting || (version < 3 && waiting > 0 && waitMs === 0))
        issues.push({ code: 'invalid_queue' });
    const rules = parseRules(values.flowControlRulesText);
    if (!rules || rules.length > 128)
        return [...issues, { code: 'invalid_rules' }];
    const seen = new Set<string>();
    rules.forEach((r, index) => {
        const bad = (code: string) => issues.push({ code, rule: index + 1 });
        if (typeof r.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(r.id) || seen.has(r.id))
            bad('invalid_id');
        seen.add(r.id);
        if (!FLOW_STAGES.some((v) => v === r.stage) || !FLOW_SCOPES.some((v) => v === r.scope))
            bad('invalid_scope');
        if (r.stage === 'request' && (dimensionsForRule(r).some((d) => !['key', 'model'].includes(d)) || r.account || r.accounts || r.provider || r.credential || r['auth-kind']))
            bad('invalid_scope');
        if (r.scope === 'custom' && ((r['group-by'] !== undefined && !Array.isArray(r['group-by'])) || (version < 3 && (r['group-by'] ?? []).length === 0) || (r['group-by'] ?? []).length > 6 || new Set(r['group-by'] ?? []).size !== (r['group-by'] ?? []).length || (r['group-by'] ?? []).some((d) => !FLOW_DIMENSIONS.includes(d as FlowDimension))))
            bad('invalid_scope');
        if (r.scope !== 'custom' && (r['group-by']?.length ?? 0) > 0)
            bad('invalid_scope');
        if (r.label !== undefined && (typeof r.label !== 'string' || new TextEncoder().encode(r.label).length > 256 || CONTROL_CHARS.test(r.label)))
            bad('invalid_id');
        if (r['auth-kind'] && !['*', 'oauth', 'apikey'].includes(r['auth-kind']))
            bad('invalid_scope');
        for (const ref of [r.key, r.account, r.credential])
            if (ref !== undefined && ref !== '' && (typeof ref !== 'string' || !opaque.test(ref)))
                bad('invalid_reference');
        if (r.model !== undefined && (typeof r.model !== 'string' || r.model.length > 256 || CONTROL_CHARS.test(r.model) || r.model.replace(/\*$/, '').includes('*')))
            bad('invalid_model');
        for (const [old, selected, model] of [[r.model, r.models, true], [r.key, r.keys, false], [r.account, r.accounts, false]] as const) {
            if (selected === undefined)
                continue;
            if (version < 3)
                bad('v3_required');
            if (!Array.isArray(selected) || selected.length === 0 || selected.length > 256) {
                bad('invalid_selection');
                continue;
            }
            if (old && (selected.length !== 1 || old.trim().toLowerCase() !== selected[0]?.trim().toLowerCase()))
                bad('selection_conflict');
            for (const item of selected) {
                if (typeof item !== 'string' || !item.trim() || item === '*' || (model ? item.length > 512 || CONTROL_CHARS.test(item) || item.replace(/\*$/, '').includes('*') || item.endsWith('::') || item.startsWith('::') || item.split('::').length > 2 : !opaque.test(item)))
                    bad('invalid_selection');
            }
        }
        if (version >= 3 && (r.credential || dimensionsForRule(r).includes('credential')))
            bad('migrate_required');
        if (r.stage === 'request' && [r.model, ...(r.models ?? [])].some(v => typeof v === 'string' && v.includes('::')))
            bad('invalid_model');
        if (r.provider !== undefined && (typeof r.provider !== 'string' || r.provider.length > 64 || CONTROL_CHARS.test(r.provider)))
            bad('invalid_scope');
        const concurrent = r['max-concurrent'] ?? 0;
        if (!integer(concurrent, 0, 100000))
            bad('invalid_number');
        const windows = r.windows ?? [];
        if (!Array.isArray(windows) || windows.length > 8) {
            bad('invalid_windows');
            return;
        }
        if (concurrent === 0 && windows.length === 0)
            bad('empty_limit');
        const periods = new Set<number>();
        for (const w of windows) {
            if (!asRecord(w) || !integer(w.requests, 1, history) || !integer(w['period-ms'], 1, 31622400000) || periods.has(w['period-ms']))
                bad('invalid_windows');
            if (asRecord(w))
                periods.add(w['period-ms']);
        }
    });
    return issues;
}
export function flowControlValidation(values: FlowControlValues, dirty: ReadonlySet<string>): {
    flowControlRulesText?: 'flow_control_config';
} {
    if (!FLOW_FIELDS.some((name) => dirty.has(name)))
        return {};
    // Disabling an untouched malformed draft remains possible, but a typed form
    // edit must never silently discard an invalid numeric string during YAML write.
    for (const field of FLOW_FIELDS) {
        if (!dirty.has(field) || field === 'flowControlEnabled' || field === 'flowControlRulesText' || field === 'flowControlRealtime' || field === 'flowControlResources')
            continue;
        const raw = String(values[field]).trim();
        if (raw && (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))))
            return { flowControlRulesText: 'flow_control_config' };
    }
    return flowIssues(values).length ? { flowControlRulesText: 'flow_control_config' } : {};
}
export interface FlowReference {
    ref: string;
    label: string;
    provider?: string;
    account?: string;
    'auth-kind'?: string;
    'auth-ids'?: string[];
}
export interface FlowBucket {
    rule: string;
    stage: string;
    scope: string;
    active: number;
    'max-concurrent': number;
    key?: string;
    model?: string;
    account?: string;
    provider?: string;
    credential?: string;
    'auth-kind'?: string;
    dimensions?: Record<string, string>;
    label?: string;
    retired?: boolean;
    'window-counts'?: number[];
}
export interface FlowStatus {
    'active-requests': number;
    'active-attempts': number;
    waiting: number;
    'queued-bytes': number;
    admitted: number;
    rejected: number;
    'timed-out': number;
    'blocked-by-rule': Record<string, number>;
    buckets: FlowBucket[];
    enabled: boolean;
    truncated: boolean;
    'waiting-requests'?: number;
    'waiting-attempts'?: number;
    'oldest-wait-ms'?: number;
    'sampled-at'?: string;
    'process-id'?: string;
    'policy-revision'?: number;
    observation?: FlowObservation;
    resources?: FlowResources;
    policy?: FlowPolicy;
    activity?: FlowActivity[];
    'activity-total'?: number;
    'activity-truncated'?: boolean;
}
export interface FlowCapabilities {
    supported: boolean;
    'configured-enabled': boolean;
    'configuration-error': boolean;
    'configuration-failure'?: {code: string; message: string; rule?: string; 'rejected-at'?: string};
    'configured-policy'?: FlowPolicy;
    features?: string[];
    'model-options-truncated'?: boolean;
    keys: FlowReference[];
    accounts: FlowReference[];
    credentials: FlowReference[];
    models: string[];
    state: FlowStatus;
    'schema-version': number;
    'events-supported': boolean;
    'events-enabled': boolean;
    'events-interval-ms': number;
    'explain-supported': boolean;
    'model-options': FlowModelOption[];
}
export type FlowSupport = {
    state: 'loading' | 'unsupported' | 'error';
} | {
    state: 'ready';
    data: FlowCapabilities;
};
export function parseFlowCapabilities(raw: unknown): FlowCapabilities | null {
    const data = asRecord(raw);
    const state = asRecord(data?.state);
    if (!data || ![1, 2, 3].includes(Number(data['schema-version'])) || !state || (Number(data['schema-version']) < 3 && !Array.isArray(state.buckets)))
        return null;
    for (const name of ['active-requests', 'active-attempts', 'waiting', 'queued-bytes']) {
        if (!integer(state[name], 0, Number.MAX_SAFE_INTEGER))
            return null;
    }
    const refs = (v: unknown): FlowReference[] => Array.isArray(v) ? v.filter((r) => {
        const obj = asRecord(r);
        return obj && typeof obj.ref === 'string' && opaque.test(obj.ref) && typeof obj.label === 'string';
    }) as FlowReference[] : [];
    if (!Array.isArray(state.buckets))
        state.buckets = [];
    if (!(state.buckets as unknown[]).every((b) => {
        const obj = asRecord(b);
        return obj && typeof obj.rule === 'string' && integer(obj.active, 0, 100000);
    }))
        return null;
    return { supported: data.supported === true, 'configured-enabled': data['configured-enabled'] === true,
        'configuration-error': data['configuration-error'] === true,
        'configuration-failure': readConfigurationFailure(data['configuration-failure']),
        'configured-policy': asRecord(data['configured-policy']) as FlowPolicy | undefined,
        features: Array.isArray(data.features) ? data.features.filter((v): v is string => typeof v === 'string') : [],
        'model-options-truncated': data['model-options-truncated'] === true,
        keys: refs(data.keys), accounts: refs(data.accounts), credentials: refs(data.credentials),
        models: Array.isArray(data.models) ? data.models.filter((m): m is string => typeof m === 'string') : [],
        'schema-version': Number(data['schema-version']), 'events-supported': data['events-supported'] === true,
        'events-enabled': Number(data['schema-version']) >= 3 ? data['events-enabled'] === true : data['events-supported'] === true,
        'events-interval-ms': integer(data['events-interval-ms'], 500, 30000) ? data['events-interval-ms'] : 2000,
        'model-options': Array.isArray(data['model-options']) ? data['model-options'].filter((v): v is FlowModelOption => { const x = asRecord(v); return !!x && typeof x.ref === 'string' && typeof x.model === 'string' && typeof x.provider === 'string'; }) : [],
        'explain-supported': data['explain-supported'] === true, state: { ...state, ...(asRecord(data.policy) ? { policy: data.policy } : {}) } as unknown as FlowStatus };
}
export const FLOW_DIMENSIONS = ['key', 'model', 'provider', 'account', 'credential', 'auth-kind'] as const;
export type FlowDimension = typeof FLOW_DIMENSIONS[number];
export interface FlowIdentity {
    stage: string;
    key?: string;
    model?: string;
    provider?: string;
    account?: string;
    credential?: string;
    'auth-kind'?: string;
    'request-id'?: string;
}
export interface FlowActivity extends FlowIdentity {
    id: string;
    state: string;
    since: string;
    'elapsed-ms': number;
    'wait-remaining-ms'?: number;
    position?: number;
    'blocking-rules'?: string[];
    rules?: string[];
}
export const scopeDimensions: Record<string, string[]> = {
    global: [], key: ['key'], model: ['model'], 'key-model': ['key', 'model'], provider: ['provider'], account: ['account'], 'account-model': ['account', 'model'],
    credential: ['credential'], 'credential-model': ['credential', 'model'], 'key-account': ['key', 'account'], 'key-account-model': ['key', 'account', 'model'],
    'key-credential': ['key', 'credential'], 'key-credential-model': ['key', 'credential', 'model'],
};
export function dimensionsForRule(rule: Pick<FlowRule, 'scope' | 'group-by'>): string[] {
    return rule.scope === 'custom' ? [...(Array.isArray(rule['group-by']) ? rule['group-by'] : [])].sort() : scopeDimensions[rule.scope] ?? [];
}
export function parseFlowEvent(raw: unknown): FlowStatus | null {
    const data = asRecord(raw);
    const state = asRecord(data?.state);
    if (![2, 3].includes(Number(data?.['schema-version'])) || !state)
        return null;
    if (data?.['schema-version'] === 2 && (!Array.isArray(state.buckets) || !Array.isArray(state.activity)))
        return null;
    for (const k of ['active-requests', 'active-attempts', 'waiting', 'queued-bytes'])
        if (!integer(state[k], 0, Number.MAX_SAFE_INTEGER))
            return null;
    if (typeof state['sampled-at'] !== 'string' || typeof state['process-id'] !== 'string')
        return null;
    return state as unknown as FlowStatus;
}
export interface FlowObservation {
    realtime: boolean;
    resources: boolean;
    'interval-ms': number;
    'max-observers': number;
}
export interface FlowResources {
    'sampled-at': string;
    'heap-object-bytes': number;
    'go-managed-bytes': number;
    goroutines: number;
    'filesystem-free-bytes': number | null;
    'filesystem-sampled-at': string;
}
export interface FlowPolicy {
    version?: number;
    enabled: boolean;
    rules?: FlowRule[];
    queue?: Record<string, number>;
    observation?: Partial<FlowObservation>;
    [name: string]: unknown;
}
export interface FlowModelOption {
    ref: string;
    model: string;
    provider: string;
    aliases?: string[];
    accounts?: string[];
}

function readConfigurationFailure(value: unknown): FlowCapabilities['configuration-failure'] {
    const row = asRecord(value);
    if (!row || typeof row.code !== 'string' || typeof row.message !== 'string') return undefined;
    return {code: row.code, message: row.message,
        ...(typeof row.rule === 'string' ? {rule: row.rule} : {}),
        ...(typeof row['rejected-at'] === 'string' ? {'rejected-at': row['rejected-at']} : {})};
}

// Never substitute a public alias directory for actual Executor targets.
// Older schema-3 servers can still be used with explicit, operator-supplied
// target names, but their model-options are not advertised as resolved targets.
export function modelOptionsForStage(data: FlowCapabilities | null, stage: string): Array<{value: string; label: string}> {
    if (stage !== 'attempt') return (data?.models ?? []).map(value => ({value, label: value}));
    if (!data?.features?.includes('resolved-model-options')) return [];
    return data['model-options'].map(row => {
        const aliases = (Array.isArray(row.aliases) ? row.aliases : []).filter(value => typeof value === 'string' && value !== row.model);
        return {value: row.ref, label: `${row.provider} · ${row.model}${aliases.length ? ` ← ${aliases.slice(0, 4).join(', ')}` : ''}`};
    });
}

export function policyFromValues(v: FlowControlValues): FlowPolicy {
    const queue: Record<string, number> = {};
    for (const [field, key] of [['flowControlMaxWaiting', 'max-waiting'], ['flowControlMaxWaitingPerKey', 'max-waiting-per-key'], ['flowControlMaxBytes', 'max-bytes'], ['flowControlMaxWaitMs', 'max-wait-ms']] as const) {
        if (v[field].trim())
            queue[key] = Number(v[field]);
    }
    return { version: Number(v.flowControlVersion || 0), enabled: v.flowControlEnabled, rules: parseRules(v.flowControlRulesText) ?? [], queue,
        observation: { realtime: v.flowControlRealtime, resources: v.flowControlResources, ...(v.flowControlIntervalMs ? { 'interval-ms': Number(v.flowControlIntervalMs) } : {}), ...(v.flowControlMaxObservers ? { 'max-observers': Number(v.flowControlMaxObservers) } : {}) },
        ...(v.flowControlMaxBuckets ? { 'max-buckets': Number(v.flowControlMaxBuckets) } : {}), ...(v.flowControlMaxHistory ? { 'max-history': Number(v.flowControlMaxHistory) } : {}) };
}
// Undefined means explicitly all. [] is an unfinished selection, never all.
export function selectionOf(rule: FlowRule, field: 'models' | 'keys' | 'accounts'): string[] | undefined {
    const legacy = { models: 'model', keys: 'key', accounts: 'account' } as const;
    if (rule[field] !== undefined)
        return rule[field];
    const value = rule[legacy[field]];
    return value && value !== '*' ? [value] : undefined;
}
export function setSelection(rule: FlowRule, field: 'models' | 'keys' | 'accounts', items: string[] | undefined): FlowRule {
    const next = { ...rule };
    delete next[{ models: 'model', keys: 'key', accounts: 'account' }[field]];
    if (items === undefined)
        delete next[field];
    else
        next[field] = [...new Set(items)];
    return next;
}
export function mergeSummary(previous: FlowStatus, next: FlowStatus): FlowStatus {
    // SSE carries no catalogs/policy/detail arrays; those remain manual reads.
    return { ...previous, ...next, policy: previous.policy, buckets: previous.buckets, activity: undefined, resources: next.resources };
}
export function mergeMigration(original: FlowRule[], converted: FlowRule[]): FlowRule[] {
    return converted.map(r => {
        const old = original.find(v => v.id === r.id);
        const next = { ...old, ...r };
        for (const k of ['key', 'model', 'account', 'credential', 'group-by', 'keys', 'models', 'accounts'])
            if (!(k in r))
                delete next[k];
        return next;
    });
}
export interface FlowEvaluation {
    rule: FlowRule;
    known: boolean;
    active: number;
    delta: number;
    remaining: number | null;
    'blocked-by': string[];
    unresolved?: string[];
}
export interface FlowExplanation {
    identity: FlowIdentity;
    complete: boolean;
    'can-start': boolean;
    matches: FlowEvaluation[];
    'policy-revision': number;
    'sampled-at': string;
    draft: boolean;
    unresolved?: string[];
}
export function readExplanations(raw: unknown): FlowExplanation[] | null {
    const data = asRecord(raw);
    if (!Array.isArray(data?.results))
        return null;
    if (!data.results.every(v => { const x = asRecord(v); return x && asRecord(x.identity) && Array.isArray(x.matches) && x.matches.every(r => { const row = asRecord(r); return row && asRecord(row.rule) && typeof row.known === 'boolean' && Array.isArray(row['blocked-by']); }); }))
        return null;
    return data.results as FlowExplanation[];
}
export function identityForModel(identity: FlowIdentity, ref: string): FlowIdentity {
    const parts = ref.split('::');
    return parts.length === 2 ? { ...identity, provider: parts[0], model: parts[1] } : { ...identity, model: ref };
}
export function canObserveLive(data: FlowCapabilities | null | undefined): boolean {
    return !!data && data.supported && data['schema-version'] >= 3 && data['events-enabled'];
}
