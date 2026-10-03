export interface SharedClockOptions {
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function createSharedClock(options: SharedClockOptions = {}) {
  const {
    intervalMs = 60_000,
    now = Date.now,
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (id) => clearInterval(id as ReturnType<typeof setInterval>),
  } = options;
  const listeners = new Set<() => void>();
  let current = now();
  let timerId: unknown = null;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (timerId === null) {
        current = now();
        timerId = setTimer(() => {
          current = now();
          listeners.forEach((callback) => callback());
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timerId !== null) {
          clearTimer(timerId);
          timerId = null;
        }
      };
    },
    // useSyncExternalStore requires a stable snapshot between ticks.
    getSnapshot: () => current,
    subscriberCount: () => listeners.size,
  };
}
