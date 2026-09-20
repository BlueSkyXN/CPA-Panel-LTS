export const CODEX_CACHE_AFFINITY_STRATEGIES = ['client-aware', 'stable-id', 'legacy'] as const;
export type CodexCacheAffinityStrategy = (typeof CODEX_CACHE_AFFINITY_STRATEGIES)[number];

export function isCodexCacheAffinityStrategy(value: string): value is CodexCacheAffinityStrategy {
  return (CODEX_CACHE_AFFINITY_STRATEGIES as readonly string[]).includes(value);
}

// 空值代表由 Core 使用默认值；未知值保持可辨识，避免界面误报为自动优化。
export function readCodexCacheAffinity(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return '__unsupported__';
  const strategy = (value as Record<string, unknown>).strategy;
  if (strategy == null) return '';
  return typeof strategy === 'string' ? strategy.trim().toLowerCase() : '__unsupported__';
}
