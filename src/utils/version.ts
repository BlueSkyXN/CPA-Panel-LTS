const VERSION_PLACEHOLDERS = new Set([
  'unknown',
  'dev',
  'none',
  'null',
  'n/a',
  'not set',
  'unset',
]);

export function normalizeReportedVersion(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const version = String(value).trim();
  if (!version || VERSION_PLACEHOLDERS.has(version.toLowerCase())) return null;
  return version;
}

function parseVersionSegments(value: unknown): number[] | null {
  const version = normalizeReportedVersion(value);
  if (!version) return null;

  const parts = version
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
}

export function compareVersions(latest: unknown, current: unknown): number | null {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;

  const length = Math.max(latestParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] || 0;
    const currentPart = currentParts[index] || 0;
    if (latestPart > currentPart) return 1;
    if (latestPart < currentPart) return -1;
  }
  return 0;
}
