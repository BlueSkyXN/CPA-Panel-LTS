import {
  createDefaultPriceProfileV3,
  migrateModelPricesV2ToV3,
  normalizePriceProfileV3,
  serializePriceProfileV3,
  type PriceProfileV3,
} from './index';

export const PRICE_PROFILE_STORAGE_KEY = 'cli-proxy-model-prices-v3';
export const LEGACY_MODEL_PRICE_STORAGE_KEY = 'cli-proxy-model-prices-v2';

export type PriceProfileLoadSource = 'v3' | 'v2' | 'default';

export interface PriceProfileLoadResult {
  profile: PriceProfileV3;
  source: PriceProfileLoadSource;
  warnings: string[];
}

type PriceProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;

const resolveStorage = (storage?: PriceProfileStorage): PriceProfileStorage | null => {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
};

export function loadPriceProfileV3(storage?: PriceProfileStorage): PriceProfileLoadResult {
  const target = resolveStorage(storage);
  if (!target) {
    return { profile: createDefaultPriceProfileV3(), source: 'default', warnings: [] };
  }

  try {
    const rawV3 = target.getItem(PRICE_PROFILE_STORAGE_KEY);
    if (rawV3 !== null) {
      try {
        const normalized = normalizePriceProfileV3(JSON.parse(rawV3));
        return { ...normalized, source: 'v3' };
      } catch {
        return {
          profile: createDefaultPriceProfileV3(),
          source: 'v3',
          warnings: ['profile-json-invalid'],
        };
      }
    }

    const rawV2 = target.getItem(LEGACY_MODEL_PRICE_STORAGE_KEY);
    if (rawV2 !== null) {
      try {
        const migrated = migrateModelPricesV2ToV3(JSON.parse(rawV2));
        return { ...migrated, source: 'v2' };
      } catch {
        return {
          profile: createDefaultPriceProfileV3(),
          source: 'v2',
          warnings: ['v2-profile-json-invalid'],
        };
      }
    }
  } catch {
    return {
      profile: createDefaultPriceProfileV3(),
      source: 'default',
      warnings: ['profile-storage-read-failed'],
    };
  }

  return { profile: createDefaultPriceProfileV3(), source: 'default', warnings: [] };
}

export function savePriceProfileV3(
  profile: PriceProfileV3,
  storage?: PriceProfileStorage
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;

  try {
    target.setItem(PRICE_PROFILE_STORAGE_KEY, serializePriceProfileV3(profile));
    return true;
  } catch {
    return false;
  }
}

export function resetPriceProfileV3(storage?: PriceProfileStorage): PriceProfileV3 {
  const profile = createDefaultPriceProfileV3();
  savePriceProfileV3(profile, storage);
  return profile;
}
