import type { ProviderFamily } from '@/services/api/providers';
import type { ProviderSource } from '@/types/provider';
import type { GeminiKeyConfig, ProviderKeyConfig } from '@/types';
import type { ProviderBrand, ProviderResource, SponsorProviderRaw } from './types';
import { isMultiProtocolSponsorBrand } from './sponsorDefinitions';

export interface ConfigGroupTarget {
  family: ProviderFamily;
  source: ProviderSource;
}

export function resourceConfigGroups(resource: ProviderResource): ConfigGroupTarget[] {
  if (isMultiProtocolSponsorBrand(resource.brand)) {
    const raw = resource.raw as SponsorProviderRaw;
    return (['codex', 'claude', 'gemini'] as const)
      .flatMap((family) =>
        raw[family].flatMap(({ config }) =>
          config.source ? [{ family, source: config.source }] : []
        )
      )
      .filter(
        (target, index, targets) =>
          targets.findIndex(
            (other) =>
              other.family === target.family && other.source.groupIndex === target.source.groupIndex
          ) === index
      );
  }
  const family = providerFamily(resource.brand);
  const source = (resource.raw as ProviderKeyConfig | GeminiKeyConfig).source;
  return family && family !== 'openai-compatibility' && source ? [{ family, source }] : [];
}

export function providerFamily(brand: ProviderBrand): ProviderFamily | null {
  if (brand === 'claudeApi') return 'claude';
  if (brand === 'openaiCompatibility') return 'openai-compatibility';
  if (['gemini', 'interactions', 'codex', 'xai', 'claude', 'vertex'].includes(brand))
    return brand as ProviderFamily;
  return null;
}
