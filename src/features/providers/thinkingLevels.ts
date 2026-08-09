export const THINKING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'auto',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);
const SERIALIZED_LEVEL_ORDER: readonly ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'none',
  'auto',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const parseThinkingJson = (
  value: string | undefined
): Record<string, unknown> | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;

  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Thinking config must be a JSON object');
  }
  return parsed;
};

export const readThinkingLevels = (value: unknown): ThinkingLevel[] => {
  if (!isRecord(value)) return [];

  const selected = new Set<ThinkingLevel>();
  if (Array.isArray(value.levels)) {
    value.levels.forEach((rawLevel) => {
      if (typeof rawLevel !== 'string') return;
      const level = rawLevel.trim().toLowerCase();
      if (THINKING_LEVEL_SET.has(level)) selected.add(level as ThinkingLevel);
    });
  }
  if (value.zero_allowed === true) selected.add('none');
  if (value.dynamic_allowed === true) selected.add('auto');

  return THINKING_LEVELS.filter((level) => selected.has(level));
};

const readUnknownLevels = (value: Record<string, unknown>): string[] => {
  if (!Array.isArray(value.levels)) return [];

  const seen = new Set<string>();
  const unknown: string[] = [];
  value.levels.forEach((rawLevel) => {
    if (typeof rawLevel !== 'string' || !rawLevel.trim()) return;
    if (THINKING_LEVEL_SET.has(rawLevel.trim().toLowerCase())) return;
    if (seen.has(rawLevel)) return;
    seen.add(rawLevel);
    unknown.push(rawLevel);
  });
  return unknown;
};

export const mergeThinkingLevels = (
  current: Record<string, unknown> | undefined,
  levels: readonly ThinkingLevel[]
): Record<string, unknown> | undefined => {
  const next = { ...(current ?? {}) };
  const unknownLevels = readUnknownLevels(next);
  const selected = new Set(levels);
  const standardLevels = SERIALIZED_LEVEL_ORDER.filter((level) => selected.has(level));
  const mergedLevels = [...standardLevels, ...unknownLevels];

  delete next.zero_allowed;
  delete next.dynamic_allowed;
  if (mergedLevels.length > 0) {
    next.levels = mergedLevels;
  } else {
    delete next.levels;
  }

  return Object.keys(next).length > 0 ? next : undefined;
};

export const updateThinkingLevelsJson = (
  value: string | undefined,
  levels: readonly ThinkingLevel[]
): string => {
  const merged = mergeThinkingLevels(parseThinkingJson(value), levels);
  return merged ? JSON.stringify(merged, null, 2) : '';
};
