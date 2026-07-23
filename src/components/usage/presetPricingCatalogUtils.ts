import type { PriceCatalogEntry, TokenRates } from '@/utils/usage';

export type CatalogBandKind = 'short' | 'long';

export interface CatalogSourceLink {
  kind: 'official' | 'notes';
  url: string;
}

export const getCatalogSourceLinks = (entry: PriceCatalogEntry): CatalogSourceLink[] => [
  { kind: 'official', url: entry.sourceUrl },
  ...(entry.pricingNotesUrl && entry.pricingNotesUrl !== entry.sourceUrl
    ? [{ kind: 'notes' as const, url: entry.pricingNotesUrl }]
    : []),
];

export const getCatalogExplicitFastRates = (
  entry: PriceCatalogEntry,
  band: CatalogBandKind
): TokenRates | null => {
  const fast = entry.fast;
  if (!fast || typeof fast.multiplier === 'number') return null;
  if (band === 'long' && !fast.longSupported) return null;
  return fast.short;
};
