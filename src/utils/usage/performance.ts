export const TTFB_SOURCE_FIELD = 'ttfb_ms';
export const TTFB_SOURCE_UNIT = 'ms';
export const TTFT_SOURCE_FIELD = 'ttft_ms';
export const TTFR_SOURCE_FIELD = 'ttfr_ms';
export const TTFA_SOURCE_FIELD = 'ttfa_ms';
export const TIMING_VERSION_SOURCE_FIELD = 'timing_version';
export const SEMANTIC_TIMING_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readNonNegativeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * 从 Core usage detail 提取首字节时间。单位为毫秒；缺失或非法值返回 null。
 */
export function extractTTFBMs(detail: unknown): number | null {
  const record = isRecord(detail) ? detail : null;
  return readNonNegativeNumber(record?.[TTFB_SOURCE_FIELD]);
}

/** 提取 canonical v3 的 semantic timing version。 */
export function extractTimingVersion(detail: unknown): number | null {
  const record = isRecord(detail) ? detail : null;
  const parsed = readNonNegativeNumber(record?.[TIMING_VERSION_SOURCE_FIELD]);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

const extractSemanticTimingMs = (detail: unknown, field: string): number | null => {
  if (extractTimingVersion(detail) !== SEMANTIC_TIMING_VERSION) return null;
  const record = isRecord(detail) ? detail : null;
  return readNonNegativeNumber(record?.[field]);
};

/** 提取首个 reasoning 内容时间；旧 schema 或非法值返回 null。 */
export function extractTTFTMs(detail: unknown): number | null {
  return extractSemanticTimingMs(detail, TTFT_SOURCE_FIELD);
}

/** 提取首个 reasoning token 时间（canonical v3 ttfr_ms）；旧 schema 或非法值返回 null。 */
export function extractTTFRMs(detail: unknown): number | null {
  return extractSemanticTimingMs(detail, TTFR_SOURCE_FIELD);
}

/** 提取首个 assistant 文本时间；旧 schema 或非法值返回 null。 */
export function extractTTFAMs(detail: unknown): number | null {
  return extractSemanticTimingMs(detail, TTFA_SOURCE_FIELD);
}

/** 校验 semantic timing 与同一 request 的 latency/TTFB 因果关系。 */
export function normalizeSemanticTimingMs(
  value: number | null | undefined,
  latencyMs: number | null | undefined,
  ttfbMs: number | null | undefined
): number | null {
  const timing = readNonNegativeNumber(value);
  const latency = readNonNegativeNumber(latencyMs);
  const ttfb = readNonNegativeNumber(ttfbMs);
  if (timing === null || latency === null || ttfb === null) return null;
  if (timing < ttfb || timing > latency) return null;
  return timing;
}

/**
 * 计算首字节之后的有效输出时长。
 * latency 和 ttfb 必须来自同一条 request detail；无法得到正时长时返回 null。
 */
export function calculateDecodeDurationMs(
  latencyMs: number | null | undefined,
  ttfbMs: number | null | undefined
): number | null {
  const latency = readNonNegativeNumber(latencyMs);
  const ttfb = readNonNegativeNumber(ttfbMs);
  if (latency === null || ttfb === null || latency <= ttfb) {
    return null;
  }
  return latency - ttfb;
}

/**
 * 输出 TPS = 总输出 token / (总耗时 - 首字节时间)。
 * 输出 token 保留 provider 报告的总输出语义，因此可能包含 reasoning token。
 */
export function calculateOutputTps(
  outputTokens: number | null | undefined,
  latencyMs: number | null | undefined,
  ttfbMs: number | null | undefined
): number | null {
  const output = readNonNegativeNumber(outputTokens);
  const decodeDurationMs = calculateDecodeDurationMs(latencyMs, ttfbMs);
  if (output === null || output <= 0 || decodeDurationMs === null) {
    return null;
  }
  return (output * 1000) / decodeDurationMs;
}

/**
 * 端到端平均 TPS = 总输出 token / 总耗时。
 */
export function calculateAverageTps(
  outputTokens: number | null | undefined,
  latencyMs: number | null | undefined
): number | null {
  const output = readNonNegativeNumber(outputTokens);
  const latency = readNonNegativeNumber(latencyMs);
  if (output === null || output <= 0 || latency === null || latency <= 0) {
    return null;
  }
  return (output * 1000) / latency;
}

/** 可见输出 TPS = max(output_tokens - reasoning_tokens, 0) / 总延迟。 */
export function calculateVisibleAverageTps(
  outputTokens: number | null | undefined,
  reasoningTokens: number | null | undefined,
  latencyMs: number | null | undefined
): number | null {
  const output = readNonNegativeNumber(outputTokens);
  const reasoning = readNonNegativeNumber(reasoningTokens);
  const latency = readNonNegativeNumber(latencyMs);
  if (
    output === null ||
    output <= 0 ||
    reasoning === null ||
    reasoning > output ||
    latency === null ||
    latency <= 0
  ) {
    return null;
  }
  return (Math.max(output - reasoning, 0) * 1000) / latency;
}

/** Reasoning 占比 = reasoning_tokens / output_tokens。 */
export function calculateReasoningRatio(
  outputTokens: number | null | undefined,
  reasoningTokens: number | null | undefined
): number | null {
  const output = readNonNegativeNumber(outputTokens);
  const reasoning = readNonNegativeNumber(reasoningTokens);
  if (output === null || output <= 0 || reasoning === null || reasoning > output) {
    return null;
  }
  return reasoning / output;
}

export interface UsagePerformanceSummaryRow {
  outputTokens: number | null | undefined;
  reasoningTokens: number | null | undefined;
  latencyMs: number | null | undefined;
  ttfbMs: number | null | undefined;
}

export interface UsagePerformanceSummaryMetric {
  value: number | null;
  sampleCount: number;
}

export interface UsagePerformanceSummary {
  totalCount: number;
  outputTps: UsagePerformanceSummaryMetric;
  averageTps: UsagePerformanceSummaryMetric;
  visibleAverageTps: UsagePerformanceSummaryMetric;
  reasoningRatio: UsagePerformanceSummaryMetric;
}

/** 按有效样本集合计算筛选结果汇总，禁止平均逐请求速率。 */
export function summarizeUsagePerformance(
  rows: readonly UsagePerformanceSummaryRow[]
): UsagePerformanceSummary {
  let outputNumerator = 0;
  let outputDuration = 0;
  let outputSamples = 0;
  let averageNumerator = 0;
  let averageDuration = 0;
  let averageSamples = 0;
  let visibleNumerator = 0;
  let visibleDuration = 0;
  let visibleSamples = 0;
  let reasoningNumerator = 0;
  let reasoningDenominator = 0;
  let reasoningSamples = 0;

  for (const row of rows) {
    const output = readNonNegativeNumber(row.outputTokens);
    const reasoning = readNonNegativeNumber(row.reasoningTokens);
    const latency = readNonNegativeNumber(row.latencyMs);
    const ttfb = readNonNegativeNumber(row.ttfbMs);
    if (output === null || output <= 0 || latency === null || latency <= 0) continue;

    if (ttfb !== null && latency > ttfb) {
      outputNumerator += output;
      outputDuration += latency - ttfb;
      outputSamples += 1;
    }

    averageNumerator += output;
    averageDuration += latency;
    averageSamples += 1;

    if (reasoning !== null && reasoning <= output) {
      visibleNumerator += Math.max(output - reasoning, 0);
      visibleDuration += latency;
      visibleSamples += 1;
      reasoningNumerator += reasoning;
      reasoningDenominator += output;
      reasoningSamples += 1;
    }
  }

  return {
    totalCount: rows.length,
    outputTps: {
      value: outputDuration > 0 ? (outputNumerator * 1000) / outputDuration : null,
      sampleCount: outputSamples,
    },
    averageTps: {
      value: averageDuration > 0 ? (averageNumerator * 1000) / averageDuration : null,
      sampleCount: averageSamples,
    },
    visibleAverageTps: {
      value: visibleDuration > 0 ? (visibleNumerator * 1000) / visibleDuration : null,
      sampleCount: visibleSamples,
    },
    reasoningRatio: {
      value: reasoningDenominator > 0 ? reasoningNumerator / reasoningDenominator : null,
      sampleCount: reasoningSamples,
    },
  };
}

/**
 * 格式化 tokens/s，保持和 Panel 现有每分钟速率卡片相近的精度。
 */
export function formatPerSecondValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '--';
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return '--';
  }
  const abs = Math.abs(parsed);
  if (abs >= 1000) {
    return Math.round(parsed).toLocaleString();
  }
  if (abs >= 100) {
    return parsed.toFixed(0);
  }
  if (abs >= 10) {
    return parsed.toFixed(1);
  }
  return parsed.toFixed(2);
}
