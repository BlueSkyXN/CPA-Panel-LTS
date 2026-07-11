export type UsageReasoningEffortKind = 'legacy-unknown' | 'max-ultra-wire' | 'raw';

export interface UsageReasoningEffortPresentation {
  raw: string | null;
  kind: UsageReasoningEffortKind;
}

const GPT56_ULTRA_WIRE_MODELS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'openai/gpt-5.6-sol',
  'openai/gpt-5.6-terra',
  'codex/gpt-5.6-sol',
  'codex/gpt-5.6-terra',
]);

export function normalizeReasoningEffort(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function isGPT56UltraWireModel(model: string): boolean {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/\([^()]*\)$/, '');
  return GPT56_ULTRA_WIRE_MODELS.has(normalized);
}

export function classifyUsageReasoningEffort(
  model: string,
  value: unknown
): UsageReasoningEffortPresentation {
  const raw = normalizeReasoningEffort(value);
  if (!raw) return { raw: null, kind: 'legacy-unknown' };
  if (raw.toLowerCase() === 'max' && isGPT56UltraWireModel(model)) {
    return { raw, kind: 'max-ultra-wire' };
  }
  return { raw, kind: 'raw' };
}
