// codex.outbound（CPA-Core-LTS docs/lts/codex-outbound.md）：Codex 请求发往上游的传输方式、请求体压缩与 Accept-Encoding。
// 空值代表由 Core 使用默认值；未知值保持原样可辨识，只有用户显式修改时才写回。

export const CODEX_OUTBOUND_TRANSPORTS = ['follow', 'websocket', 'auto'] as const;
export const CODEX_OUTBOUND_REQUEST_COMPRESSIONS = ['auto', 'none'] as const;
export const CODEX_OUTBOUND_ACCEPT_ENCODINGS = ['official', 'legacy'] as const;
export const CODEX_OUTBOUND_DEFAULT_WEBSOCKET_THRESHOLD_BYTES = 786432;

export type CodexOutboundTransport = (typeof CODEX_OUTBOUND_TRANSPORTS)[number];
export type CodexOutboundRequestCompression = (typeof CODEX_OUTBOUND_REQUEST_COMPRESSIONS)[number];
export type CodexOutboundAcceptEncoding = (typeof CODEX_OUTBOUND_ACCEPT_ENCODINGS)[number];

/** Core defaults applied when a key is absent. */
export const CODEX_OUTBOUND_DEFAULTS = {
  transport: 'follow',
  requestCompression: 'auto',
  acceptEncoding: 'official',
} as const;

const UNSUPPORTED = '__unsupported__';

export const isCodexOutboundTransport = (value: string): value is CodexOutboundTransport =>
  (CODEX_OUTBOUND_TRANSPORTS as readonly string[]).includes(value);
export const isCodexOutboundRequestCompression = (
  value: string
): value is CodexOutboundRequestCompression =>
  (CODEX_OUTBOUND_REQUEST_COMPRESSIONS as readonly string[]).includes(value);
export const isCodexOutboundAcceptEncoding = (value: string): value is CodexOutboundAcceptEncoding =>
  (CODEX_OUTBOUND_ACCEPT_ENCODINGS as readonly string[]).includes(value);

export interface CodexOutboundValues {
  transport: string;
  websocketThresholdBytes: string;
  requestCompression: string;
  acceptEncoding: string;
}

const readEnum = (value: unknown): string => {
  if (value == null) return '';
  return typeof value === 'string' ? value.trim().toLowerCase() : UNSUPPORTED;
};

const readThreshold = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'string') return String(value).trim();
  return UNSUPPORTED;
};

export function readCodexOutbound(value: unknown): CodexOutboundValues {
  if (value == null) {
    return { transport: '', websocketThresholdBytes: '', requestCompression: '', acceptEncoding: '' };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      transport: UNSUPPORTED,
      websocketThresholdBytes: '',
      requestCompression: UNSUPPORTED,
      acceptEncoding: UNSUPPORTED,
    };
  }
  const v = value as Record<string, unknown>;
  return {
    transport: readEnum(v.transport),
    websocketThresholdBytes: readThreshold(v['websocket-threshold-bytes']),
    requestCompression: readEnum(v['request-compression']),
    acceptEncoding: readEnum(v['accept-encoding']),
  };
}
