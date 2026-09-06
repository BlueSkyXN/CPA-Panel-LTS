import { isMap, isSeq, type Document } from 'yaml';
import { FLOW_FIELDS, parseRules, type FlowControlValues } from './model';
// Original nodes are reused by stable rule id. Changing one limit keeps unrelated
// keys and comments; merely opening/saving the page inserts no configuration.
export function writeFlowControlValues(doc: Document, values: FlowControlValues, dirty: ReadonlySet<string>): void {
    if (!FLOW_FIELDS.some((name) => dirty.has(name)))
        return;
    const root = ['flow-control'];
    const before = doc.getIn(root, true);
    const priorRules = isMap(before) ? before.get('rules', true) : undefined;
    const newPolicy = !isMap(before) || (!before.has('version') && before.get('enabled') !== true && (priorRules === undefined || (isSeq(priorRules) && priorRules.items.length === 0)));
    if (!isMap(doc.getIn(root, true)))
        doc.setIn(root, doc.createNode({}));
    // First use is a disabled v3 draft, not a migration from an empty policy.
    // Opening the editor alone still writes nothing; this runs only on an edit.
    if (newPolicy && values.flowControlVersion === '3') doc.setIn([...root, 'version'], 3);
    if (dirty.has('flowControlEnabled'))
        doc.setIn([...root, 'enabled'], values.flowControlEnabled);
    for (const [field, key] of [['flowControlRealtime', 'realtime'], ['flowControlResources', 'resources']] as const) {
        if (!dirty.has(field))
            continue;
        if (!isMap(doc.getIn([...root, 'observation'], true)))
            doc.setIn([...root, 'observation'], doc.createNode({}));
        doc.setIn([...root, 'observation', key], values[field]);
    }
    const scalarPaths: Array<[
        keyof FlowControlValues,
        string[]
    ]> = [
        ['flowControlVersion', ['version']], ['flowControlIntervalMs', ['observation', 'interval-ms']], ['flowControlMaxObservers', ['observation', 'max-observers']],
        ['flowControlMaxWaiting', ['queue', 'max-waiting']],
        ['flowControlMaxWaitingPerKey', ['queue', 'max-waiting-per-key']],
        ['flowControlMaxBytes', ['queue', 'max-bytes']],
        ['flowControlMaxWaitMs', ['queue', 'max-wait-ms']],
        ['flowControlMaxBuckets', ['max-buckets']], ['flowControlMaxHistory', ['max-history']],
    ];
    for (const [field, suffix] of scalarPaths) {
        if (!dirty.has(field))
            continue;
        const raw = String(values[field]).trim();
        const path = [...root, ...suffix];
        if (!raw) {
            doc.deleteIn(path);
            continue;
        }
        if (!/^[-]?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
            continue;
        if (suffix.length > 1 && !isMap(doc.getIn([...root, suffix[0]], true)))
            doc.setIn([...root, suffix[0]], doc.createNode({}));
        doc.setIn(path, Number(raw));
    }
    if (!dirty.has('flowControlRulesText'))
        return;
    const rules = parseRules(values.flowControlRulesText);
    if (!rules)
        return; // Keep unknown future draft; the validator blocks enabled invalid edits.
    const old = doc.getIn([...root, 'rules'], true);
    const next = doc.createNode([]);
    if (!isSeq(next))
        return;
    if (isSeq(old)) {
        next.comment = old.comment;
        next.commentBefore = old.commentBefore;
    }
    const existing = isSeq(old) ? old.items.filter(isMap) : [];
    const used = new Set<unknown>();
    for (const rule of rules) {
        const node = existing.find((candidate) => !used.has(candidate) && candidate.get('id') === rule.id) ?? doc.createNode({});
        if (!isMap(node))
            continue;
        used.add(node);
        // Removing a controlled selector is intentional. Unknown future fields
        // remain untouched, including ones added by the server after initial load.
        for (const key of ['key', 'model', 'account', 'credential', 'keys', 'models', 'accounts', 'group-by', 'provider', 'auth-kind']) {
            if (!(key in rule))
                node.delete(key);
        }
        const current = node.toJSON() as Record<string, unknown>;
        for (const [field, value] of Object.entries(rule)) {
            if (JSON.stringify(current[field]) === JSON.stringify(value))
                continue;
            if (field === 'windows' && Array.isArray(value)) {
                const before = node.get('windows', true);
                const windows = doc.createNode([]);
                if (!isSeq(windows))
                    continue;
                if (isSeq(before)) {
                    windows.comment = before.comment;
                    windows.commentBefore = before.commentBefore;
                }
                const usedWindows = new Set<unknown>();
                for (let i = 0; i < value.length; i++) {
                    // Window duration is its identity. Reusing by array index after a
                    // deletion would copy unknown fields from a different old window.
                    const period = value[i] && typeof value[i] === 'object' ? value[i]['period-ms'] : undefined;
                    const prior = isSeq(before) ? before.items.find((item) => isMap(item) && !usedWindows.has(item) && item.get('period-ms') === period) : undefined;
                    const win = isMap(prior) ? prior : doc.createNode({});
                    usedWindows.add(win);
                    if (!isMap(win) || !value[i] || typeof value[i] !== 'object')
                        continue;
                    for (const [key, item] of Object.entries(value[i]))
                        win.set(key, item);
                    windows.items.push(win);
                }
                node.set('windows', windows);
            }
            else
                node.set(field, value);
        }
        next.items.push(node);
    }
    doc.setIn([...root, 'rules'], next);
}
