import { apiClient } from '@/services/api/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { modelsApi } from '@/services/api';
import { buildHeaderObject } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import type { ModelInfo } from '@/utils/models';
import type { ApiKeyEntryInput, ProviderBrand } from '../../types';

export const MODEL_DISCOVERY_BRANDS: ReadonlyArray<ProviderBrand> = [
  'gemini',
  'interactions',
  'codex',
  'xai',
  'claude',
  'claudeApi',
  'openaiCompatibility',
];

export const isModelDiscoveryBrand = (brand: ProviderBrand): boolean =>
  MODEL_DISCOVERY_BRANDS.includes(brand);

export interface UseModelDiscoveryArgs {
  brand: ProviderBrand;
  baseUrl: string;
  proxyUrl?: string;
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
}

export interface UseModelDiscoveryResult {
  available: boolean;
  loading: boolean;
  error: string | null;
  models: ModelInfo[];
  hasFetched: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
}

export function useModelDiscovery(args: UseModelDiscoveryArgs): UseModelDiscoveryResult {
  const {
    brand,
    baseUrl,
    proxyUrl,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
  } = args;

  const available = isModelDiscoveryBrand(brand);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current++;
    },
    []
  );

  const fetch = useCallback(async () => {
    if (!available) return;
    const id = ++requestId.current;
    const generation = apiClient.getConnectionGeneration();
    const current = () => id === requestId.current && apiClient.isCurrentConnection(generation);
    setLoading(true);
    setError(null);
    try {
      const baseHeaders = buildHeaderObject(formHeaders);
      const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;
      let next: ModelInfo[] = [];
      if (brand === 'gemini' || brand === 'interactions') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchGeminiModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex,
          proxyUrl
        );
      } else if (brand === 'codex' || brand === 'xai') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchV1ModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex,
          proxyUrl
        );
      } else if (brand === 'claude' || brand === 'claudeApi') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchClaudeModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders,
          resolvedAuthIndex,
          proxyUrl
        );
      } else if (brand === 'openaiCompatibility') {
        const firstEntry = (apiKeyEntries ?? []).find(
          (e) =>
            (e.apiKey ?? '').trim() || (e.existingApiKey ?? '').trim() || (e.authIndex ?? '').trim()
        );
        const entryKey =
          (firstEntry?.apiKey ?? '').trim() || (firstEntry?.existingApiKey ?? '').trim();
        const entryAuthIndex = (firstEntry?.authIndex ?? '').trim() || resolvedAuthIndex;
        try {
          next = await modelsApi.fetchModelsViaApiCall(
            baseUrl,
            entryKey,
            baseHeaders,
            entryAuthIndex,
            firstEntry?.proxyUrl
          );
        } catch (firstErr) {
          if (!current()) return;
          // Some OpenAI-compatible endpoints expose /models without auth, or
          // reject the configured key for the discovery route. Retry once
          // without any auth/headers before surfacing the original error.
          try {
            next = await modelsApi.fetchModelsViaApiCall(
              baseUrl,
              undefined,
              undefined,
              undefined,
              firstEntry?.proxyUrl
            );
          } catch {
            throw firstErr;
          }
        }
      }
      if (!current()) return;
      setModels(next ?? []);
      setHasFetched(true);
    } catch (err) {
      if (!current()) return;
      setModels([]);
      setError(getErrorMessage(err) || 'Failed to fetch models');
      setHasFetched(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [
    available,
    apiKey,
    apiKeyEntries,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    proxyUrl,
  ]);

  const reset = useCallback(() => {
    requestId.current++;
    setModels([]);
    setError(null);
    setLoading(false);
    setHasFetched(false);
  }, []);

  const inputSignature = useMemo(() => {
    const headerSig = formHeaders.map((h) => `${h.key}:${h.value}`).join('|');
    const entriesSig = (apiKeyEntries ?? [])
      .map(
        (e) =>
          `${e.apiKey ?? ''}::${e.existingApiKey ?? ''}::${e.authIndex ?? ''}::${e.proxyUrl ?? ''}`
      )
      .join('|');
    return [
      baseUrl,
      proxyUrl ?? '',
      apiKey ?? '',
      fallbackApiKey ?? '',
      authIndex ?? '',
      headerSig,
      entriesSig,
    ].join('||');
  }, [apiKey, apiKeyEntries, authIndex, baseUrl, fallbackApiKey, formHeaders, proxyUrl]);

  const lastSignatureRef = useRef(inputSignature);
  useEffect(() => {
    if (lastSignatureRef.current === inputSignature) return;
    lastSignatureRef.current = inputSignature;
    reset();
  }, [inputSignature, reset]);

  return { available, loading, error, models, hasFetched, fetch, reset };
}
