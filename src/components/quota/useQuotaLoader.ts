/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

const DEFAULT_BATCH_CONCURRENCY = 4;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const normalizeConcurrency = (value: unknown, targetCount: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(DEFAULT_BATCH_CONCURRENCY, targetCount);
  }
  return Math.min(Math.max(1, Math.floor(parsed)), targetCount);
};

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      const cacheGeneration = captureQuotaCacheGeneration();
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        const previousByName = new Map<string, TState>();
        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            const previous = prev[file.name];
            if (previous !== undefined) previousByName.set(file.name, previous);
            nextState[file.name] = config.buildLoadingState();
          });
          return nextState;
        });

        const applyResult = (result: LoadQuotaResult<TData>) => {
          if (requestId !== requestIdRef.current) return;

          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            setQuota((prev) => ({
              ...prev,
              [result.name]:
                result.status === 'success'
                  ? config.buildSuccessState(
                      result.data as TData,
                      previousByName.get(result.name)
                    )
                  : config.buildErrorState(
                      result.error || t('common.unknown_error'),
                      result.errorStatus
                    ),
            }));
          });
        };

        const fetchOne = async (file: AuthFileItem): Promise<void> => {
          try {
            const data = await config.fetchQuota(file, t);
            applyResult({ name: file.name, status: 'success', data });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            const errorStatus = getStatusFromError(err);
            applyResult({ name: file.name, status: 'error', error: message, errorStatus });
          }
        };

        const concurrency = normalizeConcurrency(config.batchConcurrency, targets.length);
        const delayMs = Math.max(0, Number(config.batchDelayMs) || 0);
        let nextIndex = 0;

        const runWorker = async () => {
          while (requestId === requestIdRef.current) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= targets.length) return;

            if (currentIndex > 0 && delayMs > 0) {
              await sleep(delayMs);
            }

            await fetchOne(targets[currentIndex]);
          }
        };

        await Promise.all(Array.from({ length: concurrency }, runWorker));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
