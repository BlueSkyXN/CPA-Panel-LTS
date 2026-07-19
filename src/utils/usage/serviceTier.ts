export type DisplayServiceTier = 'fast' | 'std';

export type ServiceTierEvidence = 'effective' | 'response' | 'request' | 'assumed';

export interface ServiceTierValues {
  serviceTier?: unknown;
  requestServiceTier?: unknown;
  responseServiceTier?: unknown;
  effectiveServiceTier?: unknown;
}

export interface ResolvedServiceTier {
  tier: DisplayServiceTier;
  evidence: ServiceTierEvidence;
  rawRequest: string | null;
  rawResponse: string | null;
  rawEffective: string | null;
}

export function normalizeServiceTier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function classifyServiceTier(value: unknown): DisplayServiceTier | null {
  const normalized = normalizeServiceTier(value)?.toLowerCase();
  if (normalized === 'priority' || normalized === 'fast') return 'fast';
  if (normalized === 'standard' || normalized === 'default') return 'std';
  return null;
}

export function resolveServiceTier(values: ServiceTierValues): ResolvedServiceTier {
  const rawEffective = normalizeServiceTier(values.effectiveServiceTier);
  const rawResponse = normalizeServiceTier(values.responseServiceTier);
  const rawRequest =
    normalizeServiceTier(values.requestServiceTier) ?? normalizeServiceTier(values.serviceTier);

  const effectiveTier = classifyServiceTier(rawEffective);
  if (effectiveTier) {
    return {
      tier: effectiveTier,
      evidence: 'effective',
      rawRequest,
      rawResponse,
      rawEffective,
    };
  }

  const responseTier = classifyServiceTier(rawResponse);
  if (responseTier) {
    return {
      tier: responseTier,
      evidence: 'response',
      rawRequest,
      rawResponse,
      rawEffective,
    };
  }

  // A non-empty, unrecognized response is authoritative evidence that the
  // request-side intent cannot safely determine the billed tier.
  if (rawResponse) {
    return {
      tier: 'std',
      evidence: 'assumed',
      rawRequest,
      rawResponse,
      rawEffective,
    };
  }

  const requestTier = classifyServiceTier(rawRequest);
  if (requestTier) {
    return {
      tier: requestTier,
      evidence: 'request',
      rawRequest,
      rawResponse,
      rawEffective,
    };
  }

  return {
    tier: 'std',
    evidence: 'assumed',
    rawRequest,
    rawResponse,
    rawEffective,
  };
}
