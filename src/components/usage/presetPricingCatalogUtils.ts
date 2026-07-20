import type { PriceCatalogEntry, TokenRates } from '@/utils/usage';

export type CatalogBandKind = 'short' | 'long';

export const getCatalogExplicitFastRates = (
  entry: PriceCatalogEntry,
  band: CatalogBandKind
): TokenRates | null => {
  const fast = entry.fast;
  if (!fast || typeof fast.multiplier === 'number') return null;
  if (band === 'long' && !fast.longSupported) return null;
  return fast.short;
};
