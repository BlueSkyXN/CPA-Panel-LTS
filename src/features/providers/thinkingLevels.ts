export const THINKING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export const THINKING_LEVELS = [...THINKING_EFFORT_LEVELS, 'none', 'auto'] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);
export type ThinkingBudgetField = 'min' | 'max';

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

export const formatThinkingJson = (value: Record<string, unknown> | undefined): string => {
  if (!value || Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
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
  const standardLevels = THINKING_EFFORT_LEVELS.filter((level) => selected.has(level));
  const mergedLevels = [...standardLevels, ...unknownLevels];

  if (selected.has('none')) {
    next.zero_allowed = true;
  } else {
    delete next.zero_allowed;
  }
  if (selected.has('auto')) {
    next.dynamic_allowed = true;
  } else {
    delete next.dynamic_allowed;
  }
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
  return formatThinkingJson(merged);
};

export const readThinkingBudget = (
  value: Record<string, unknown> | undefined,
  field: ThinkingBudgetField
): number | undefined => {
  const budget = value?.[field];
  return typeof budget === 'number' && Number.isSafeInteger(budget) && budget >= 0
    ? budget
    : undefined;
};

export const mergeThinkingBudget = (
  current: Record<string, unknown> | undefined,
  field: ThinkingBudgetField,
  budget: number | undefined
): Record<string, unknown> | undefined => {
  const next = { ...(current ?? {}) };
  if (budget === undefined) {
    delete next[field];
  } else {
    next[field] = budget;
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

export const updateThinkingBudgetJson = (
  value: string | undefined,
  field: ThinkingBudgetField,
  budget: number | undefined
): string => formatThinkingJson(mergeThinkingBudget(parseThinkingJson(value), field, budget));

export const hasThinkingBudgetRangeError = (
  value: Record<string, unknown> | undefined
): boolean => {
  const min = readThinkingBudget(value, 'min');
  const max = readThinkingBudget(value, 'max');
  return min !== undefined && max !== undefined && min > max;
};
