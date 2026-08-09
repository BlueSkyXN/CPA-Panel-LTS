export type DisplayServiceTier = 'fast' | 'std';

export type ServiceTierEvidence = 'effective' | 'response' | 'outbound' | 'request' | 'assumed';

export interface ServiceTierValues {
  serviceTier?: unknown;
  requestServiceTier?: unknown;
  outboundServiceTier?: unknown;
  responseServiceTier?: unknown;
  effectiveServiceTier?: unknown;
}

export interface ResolvedServiceTier {
  tier: DisplayServiceTier;
  evidence: ServiceTierEvidence;
  rawRequest: string | null;
  rawOutbound: string | null;
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
  const rawOutbound = normalizeServiceTier(values.outboundServiceTier);
  const rawRequest =
    normalizeServiceTier(values.requestServiceTier) ?? normalizeServiceTier(values.serviceTier);

  const effectiveTier = classifyServiceTier(rawEffective);
  if (effectiveTier) {
    const responseTier = classifyServiceTier(rawResponse);
    const outboundTier = classifyServiceTier(rawOutbound);
    return {
      tier: effectiveTier,
      evidence:
        responseTier === effectiveTier
          ? 'response'
          : rawResponse === null && outboundTier === effectiveTier
            ? 'outbound'
            : 'effective',
      rawRequest,
      rawOutbound,
      rawResponse,
      rawEffective,
    };
  }

  // A present but unrecognized effective tier is the highest-authority
  // evidence available. Do not let lower-priority response or request values
  // turn a future/unknown tier into a Fast estimate.
  if (rawEffective) {
    return {
      tier: 'std',
      evidence: 'assumed',
      rawRequest,
      rawOutbound,
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
      rawOutbound,
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
      rawOutbound,
      rawResponse,
      rawEffective,
    };
  }

  const outboundTier = classifyServiceTier(rawOutbound);
  if (outboundTier) {
    return {
      tier: outboundTier,
      evidence: 'outbound',
      rawRequest,
      rawOutbound,
      rawResponse,
      rawEffective,
    };
  }

  if (rawOutbound) {
    return {
      tier: 'std',
      evidence: 'assumed',
      rawRequest,
      rawOutbound,
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
      rawOutbound,
      rawResponse,
      rawEffective,
    };
  }

  return {
    tier: 'std',
    evidence: 'assumed',
    rawRequest,
    rawOutbound,
    rawResponse,
    rawEffective,
  };
}
