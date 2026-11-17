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
export function serializeLiteralDraft(
  rows: LiteralReplacementDraft[]
): Record<string, string> | null {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.key || keys.has(row.key)) return null;
    keys.add(row.key);
  }
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}
