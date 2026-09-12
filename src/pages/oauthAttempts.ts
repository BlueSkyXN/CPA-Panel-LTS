export interface OAuthAttempt {
  isCurrent: () => boolean;
  invalidate: () => void;
  schedule: (callback: () => void, delay: number) => void;
  poll: <T>(
    request: () => Promise<T>,
    onResult: (result: T) => boolean,
    onError: (error: unknown) => void,
    delay: number
  ) => void;
}

interface Scheduler {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
}

// 每个 provider 只持有一次尝试和一个定时任务；失效后，已发请求也不能再写回。
export function createOAuthAttempts(scheduler: Scheduler) {
  const attempts = new Map<string, OAuthAttempt>();

  const begin = (provider: string): OAuthAttempt => {
    attempts.get(provider)?.invalidate();
    let timer: number | undefined;
    const attempt: OAuthAttempt = {
      isCurrent: () => attempts.get(provider) === attempt,
      invalidate: () => {
        if (timer !== undefined) scheduler.clearTimeout(timer);
        timer = undefined;
        if (attempt.isCurrent()) attempts.delete(provider);
      },
      schedule: (callback, delay) => {
        if (!attempt.isCurrent()) return;
        if (timer !== undefined) scheduler.clearTimeout(timer);
        timer = scheduler.setTimeout(() => {
          timer = undefined;
          if (attempt.isCurrent()) callback();
        }, delay);
      },
      poll: (request, onResult, onError, delay) => {
        const tick = async () => {
          try {
            const result = await request();
            if (!attempt.isCurrent()) return;
            if (onResult(result)) attempt.schedule(() => void tick(), delay);
          } catch (error: unknown) {
            if (attempt.isCurrent()) onError(error);
          }
        };
        attempt.schedule(() => void tick(), delay);
      },
    };
    attempts.set(provider, attempt);
    return attempt;
  };

  return {
    begin,
    get: (provider: string) => attempts.get(provider),
    invalidateAll: () => {
      for (const attempt of attempts.values()) attempt.invalidate();
    },
  };
}
