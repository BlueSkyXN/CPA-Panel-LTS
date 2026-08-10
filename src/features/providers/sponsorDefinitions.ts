import {
  CODE0_BASE_URL_OPTIONS,
  CODE0_DISPLAY_NAME,
  CODE0_PROTOCOL_LABELS,
  CODE0_PROVIDER_NAME,
  getCode0ProtocolUrls,
  resolveCode0BaseUrl,
} from './code0';
import {
  FENNO_AI_BASE_URL_OPTIONS,
  FENNO_AI_DISPLAY_NAME,
  FENNO_AI_PROTOCOL_LABELS,
  FENNO_AI_PROVIDER_NAME,
  getFennoAIProtocolUrls,
  resolveFennoAIBaseUrl,
} from './fennoAI';
import {
  INFISTAR_BASE_URL_OPTIONS,
  INFISTAR_DISPLAY_NAME,
  INFISTAR_PROTOCOL_LABELS,
  INFISTAR_PROVIDER_NAME,
  getInfistarProtocolUrls,
  resolveInfistarBaseUrl,
} from './infistar';
import {
  QINIU_CLOUD_BASE_URL_OPTIONS,
  QINIU_CLOUD_DISPLAY_NAME,
  QINIU_CLOUD_PROTOCOL_LABELS,
  QINIU_CLOUD_PROVIDER_NAME,
  getQiniuCloudProtocolUrls,
  resolveQiniuCloudBaseUrl,
} from './qiniuCloud';
import type {
  ProviderBrand,
  SponsorProtocol,
  SponsorProviderBrand,
  SponsorProviderRaw,
} from './types';

export interface SponsorProtocolUrls {
  anthropic: string;
  openai: string;
  codex: string;
  gemini: string;
}

export interface SponsorBaseUrlOption {
  id: string;
  descriptionKey?: string;
  baseUrl: string;
  openaiBaseUrl: string;
  codexBaseUrl: string;
  anthropicBaseUrl: string;
  geminiBaseUrl: string;
}

export interface SponsorProviderDefinition {
  brand: SponsorProviderBrand;
  displayName: string;
  providerName: string;
  protocols: readonly SponsorProtocol[];
  protocolLabels: readonly string[];
  defaultProtocol: SponsorProtocol;
  baseUrlOptions: readonly SponsorBaseUrlOption[];
  resolveBaseUrl: (value: string | undefined | null) => string;
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls;
}

const SPONSOR_DEFINITIONS: Record<SponsorProviderBrand, SponsorProviderDefinition> = {
  code0: {
    brand: 'code0',
    displayName: CODE0_DISPLAY_NAME,
    providerName: CODE0_PROVIDER_NAME,
    protocols: ['openai', 'claude', 'gemini', 'codex'],
    protocolLabels: CODE0_PROTOCOL_LABELS,
    defaultProtocol: 'openai',
    baseUrlOptions: CODE0_BASE_URL_OPTIONS,
    resolveBaseUrl: resolveCode0BaseUrl,
    getProtocolUrls: getCode0ProtocolUrls,
  },
  fennoAI: {
    brand: 'fennoAI',
    displayName: FENNO_AI_DISPLAY_NAME,
    providerName: FENNO_AI_PROVIDER_NAME,
    protocols: ['codex', 'claude'],
    protocolLabels: FENNO_AI_PROTOCOL_LABELS,
    defaultProtocol: 'codex',
    baseUrlOptions: FENNO_AI_BASE_URL_OPTIONS,
    resolveBaseUrl: resolveFennoAIBaseUrl,
    getProtocolUrls: getFennoAIProtocolUrls,
  },
  qiniuCloud: {
    brand: 'qiniuCloud',
    displayName: QINIU_CLOUD_DISPLAY_NAME,
    providerName: QINIU_CLOUD_PROVIDER_NAME,
    protocols: ['openai', 'claude', 'gemini', 'codex'],
    protocolLabels: QINIU_CLOUD_PROTOCOL_LABELS,
    defaultProtocol: 'openai',
    baseUrlOptions: QINIU_CLOUD_BASE_URL_OPTIONS,
    resolveBaseUrl: resolveQiniuCloudBaseUrl,
    getProtocolUrls: getQiniuCloudProtocolUrls,
  },
  infistar: {
    brand: 'infistar',
    displayName: INFISTAR_DISPLAY_NAME,
    providerName: INFISTAR_PROVIDER_NAME,
    protocols: ['openai', 'claude', 'gemini', 'codex'],
    protocolLabels: INFISTAR_PROTOCOL_LABELS,
    defaultProtocol: 'openai',
    baseUrlOptions: INFISTAR_BASE_URL_OPTIONS,
    resolveBaseUrl: resolveInfistarBaseUrl,
    getProtocolUrls: getInfistarProtocolUrls,
  },
};

export const isMultiProtocolSponsorBrand = (brand: ProviderBrand): brand is SponsorProviderBrand =>
  brand === 'code0' || brand === 'fennoAI' || brand === 'qiniuCloud' || brand === 'infistar';

export type SponsorAggregationConflict = 'multiple-configs' | 'multiple-openai-keys';

export const getSponsorAggregationConflict = (
  raw: SponsorProviderRaw | null | undefined
): SponsorAggregationConflict | null => {
  if (!raw) return null;
  if (
    raw.openai.length > 1 ||
    raw.claude.length > 1 ||
    raw.codex.length > 1 ||
    raw.gemini.length > 1
  ) {
    return 'multiple-configs';
  }

  const openAIKeyCount = raw.openai.reduce(
    (count, item) =>
      count + (item.config.apiKeyEntries ?? []).filter((entry) => entry.apiKey?.trim()).length,
    0
  );
  return openAIKeyCount > 1 ? 'multiple-openai-keys' : null;
};

export const getSponsorOpenAIDeleteIndices = (
  raw: SponsorProviderRaw | null | undefined
): number[] =>
  Array.from(new Set((raw?.openai ?? []).map((item) => item.index))).sort(
    (left, right) => right - left
  );

export const getSponsorProviderDefinition = (
  brand: SponsorProviderBrand
): SponsorProviderDefinition => SPONSOR_DEFINITIONS[brand];

export const sponsorProtocolI18nKey = (
  protocol: SponsorProtocol
): 'openai' | 'codexResponses' | 'anthropic' | 'gemini' => {
  if (protocol === 'claude') return 'anthropic';
  if (protocol === 'codex') return 'codexResponses';
  return protocol;
};

export const sponsorProtocolModelI18nKey = (
  protocol: SponsorProtocol
): 'openai' | 'codex' | 'anthropic' | 'gemini' => {
  if (protocol === 'claude') return 'anthropic';
  return protocol;
};

export const discoveryBrandForSponsorProtocol = (protocol: SponsorProtocol): ProviderBrand =>
  protocol === 'openai' ? 'openaiCompatibility' : protocol;

export const sponsorProtocolUrl = (
  urls: SponsorProtocolUrls,
  protocol: SponsorProtocol
): string => {
  if (protocol === 'claude') return urls.anthropic;
  if (protocol === 'codex') return urls.codex;
  if (protocol === 'gemini') return urls.gemini;
  return urls.openai;
};
