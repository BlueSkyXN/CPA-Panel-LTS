/**
 * Raw reset instants, in epoch milliseconds (port of upstream resetInstants /
 * relativeTime helpers needed by the reset-grant dialog; LTS keeps only the
 * two parsing/formatting primitives it currently consumes).
 */

/** Parse an ISO-8601 timestamp to epoch ms. Tolerates over-precise
 * fractional seconds some providers emit (`.123456789`), which `new Date()`
 * rejects on some engines. */
export function parseIsoToMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/(\.\d{6})\d+/, '$1');
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Absolute instant in the shape every quota row already uses (`MM-DD HH:mm`,
 * browser-local, 24-hour).
 */
export function formatInstantShort(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  return new Date(ms).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
