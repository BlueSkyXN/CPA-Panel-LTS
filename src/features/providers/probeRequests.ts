export function createProbeRequestGuard() {
  let epoch = 0;
  const requests = new Map<string, number>();
  return {
    invalidate() {
      epoch++;
      requests.clear();
    },
    start(key: string, connectionIsCurrent: () => boolean) {
      const owner = epoch;
      const id = (requests.get(key) ?? 0) + 1;
      requests.set(key, id);
      return {
        ownsSession: () => owner === epoch,
        current: () => owner === epoch && requests.get(key) === id && connectionIsCurrent(),
      };
    },
  };
}
