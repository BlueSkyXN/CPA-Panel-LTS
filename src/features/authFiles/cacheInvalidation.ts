import { useQuotaStore } from '@/stores/useQuotaStore';

type ModelsInvalidator = (names?: string[]) => void;

/** Invalidate caches whose values depend on the underlying credential file. */
export const invalidateAuthFileDerivedCaches = (
  invalidateModels: ModelsInvalidator,
  names?: string[]
): void => {
  invalidateModels(names);
  useQuotaStore.getState().clearQuotaCache();
};
