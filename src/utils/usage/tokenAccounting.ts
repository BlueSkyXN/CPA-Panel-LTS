export interface UsageTokenAccounting {
  schema_version: 2;
  quality: 'complete' | 'unclassified' | 'inconsistent';
  total_tokens: number;
  unclassified_tokens: number;
  input: {
    total_tokens: number;
    uncached_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
  output: { total_tokens: number; non_reasoning_tokens: number; reasoning_tokens: number };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const sum = (...values: number[]): number => {
  const result = values.reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(result) ? result : Number.NaN;
};

/** 保留已验证的规范化计数，缺失或矛盾的语义不能推断为“推理已包含在输出”。 */
export function normalizeTokenAccounting(v: unknown): UsageTokenAccounting | null {
  if (
    !isRecord(v) ||
    v.schema_version !== 2 ||
    typeof v.quality !== 'string' ||
    !['complete', 'unclassified', 'inconsistent'].includes(v.quality) ||
    !isRecord(v.input) ||
    !isRecord(v.output)
  )
    return null;
  const input = v.input,
    output = v.output;
  if (
    ![
      v.total_tokens,
      v.unclassified_tokens,
      input.total_tokens,
      input.uncached_tokens,
      input.cache_read_tokens,
      input.cache_write_tokens,
      output.total_tokens,
      output.non_reasoning_tokens,
      output.reasoning_tokens,
    ].every(count)
  )
    return null;
  const b = v as unknown as UsageTokenAccounting;
  if (
    sum(b.input.uncached_tokens, b.input.cache_read_tokens, b.input.cache_write_tokens) !==
      b.input.total_tokens ||
    sum(b.output.non_reasoning_tokens, b.output.reasoning_tokens) !== b.output.total_tokens ||
    sum(b.input.total_tokens, b.output.total_tokens, b.unclassified_tokens) !== b.total_tokens ||
    (b.quality === 'complete' && b.unclassified_tokens !== 0)
  )
    return null;
  return {
    schema_version: 2,
    quality: b.quality,
    total_tokens: b.total_tokens,
    unclassified_tokens: b.unclassified_tokens,
    input: { ...b.input },
    output: { ...b.output },
  };
}

export function tokenAccountingMatches(b: UsageTokenAccounting, raw: unknown): boolean {
  if (!isRecord(raw) || b.total_tokens !== raw.total_tokens) return false;
  return (
    b.quality !== 'complete' ||
    (b.input.total_tokens === raw.input_tokens &&
      b.input.cache_read_tokens === (raw.cache_read_tokens ?? raw.cached_tokens ?? 0) &&
      b.input.cache_write_tokens === (raw.cache_creation_tokens ?? 0) &&
      b.output.reasoning_tokens === raw.reasoning_tokens &&
      (raw.output_tokens === b.output.total_tokens ||
        raw.output_tokens === b.output.non_reasoning_tokens))
  );
}

export interface PerformanceTokens {
  outputTokens: number | null;
  reasoningTokens: number | null;
  nonReasoningTokens: number | null;
}

export function resolvePerformanceTokens(tokens: unknown, accounting?: unknown): PerformanceTokens {
  if (accounting !== undefined) {
    const b = normalizeTokenAccounting(accounting);
    if (!b || b.quality !== 'complete' || !tokenAccountingMatches(b, tokens))
      return { outputTokens: null, reasoningTokens: null, nonReasoningTokens: null };
    return {
      outputTokens: b.output.total_tokens,
      reasoningTokens: b.output.reasoning_tokens,
      nonReasoningTokens: b.output.non_reasoning_tokens,
    };
  }
  const raw = isRecord(tokens) ? tokens : {};
  const output = count(raw.output_tokens) ? raw.output_tokens : 0;
  const reasoning = count(raw.reasoning_tokens) ? raw.reasoning_tokens : 0;
  return {
    outputTokens: output,
    reasoningTokens: reasoning,
    nonReasoningTokens: Math.max(output - reasoning, 0),
  };
}
