export type LiteralReplacementDraft = { id: string; key: string; value: string; fresh?: boolean };

export type PatternReplacementDraft = {
  pattern: string;
  replacement: string;
  /** Original YAML sequence position; carried through edits, never serialized. */
  sourceIndex?: number;
};

export const literalDraftFromMap = (value: Record<string, string>): LiteralReplacementDraft[] =>
  Object.entries(value).map(([key, value], index) => ({ id: `literal-${index}`, key, value }));

// Keep incomplete and duplicate rows in the host draft; saving requires a lossless map.
// Trim keys to match Core NormalizeSensitiveWordsReplace while preserving replacement values verbatim.
export function serializeLiteralDraft(
  rows: LiteralReplacementDraft[]
): Record<string, string> | null {
  const entries: Array<[string, string]> = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key || keys.has(key)) return null;
    keys.add(key);
    entries.push([key, row.value]);
  }
  return Object.fromEntries(entries);
}
