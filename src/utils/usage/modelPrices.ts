export interface ModelPrice {
  prompt: number;
  completion: number;
  cache: number;
  cacheWrite?: number;
}

const DECIMAL_NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

export const parseNonNegativePrice = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed || !DECIMAL_NUMBER_PATTERN.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export function normalizePersistedModelPrices(value: unknown): Record<string, ModelPrice> {
  if (!isRecord(value)) return {};

  const normalized: Record<string, ModelPrice> = {};
  Object.entries(value).forEach(([model, rawPrice]) => {
    if (!model || !isRecord(rawPrice)) return;

    const prompt = parseNonNegativePrice(rawPrice.prompt);
    const completion = parseNonNegativePrice(rawPrice.completion);
    const cache = parseNonNegativePrice(rawPrice.cache);
    if (
      (hasOwn(rawPrice, 'prompt') && prompt === undefined) ||
      (hasOwn(rawPrice, 'completion') && completion === undefined) ||
      (hasOwn(rawPrice, 'cache') && cache === undefined)
    ) {
      return;
    }
    if (prompt === undefined && completion === undefined && cache === undefined) return;

    const resolvedPrompt = prompt ?? 0;
    const cacheWrite = parseNonNegativePrice(rawPrice.cacheWrite);
    // Missing cacheWrite remains Auto, so existing v2 entries follow the current default.
    normalized[model] = {
      prompt: resolvedPrompt,
      completion: completion ?? 0,
      cache: cache ?? resolvedPrompt,
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    };
  });

  return normalized;
}
