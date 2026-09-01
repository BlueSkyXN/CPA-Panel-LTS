export const TTFB_SOURCE_FIELD = 'ttfb_ms';
export const TTFB_SOURCE_UNIT = 'ms';

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
