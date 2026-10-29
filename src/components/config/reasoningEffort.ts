import { isAlias, isMap, isSeq, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import type { ReasoningEffortRule } from '@/types/visualConfig';

export const REASONING_EFFORT_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];
export const REASONING_EFFORT_MODES = ['follow', 'default', 'force'];

export function parseReasoningEffortRules(value: unknown): ReasoningEffortRule[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('reasoning-effort must be a list');
  return value.map((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('reasoning-effort entries must be objects');
    }
    const record = entry as Record<string, unknown>;
    if (!Array.isArray(record.models) || record.models.some((model) => typeof model !== 'string')) {
      throw new Error('reasoning-effort models must be a string list');
    }
    return {
      id: `reasoning-effort-${index}`,
      models: record.models as string[],
      mode: typeof record.mode === 'string' ? record.mode : '',
      effort: typeof record.effort === 'string' ? record.effort : '',
      sourceFingerprint: JSON.stringify(record),
    };
  });
}

export function validReasoningEffortRules(rules: ReasoningEffortRule[]): boolean {
  return rules.every(
    (rule) =>
      rule.models.length > 0 &&
      rule.models.every((model) => model.trim()) &&
      REASONING_EFFORT_MODES.includes(rule.mode) &&
      (rule.mode === 'follow' ? rule.effort === '' : REASONING_EFFORT_LEVELS.includes(rule.effort))
  );
}

// 只更新表单负责的键，保留规则注释、未来字段及未编辑的 YAML 节点。
export function syncReasoningEffortRules(
  doc: Document,
  baseline: ReasoningEffortRule[],
  rules: ReasoningEffortRule[]
): void {
  if (!validReasoningEffortRules(rules)) throw new Error('Invalid reasoning effort rules');
  const existing = doc.get('reasoning-effort', true);
  if (existing !== undefined && !isSeq(existing)) throw new Error('Invalid reasoning effort list');
  const sequence = (existing ?? doc.createNode([])) as YAMLSeq;
  if (baseline.length !== sequence.items.length)
    throw new Error('Reasoning effort rules changed; reload the configuration');
  for (let index = 0; index < baseline.length; index += 1) {
    const node = sequence.items[index];
    if (
      !isMap(node) ||
      (baseline[index].sourceFingerprint &&
        JSON.stringify(node.toJSON()) !== baseline[index].sourceFingerprint)
    ) {
      throw new Error('Reasoning effort rules changed; reload the configuration');
    }
  }
  if (rules.length === 0) {
    doc.delete('reasoning-effort');
    return;
  }
  const nodes = new Map(baseline.map((rule, index) => [rule.id, sequence.items[index]]));
  sequence.items = rules.map((rule) => {
    const priorNode = nodes.get(rule.id);
    if (isAlias(priorNode)) throw new Error('Edit aliased reasoning rules in the source editor');
    const node = (isMap(priorNode) ? priorNode : doc.createNode({})) as YAMLMap;
    const prior = baseline.find((item) => item.id === rule.id);
    if (JSON.stringify(prior?.models) !== JSON.stringify(rule.models)) {
      node.set('models', doc.createNode(rule.models.map((model) => model.trim())));
    }
    if (prior?.mode !== rule.mode) node.set('mode', rule.mode);
    if (rule.mode === 'follow') node.delete('effort');
    else if (prior?.effort !== rule.effort) node.set('effort', rule.effort);
    return node;
  });
  doc.set('reasoning-effort', sequence);
}
