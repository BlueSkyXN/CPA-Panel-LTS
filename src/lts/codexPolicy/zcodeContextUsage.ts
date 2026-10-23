export const ZCODE_CONTEXT_USAGE_MODES = ['disabled', 'observe', 'correct'] as const;
export type ZcodeContextUsageMode = (typeof ZCODE_CONTEXT_USAGE_MODES)[number];

export const isZcodeContextUsageMode = (value: string): value is ZcodeContextUsageMode =>
  (ZCODE_CONTEXT_USAGE_MODES as readonly string[]).includes(value);

export function readZcodeContextUsage(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value.trim().toLowerCase() : '__unsupported__';
}
