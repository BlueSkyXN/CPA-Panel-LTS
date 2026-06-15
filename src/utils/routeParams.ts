const ROUTE_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

export function parseRouteIndexParam(value: string | undefined): number | null {
  if (!value || !ROUTE_INDEX_PATTERN.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
