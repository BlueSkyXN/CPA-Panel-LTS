import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ThHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSettings, IconSlidersHorizontal } from '@/components/ui/icons';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { authFilesApi } from '@/services/api/authFiles';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  classifyServiceTier,
  calculateAverageTps,
  calculateCostEstimate,
  calculateDecodeDurationMs,
  calculateFirstContentMs,
  calculateReasoningRatio,
  calculateOutputTps,
  calculateVisibleAverageTps,
  collectUsageDetails,
  extractLatencyMs,
  extractTTFAMs,
  extractTTFBMs,
  extractTTFTMs,
  extractTimingVersion,
  extractTotalTokens,
  formatDurationMs,
  formatPerSecondValue,
  LATENCY_SOURCE_FIELD,
  TTFB_SOURCE_FIELD,
  normalizeAuthIndex,
  normalizeSemanticTimingMs,
  resolveServiceTier,
  summarizeUsagePerformance,
  type CostEstimateStatus,
  type DisplayServiceTier,
  type PriceProfileV3,
  type ResolvedServiceTier,
  type UsageTimeRange,
} from '@/utils/usage';
import {
  getUsageCacheTokenCounts,
  getUsageNonCacheReadInputTokenCount,
} from '@/utils/usage/cacheTokens';
import { normalizeReasoningEffort } from '@/utils/usage/reasoningEffort';
import { downloadBlob } from '@/utils/download';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const SERVICE_TIER_FAST_FILTER = '__service_tier_fast__';
const SERVICE_TIER_STD_FILTER = '__service_tier_std__';
const REASONING_EFFORT_LEGACY_UNKNOWN_FILTER = '__reasoning_effort_legacy_unknown__';
const REASONING_EFFORT_RAW_FILTER_PREFIX = '__reasoning_effort_raw__:';
const RESULT_SUCCESS_FILTER = '__result_success__';
const RESULT_FAILED_FILTER = '__result_failed__';
const CACHE_PRESENT_FILTER = '__cache_present__';
const CACHE_ABSENT_FILTER = '__cache_absent__';
const MAX_RENDERED_EVENTS = 500;
const REQUEST_IDENTITY_ENDPOINT_REGEX = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\/\S*/i;
const maskRequestKey = (value: string): string => {
  if (value.length <= 4) return '**';
  if (value.length <= 7) return `${value.slice(0, 1)}**${value.slice(-1)}`;
  return `${value.slice(0, 2)}**${value.slice(-2)}`;
};
const LEGACY_COLUMN_VISIBILITY_STORAGE_KEYS = [
  'cli-proxy-usage-request-event-columns-v1',
  'cli-proxy-usage-request-event-columns-v2',
] as const;
const COLUMN_VISIBILITY_STORAGE_KEY = 'cli-proxy-usage-request-event-columns-v3';

const REQUEST_EVENT_TIME_RANGES = ['page', 'all', '1h', '24h', '7d', '30d'] as const;
type RequestEventTimeRange = (typeof REQUEST_EVENT_TIME_RANGES)[number];

const REQUEST_EVENT_TIME_RANGE_MS: Record<
  Exclude<RequestEventTimeRange, 'page' | 'all'>,
  number
> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const PAGE_TIME_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '7h': 7 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const PAGE_TIME_RANGE_LABEL_KEYS: Record<UsageTimeRange, string> = {
  '7h': 'usage_stats.range_7h',
  '24h': 'usage_stats.range_24h',
  '7d': 'usage_stats.range_7d',
  all: 'usage_stats.range_all',
};

const CACHE_RATE_LOW_THRESHOLD = 0.25;
const CACHE_RATE_HIGH_THRESHOLD = 0.6;

const REQUEST_EVENT_COLUMN_IDS = [
  'timestamp',
  'model',
  'requestKey',
  'source',
  'authIndex',
  'tier',
  'result',
  'latency',
  'ttfb',
  'firstContent',
  'ttft',
  'ttfa',
  'outputTps',
  'averageTps',
  'visibleAverageTps',
  'reasoningRatio',
  'effort',
  'totalInputTokens',
  'nonCacheReadInputTokens',
  'totalOutputTokens',
  'displayedOutputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
  'cost',
] as const;

type RequestEventColumnId = (typeof REQUEST_EVENT_COLUMN_IDS)[number];
type RequestEventColumnVisibility = Record<RequestEventColumnId, boolean>;
type RequestIdentityType = 'configured-key' | 'endpoint' | 'caller' | 'unknown';
type RequestEventCacheRateTone = 'unavailable' | 'low' | 'medium' | 'high' | 'anomaly';
type RequestEventCostTone =
  | 'unavailable'
  | 'inactive'
  | 'free'
  | 'micro'
  | 'low'
  | 'medium'
  | 'elevated'
  | 'high'
  | 'critical';
type RequestEventReasoningEffortTone =
  | 'empty'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'
  | 'other';

type RequestEventHeaderTooltipState = {
  key: string;
  text: string;
  anchorEl: HTMLTableCellElement;
  left: number;
  top: number;
  width: number;
  transform: string;
};

const buildRequestEventHeaderTooltipState = (
  key: string,
  text: string,
  anchorEl: HTMLTableCellElement
): RequestEventHeaderTooltipState => {
  const viewportMargin = 16;
  const tooltipOffset = 8;
  const tooltipSafeHeight = 132;
  const width = Math.min(360, Math.max(0, window.innerWidth - viewportMargin * 2));
  const rect = anchorEl.getBoundingClientRect();
  const halfWidth = width / 2;
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, viewportMargin + halfWidth),
    Math.max(viewportMargin + halfWidth, window.innerWidth - viewportMargin - halfWidth)
  );
  const openBelow =
    window.innerHeight - rect.bottom >= tooltipSafeHeight || rect.top < tooltipSafeHeight;

  return {
    key,
    text,
    anchorEl,
    left,
    top: openBelow ? rect.bottom + tooltipOffset : rect.top - tooltipOffset,
    width,
    transform: openBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
  };
};

const REQUEST_EVENT_NUMERIC_METRIC_IDS = [
  'totalInputTokens',
  'nonCacheReadInputTokens',
  'totalOutputTokens',
  'displayedOutputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
] as const;

type RequestEventNumericMetricId = (typeof REQUEST_EVENT_NUMERIC_METRIC_IDS)[number];

const DEFAULT_COLUMN_VISIBILITY: RequestEventColumnVisibility = {
  timestamp: true,
  model: true,
  requestKey: true,
  source: false,
  authIndex: false,
  tier: true,
  result: true,
  latency: true,
  ttfb: true,
  firstContent: true,
  ttft: true,
  ttfa: true,
  outputTps: true,
  averageTps: true,
  visibleAverageTps: false,
  reasoningRatio: false,
  effort: true,
  totalInputTokens: true,
  nonCacheReadInputTokens: true,
  totalOutputTokens: true,
  displayedOutputTokens: true,
  reasoningTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  totalTokens: true,
  cost: true,
};

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  requestIdentityToken: string;
  requestIdentityType: RequestIdentityType;
  requestIdentityLabel: string;
  requestKeyHint: string;
  requestKeyConfigIndex: number | null;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  serviceTier: string | null;
  requestServiceTier: string | null;
  outboundServiceTier: string | null;
  responseServiceTier: string | null;
  effectiveServiceTier: string | null;
  resolvedServiceTier: ResolvedServiceTier;
  requestDisplayServiceTier: DisplayServiceTier | null;
  serviceTierFilterValue: string;
  requestServiceTierLabel: string | null;
  serviceTierLabel: string;
  serviceTierTitle: string;
  reasoningEffort: string | null;
  reasoningEffortFilterValue: string;
  reasoningEffortLabel: string;
  failed: boolean;
  latencyMs: number | null;
  ttfbMs: number | null;
  timingVersion: number | null;
  firstContentMs: number | null;
  ttftMs: number | null;
  ttfaMs: number | null;
  decodeDurationMs: number | null;
  outputTps: number | null;
  averageTps: number | null;
  visibleAverageTps: number | null;
  reasoningRatio: number | null;
  inputTokens: number;
  nonCacheReadInputTokens: number;
  outputTokens: number;
  displayedOutputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheRate: number | null;
  cacheRateTone: RequestEventCacheRateTone;
  longContext: boolean;
  totalTokens: number;
  costAmount: number | null;
  costStatus: CostEstimateStatus;
  costTone: RequestEventCostTone;
};

const isRequestEventNumericMetricId = (value: string): value is RequestEventNumericMetricId =>
  REQUEST_EVENT_NUMERIC_METRIC_IDS.some((candidate) => candidate === value);

const getRequestEventNumericValue = (
  row: RequestEventRow,
  metric: RequestEventNumericMetricId
): number => {
  switch (metric) {
    case 'totalInputTokens':
      return row.inputTokens;
    case 'nonCacheReadInputTokens':
      return row.nonCacheReadInputTokens;
    case 'totalOutputTokens':
      return row.outputTokens;
    case 'displayedOutputTokens':
      return row.displayedOutputTokens;
    case 'reasoningTokens':
      return row.reasoningTokens;
    case 'cacheReadTokens':
      return row.cacheReadTokens;
    case 'cacheWriteTokens':
      return row.cacheWriteTokens;
    case 'totalTokens':
      return row.totalTokens;
  }
};

const parseNumericFilterBound = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const resolveNumericFilterPopoverStyle = (trigger: HTMLElement): CSSProperties => {
  const viewportMargin = 16;
  const popoverOffset = 8;
  const popoverWidth = Math.min(420, Math.max(0, window.innerWidth - viewportMargin * 2));
  const triggerBounds = trigger.getBoundingClientRect();
  const left = Math.min(
    Math.max(triggerBounds.left, viewportMargin),
    Math.max(viewportMargin, window.innerWidth - popoverWidth - viewportMargin)
  );
  const spaceBelow = window.innerHeight - triggerBounds.bottom - viewportMargin - popoverOffset;
  const spaceAbove = triggerBounds.top - viewportMargin - popoverOffset;
  const openBelow = spaceBelow >= 420 || spaceBelow >= spaceAbove;
  const availableHeight = Math.max(0, openBelow ? spaceBelow : spaceAbove);
  const verticalPosition = openBelow
    ? { top: triggerBounds.bottom + popoverOffset }
    : { bottom: window.innerHeight - triggerBounds.top + popoverOffset };

  return {
    position: 'fixed',
    left,
    width: popoverWidth,
    maxHeight: Math.min(620, availableHeight),
    ...verticalPosition,
  };
};

const numericFilterPopoverStylesEqual = (
  current: CSSProperties | null,
  next: CSSProperties
): boolean =>
  current?.position === next.position &&
  current?.top === next.top &&
  current?.bottom === next.bottom &&
  current?.left === next.left &&
  current?.width === next.width &&
  current?.maxHeight === next.maxHeight;

export interface RequestEventsDetailsCardProps {
  usage: unknown;
  loading: boolean;
  pageTimeRange: UsageTimeRange;
  referenceNowMs: number;
  priceProfile: PriceProfileV3;
  requestApiKeys: string[];
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const getReasoningEffortFilterValue = (reasoningEffort: string | null): string => {
  if (!reasoningEffort) return REASONING_EFFORT_LEGACY_UNKNOWN_FILTER;
  return `${REASONING_EFFORT_RAW_FILTER_PREFIX}${encodeURIComponent(
    reasoningEffort.toLowerCase()
  )}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isRequestEventTimeRange = (value: string): value is RequestEventTimeRange =>
  REQUEST_EVENT_TIME_RANGES.some((candidate) => candidate === value);

const normalizeColumnVisibility = (value: unknown): RequestEventColumnVisibility => {
  const record = isRecord(value) ? value : {};
  const normalized = REQUEST_EVENT_COLUMN_IDS.reduce<RequestEventColumnVisibility>(
    (normalized, columnId) => {
      normalized[columnId] =
        typeof record[columnId] === 'boolean'
          ? (record[columnId] as boolean)
          : DEFAULT_COLUMN_VISIBILITY[columnId];
      return normalized;
    },
    { ...DEFAULT_COLUMN_VISIBILITY }
  );

  const hasStableVisibleColumn = REQUEST_EVENT_COLUMN_IDS.some(
    (columnId) => columnId !== 'latency' && normalized[columnId]
  );
  if (!hasStableVisibleColumn) {
    normalized.timestamp = true;
  }

  return normalized;
};

const needsColumnVisibilityNormalization = (
  stored: unknown,
  normalized: RequestEventColumnVisibility
): boolean => {
  if (!isRecord(stored)) return true;
  const allowedIds = new Set<string>(REQUEST_EVENT_COLUMN_IDS);
  return (
    Object.keys(stored).some((key) => !allowedIds.has(key)) ||
    REQUEST_EVENT_COLUMN_IDS.some((columnId) => stored[columnId] !== normalized[columnId])
  );
};

const getReasoningEffortTone = (
  reasoningEffort: string | null
): RequestEventReasoningEffortTone => {
  if (!reasoningEffort) return 'empty';
  switch (reasoningEffort.trim().toLowerCase()) {
    case 'none':
      return 'none';
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'xhigh';
    case 'max':
      return 'max';
    case 'ultra':
      return 'ultra';
    default:
      return 'other';
  }
};

const getReasoningEffortClassName = (reasoningEffort: string | null): string => {
  const tone = getReasoningEffortTone(reasoningEffort);
  if (tone === 'empty') {
    return `${styles.requestEventsEffortBadge} ${styles.requestEventsEffortEmpty}`;
  }
  const toneClassName = {
    none: styles.requestEventsEffortNone,
    minimal: styles.requestEventsEffortMinimal,
    low: styles.requestEventsEffortLow,
    medium: styles.requestEventsEffortMedium,
    high: styles.requestEventsEffortHigh,
    xhigh: styles.requestEventsEffortXHigh,
    max: styles.requestEventsEffortMax,
    ultra: styles.requestEventsEffortUltra,
    other: styles.requestEventsEffortOther,
  }[tone];
  return `${styles.requestEventsEffortBadge} ${toneClassName}`;
};

const resolveCacheRate = (inputTokens: number, cacheReadTokens: number): number | null => {
  if (inputTokens <= 0) return null;
  return Math.max(cacheReadTokens / inputTokens, 0);
};

const getCacheRateTone = (
  cacheRate: number | null,
  inputTokens: number,
  cacheReadTokens: number
): RequestEventCacheRateTone => {
  if (cacheReadTokens > 0 && (inputTokens <= 0 || cacheReadTokens > inputTokens)) {
    return 'anomaly';
  }
  if (inputTokens <= 0) return 'unavailable';
  if (cacheRate === null) return 'unavailable';
  if (cacheRate < CACHE_RATE_LOW_THRESHOLD) return 'low';
  if (cacheRate < CACHE_RATE_HIGH_THRESHOLD) return 'medium';
  return 'high';
};

const getCacheRateToneClassName = (tone: RequestEventCacheRateTone): string =>
  ({
    unavailable: styles.requestEventsCacheRateUnavailable,
    low: styles.requestEventsCacheRateLow,
    medium: styles.requestEventsCacheRateMedium,
    high: styles.requestEventsCacheRateHigh,
    anomaly: styles.requestEventsCacheRateAnomaly,
  })[tone];

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

const formatRequestEventCostUsd = (value: number, locale: string): string => {
  if (value === 0) return '$0.00';

  if (value < 0.01) {
    const cents = value * 100;
    if (Number(cents.toFixed(4)) === 0) return '≈0';
    return `${cents.toLocaleString(locale, {
      maximumFractionDigits: 4,
    })}¢`;
  }

  return `$${value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
};

const formatReasoningRatioValue = (value: number | null, locale: string): string => {
  if (value === null || !Number.isFinite(value) || value < 0) return '--';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
};

const getRequestEventCostTone = (
  amount: number | null,
  status: CostEstimateStatus,
  totalTokens: number
): RequestEventCostTone => {
  if (status !== 'priced' || amount === null) return 'unavailable';
  if (amount === 0) return totalTokens > 0 ? 'free' : 'inactive';
  if (amount < 0.01) return 'micro';
  if (amount < 0.05) return 'low';
  if (amount < 0.1) return 'medium';
  if (amount < 0.2) return 'elevated';
  if (amount < 0.5) return 'high';
  return 'critical';
};

export function RequestEventsDetailsCard({
  usage,
  loading,
  pageTimeRange,
  referenceNowMs,
  priceProfile,
  requestApiKeys,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
}: RequestEventsDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const useNumericFilterSheet = useMediaQuery('(max-width: 768px)');
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });
  const ttfbHint = t('usage_stats.request_events_ttfb_hint', {
    field: TTFB_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });
  const firstContentHint = t('usage_stats.request_events_first_content_hint');
  const ttftHint = t('usage_stats.request_events_ttft_hint');
  const ttfaHint = t('usage_stats.request_events_ttfa_hint');
  const visibleAverageTpsHint = t('usage_stats.request_events_visible_average_tps_hint');
  const reasoningRatioHint = t('usage_stats.request_events_reasoning_ratio_hint');
  const outputTpsHint = t('usage_stats.request_events_output_tps_hint');
  const averageTpsHint = t('usage_stats.request_events_average_tps_hint');
  const nonCacheReadInputHint = t('usage_stats.request_events_non_cache_read_input_tokens_hint');
  const displayedOutputHint = t('usage_stats.request_events_output_tokens_hint');
  const requestKeyColumnHint = t('usage_stats.request_events_request_key_hint');
  const cacheRateFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: 'percent',
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  );
  const numericBoundFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: 20,
      }),
    [i18n.language]
  );

  const [modelFilter, setModelFilter] = useState(ALL_FILTER);
  const [requestKeyFilter, setRequestKeyFilter] = useState(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState(ALL_FILTER);
  const [serviceTierFilter, setServiceTierFilter] = useState(ALL_FILTER);
  const [reasoningEffortFilter, setReasoningEffortFilter] = useState(ALL_FILTER);
  const [resultFilter, setResultFilter] = useState(ALL_FILTER);
  const [timeRangeFilter, setTimeRangeFilter] = useState<RequestEventTimeRange>('page');
  const [timeRangeClockMs, setTimeRangeClockMs] = useState(0);
  const [cacheFilter, setCacheFilter] = useState(ALL_FILTER);
  const [numericMetricFilter, setNumericMetricFilter] = useState(ALL_FILTER);
  const [numericMinimumFilter, setNumericMinimumFilter] = useState('');
  const [numericMaximumFilter, setNumericMaximumFilter] = useState('');
  const [numericFilterOpen, setNumericFilterOpen] = useState(false);
  const [numericFilterPresentation, setNumericFilterPresentation] = useState<
    'popover' | 'sheet' | null
  >(null);
  const [numericFilterPopoverStyle, setNumericFilterPopoverStyle] = useState<CSSProperties | null>(
    null
  );
  const [draftNumericMetricFilter, setDraftNumericMetricFilter] =
    useState<RequestEventNumericMetricId>('totalTokens');
  const [draftNumericMinimumFilter, setDraftNumericMinimumFilter] = useState('');
  const [draftNumericMaximumFilter, setDraftNumericMaximumFilter] = useState('');
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [activeHeaderTooltip, setActiveHeaderTooltip] =
    useState<RequestEventHeaderTooltipState | null>(null);
  const [storedColumnVisibility, setStoredColumnVisibility] = useLocalStorage<unknown>(
    COLUMN_VISIBILITY_STORAGE_KEY,
    DEFAULT_COLUMN_VISIBILITY
  );
  const columnVisibility = useMemo(
    () => normalizeColumnVisibility(storedColumnVisibility),
    [storedColumnVisibility]
  );
  const columnSettingsId = useId();
  const headerTooltipId = useId();
  const numericFilterId = useId();
  const numericMetricSelectId = useId();
  const numericFilterErrorId = useId();
  const columnSettingsRef = useRef<HTMLDivElement | null>(null);
  const columnSettingsPanelRef = useRef<HTMLDivElement | null>(null);
  const numericFilterRef = useRef<HTMLDivElement | null>(null);
  const numericFilterPanelRef = useRef<HTMLDivElement | null>(null);
  const numericFilterPopoverRafRef = useRef<number | null>(null);

  const showHeaderTooltip = (key: string, text: string, anchorEl: HTMLTableCellElement) => {
    setActiveHeaderTooltip(buildRequestEventHeaderTooltipState(key, text, anchorEl));
  };

  const hideHeaderTooltip = (key: string) => {
    setActiveHeaderTooltip((current) => (current?.key === key ? null : current));
  };

  const getHeaderTooltipProps = (
    key: string,
    text: string
  ): ThHTMLAttributes<HTMLTableCellElement> => ({
    tabIndex: 0,
    'aria-label': text,
    'aria-describedby': activeHeaderTooltip?.key === key ? headerTooltipId : undefined,
    onMouseEnter: (event) => showHeaderTooltip(key, text, event.currentTarget),
    onMouseLeave: (event) => {
      if (document.activeElement !== event.currentTarget) hideHeaderTooltip(key);
    },
    onFocus: (event) => showHeaderTooltip(key, text, event.currentTarget),
    onBlur: () => hideHeaderTooltip(key),
  });

  useEffect(() => {
    if (!activeHeaderTooltip) return;

    const updatePosition = () => {
      setActiveHeaderTooltip((current) => {
        if (!current || !document.body.contains(current.anchorEl)) return null;
        return buildRequestEventHeaderTooltipState(current.key, current.text, current.anchorEl);
      });
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [activeHeaderTooltip]);

  useEffect(() => {
    try {
      const currentValue = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      let shouldPersistCurrent = currentValue === null;
      if (currentValue !== null) {
        try {
          const parsedCurrent = JSON.parse(currentValue) as unknown;
          shouldPersistCurrent = needsColumnVisibilityNormalization(
            parsedCurrent,
            columnVisibility
          );
        } catch {
          shouldPersistCurrent = true;
        }
      }
      const shouldNormalizeState = needsColumnVisibilityNormalization(
        storedColumnVisibility,
        columnVisibility
      );
      if (shouldPersistCurrent || shouldNormalizeState) {
        const canonicalValue = JSON.stringify(columnVisibility);
        window.localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, canonicalValue);
        if (window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY) !== canonicalValue) {
          return;
        }
        setStoredColumnVisibility(columnVisibility);
      }

      // v1/v2 were development-era defaults. v3 starts from the formal
      // caller-key-visible, Source/Auth-hidden, and eight-Token-visible default set.
      LEGACY_COLUMN_VISIBILITY_STORAGE_KEYS.forEach((key) => {
        window.localStorage.removeItem(key);
      });
    } catch {
      // Preserve legacy keys when the canonical v3 value cannot be written and verified.
    }
  }, [columnVisibility, setStoredColumnVisibility, storedColumnVisibility]);

  useEffect(() => {
    if (!columnSettingsOpen) return;

    columnSettingsPanelRef.current
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')
      ?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!columnSettingsRef.current?.contains(event.target as Node)) {
        setColumnSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setColumnSettingsOpen(false);
      columnSettingsRef.current
        ?.querySelector<HTMLButtonElement>('[data-column-settings-trigger]')
        ?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [columnSettingsOpen]);

  useEffect(() => {
    if (!numericFilterOpen || numericFilterPresentation !== 'popover') return;

    numericFilterPanelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const updatePopoverPosition = () => {
      const trigger = numericFilterRef.current?.querySelector<HTMLElement>(
        '[data-numeric-filter-trigger]'
      );
      if (!trigger) return;
      const nextStyle = resolveNumericFilterPopoverStyle(trigger);
      setNumericFilterPopoverStyle((currentStyle) =>
        numericFilterPopoverStylesEqual(currentStyle, nextStyle) ? currentStyle : nextStyle
      );
    };
    const schedulePopoverPositionUpdate = () => {
      if (numericFilterPopoverRafRef.current !== null) return;
      numericFilterPopoverRafRef.current = window.requestAnimationFrame(() => {
        numericFilterPopoverRafRef.current = null;
        updatePopoverPosition();
      });
    };
    updatePopoverPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const metricListbox = document.getElementById(`${numericMetricSelectId}-listbox`);
      if (numericFilterRef.current?.contains(target) || metricListbox?.contains(target)) return;
      setNumericFilterOpen(false);
      setNumericFilterPresentation(null);
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      const metricListbox = document.getElementById(`${numericMetricSelectId}-listbox`);
      if (
        target instanceof Node &&
        (numericFilterPanelRef.current?.contains(target) || metricListbox?.contains(target))
      ) {
        return;
      }
      schedulePopoverPositionUpdate();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setNumericFilterOpen(false);
      setNumericFilterPresentation(null);
      numericFilterRef.current
        ?.querySelector<HTMLButtonElement>('[data-numeric-filter-trigger]')
        ?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', schedulePopoverPositionUpdate);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', schedulePopoverPositionUpdate);
      window.removeEventListener('scroll', handleScroll, true);
      if (numericFilterPopoverRafRef.current !== null) {
        window.cancelAnimationFrame(numericFilterPopoverRafRef.current);
        numericFilterPopoverRafRef.current = null;
      }
    };
  }, [numericFilterOpen, numericFilterPresentation, numericMetricSelectId]);

  useEffect(() => {
    if (!numericFilterOpen || numericFilterPresentation === null) return;
    const expectedPresentation = useNumericFilterSheet ? 'sheet' : 'popover';
    if (numericFilterPresentation === expectedPresentation) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setNumericFilterOpen(false);
      setNumericFilterPresentation(null);
      numericFilterRef.current
        ?.querySelector<HTMLButtonElement>('[data-numeric-filter-trigger]')
        ?.focus();
    });
    return () => {
      cancelled = true;
    };
  }, [numericFilterOpen, numericFilterPresentation, useNumericFilterSheet]);

  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString(),
          });
        });
        setAuthFileMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const rows = useMemo<RequestEventRow[]>(() => {
    const details = collectUsageDetails(usage);
    const configuredKeyIndexes = new Map<string, number>();
    requestApiKeys.forEach((key, index) => {
      const trimmed = String(key || '').trim();
      if (trimmed && !configuredKeyIndexes.has(trimmed)) {
        configuredKeyIndexes.set(trimmed, index + 1);
      }
    });
    const requestIdentityTokens = new Map<string, string>();

    const resolveRequestIdentity = (value: unknown) => {
      const apiBucket = String(value ?? '').trim();
      const identityKey = apiBucket || '__unknown__';
      let requestIdentityToken = requestIdentityTokens.get(identityKey);
      if (!requestIdentityToken) {
        requestIdentityToken = `request-identity-${requestIdentityTokens.size}`;
        requestIdentityTokens.set(identityKey, requestIdentityToken);
      }

      const configuredIndex = configuredKeyIndexes.get(apiBucket);
      if (configuredIndex !== undefined) {
        const requestKeyHint = maskRequestKey(apiBucket);
        return {
          requestIdentityToken,
          requestIdentityType: 'configured-key' as const,
          requestIdentityLabel: t('usage_stats.request_events_request_key_configured', {
            index: configuredIndex,
            key: requestKeyHint,
          }),
          requestKeyHint,
          requestKeyConfigIndex: configuredIndex,
        };
      }

      if (REQUEST_IDENTITY_ENDPOINT_REGEX.test(apiBucket)) {
        return {
          requestIdentityToken,
          requestIdentityType: 'endpoint' as const,
          requestIdentityLabel: t('usage_stats.request_events_request_identity_endpoint', {
            value: apiBucket,
          }),
          requestKeyHint: apiBucket,
          requestKeyConfigIndex: null,
        };
      }

      if (!apiBucket || apiBucket.toLowerCase() === 'unknown') {
        return {
          requestIdentityToken,
          requestIdentityType: 'unknown' as const,
          requestIdentityLabel: t('usage_stats.request_events_request_identity_unknown'),
          requestKeyHint: '',
          requestKeyConfigIndex: null,
        };
      }

      const requestKeyHint = maskRequestKey(apiBucket);
      return {
        requestIdentityToken,
        requestIdentityType: 'caller' as const,
        requestIdentityLabel: t('usage_stats.request_events_request_identity_caller', {
          value: requestKeyHint,
        }),
        requestKeyHint,
        requestKeyConfigIndex: null,
      };
    };

    const baseRows = details.map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${sourceRaw || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const requestIdentity = resolveRequestIdentity(detail.__apiBucket);
      const serviceTier = detail.service_tier ?? null;
      const requestServiceTier = detail.request_service_tier ?? null;
      const outboundServiceTier = detail.outbound_service_tier ?? null;
      const responseServiceTier = detail.response_service_tier ?? null;
      const effectiveServiceTier = detail.effective_service_tier ?? null;
      const resolvedServiceTier = resolveServiceTier({
        serviceTier,
        requestServiceTier,
        outboundServiceTier,
        responseServiceTier,
        effectiveServiceTier,
      });
      const serviceTierFilterValue =
        resolvedServiceTier.tier === 'fast' ? SERVICE_TIER_FAST_FILTER : SERVICE_TIER_STD_FILTER;
      const getServiceTierLabel = (tier: DisplayServiceTier) =>
        tier === 'fast'
          ? t('usage_stats.request_events_tier_fast')
          : t('usage_stats.request_events_tier_standard');
      const serviceTierLabel = getServiceTierLabel(resolvedServiceTier.tier);
      const requestDisplayServiceTier = classifyServiceTier(resolvedServiceTier.rawRequest);
      const requestServiceTierLabel = requestDisplayServiceTier
        ? getServiceTierLabel(requestDisplayServiceTier)
        : null;
      const describeServiceTierValue = (raw: string | null) => {
        if (!raw) return t('usage_stats.request_events_tier_value_missing');
        const tier = classifyServiceTier(raw);
        if (!tier) {
          return t('usage_stats.request_events_tier_value_unknown', { raw });
        }
        return t('usage_stats.request_events_tier_value_known', {
          tier: getServiceTierLabel(tier),
          raw,
        });
      };
      const evidenceLabel = t(
        `usage_stats.request_events_tier_evidence_${resolvedServiceTier.evidence}`
      );
      const serviceTierTitle = [
        t('usage_stats.request_events_tier_chain_client', {
          value: describeServiceTierValue(resolvedServiceTier.rawRequest),
        }),
        t('usage_stats.request_events_tier_chain_outbound', {
          value: describeServiceTierValue(resolvedServiceTier.rawOutbound),
        }),
        t('usage_stats.request_events_tier_chain_response', {
          value: describeServiceTierValue(resolvedServiceTier.rawResponse),
        }),
        t('usage_stats.request_events_tier_chain_effective', {
          value: describeServiceTierValue(resolvedServiceTier.rawEffective),
        }),
        t('usage_stats.request_events_tier_chain_resolved', {
          tier: serviceTierLabel,
          evidence: evidenceLabel,
        }),
      ].join('\n');
      const reasoningEffort = normalizeReasoningEffort(detail.reasoning_effort);
      const reasoningEffortFilterValue = getReasoningEffortFilterValue(reasoningEffort);
      const reasoningEffortLabel =
        reasoningEffort ?? t('usage_stats.request_events_effort_legacy_unknown');
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(detail.tokens);
      const nonCacheReadInputTokens = getUsageNonCacheReadInputTokenCount(detail.tokens);
      const displayedOutputTokens = Math.max(outputTokens - reasoningTokens, 0);
      const cacheRate = resolveCacheRate(inputTokens, cacheReadTokens);
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );
      const latencyMs = extractLatencyMs(detail);
      const ttfbMs = extractTTFBMs(detail);
      const timingVersion = extractTimingVersion(detail);
      const ttftMs = normalizeSemanticTimingMs(extractTTFTMs(detail), latencyMs, ttfbMs);
      const ttfaMs = normalizeSemanticTimingMs(extractTTFAMs(detail), latencyMs, ttfbMs);
      const firstContentMs = calculateFirstContentMs(ttftMs, ttfaMs);
      const decodeDurationMs = calculateDecodeDurationMs(latencyMs, ttfbMs);
      const outputTps = calculateOutputTps(outputTokens, latencyMs, ttfbMs);
      const averageTps = calculateAverageTps(outputTokens, latencyMs);
      const visibleAverageTps = calculateVisibleAverageTps(
        outputTokens,
        reasoningTokens,
        latencyMs
      );
      const reasoningRatio = calculateReasoningRatio(outputTokens, reasoningTokens);
      const costEstimate = calculateCostEstimate(detail, priceProfile);
      const longContext = costEstimate.contextBand === 'long';
      const costAmount = costEstimate.status === 'priced' ? costEstimate.amount : null;

      return {
        id: `${timestamp}-${model}-${requestIdentity.requestIdentityToken}-${sourceKey}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        model,
        ...requestIdentity,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        serviceTier,
        requestServiceTier,
        outboundServiceTier,
        responseServiceTier,
        effectiveServiceTier,
        resolvedServiceTier,
        requestDisplayServiceTier,
        serviceTierFilterValue,
        requestServiceTierLabel,
        serviceTierLabel,
        serviceTierTitle,
        reasoningEffort,
        reasoningEffortFilterValue,
        reasoningEffortLabel,
        failed: detail.failed === true,
        latencyMs,
        ttfbMs,
        timingVersion,
        firstContentMs,
        ttftMs,
        ttfaMs,
        decodeDurationMs,
        outputTps,
        averageTps,
        visibleAverageTps,
        reasoningRatio,
        inputTokens,
        nonCacheReadInputTokens,
        outputTokens,
        displayedOutputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheRate,
        cacheRateTone: getCacheRateTone(cacheRate, inputTokens, cacheReadTokens),
        longContext,
        totalTokens,
        costAmount,
        costStatus: costEstimate.status,
        costTone: getRequestEventCostTone(costAmount, costEstimate.status, totalTokens),
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    baseRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const buildDisambiguatedSourceLabel = (row: RequestEventRow) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row.source;
      }

      if (row.authIndex !== '-') {
        return `${row.source} · ${row.authIndex}`;
      }

      if (row.sourceRaw !== '-' && row.sourceRaw !== row.source) {
        return `${row.source} · ${row.sourceRaw}`;
      }

      if (row.sourceType) {
        return `${row.source} · ${row.sourceType}`;
      }

      return `${row.source} · ${row.sourceKey}`;
    };

    return baseRows
      .map((row) => ({
        ...row,
        source: buildDisambiguatedSourceLabel(row),
      }))
      .sort((a, b) => b.timestampMs - a.timestampMs);
  }, [authFileMap, i18n.language, priceProfile, requestApiKeys, sourceInfoMap, t, usage]);

  const effectiveTimeRangeFilter = isRequestEventTimeRange(timeRangeFilter)
    ? timeRangeFilter
    : 'page';
  const shouldTrackTime = effectiveTimeRangeFilter !== 'page' && effectiveTimeRangeFilter !== 'all';
  const effectiveNowMs = shouldTrackTime
    ? Math.max(referenceNowMs, timeRangeClockMs)
    : referenceNowMs;
  const pageTimeRangeDurationMs =
    pageTimeRange === 'all' ? null : PAGE_TIME_RANGE_MS[pageTimeRange];

  const timeScopedRows = useMemo(() => {
    if (effectiveTimeRangeFilter === 'all') return rows;
    if (effectiveNowMs <= 0) return rows;

    const durationMs =
      effectiveTimeRangeFilter === 'page'
        ? pageTimeRangeDurationMs
        : REQUEST_EVENT_TIME_RANGE_MS[effectiveTimeRangeFilter];
    if (durationMs === null) return rows;

    const cutoffMs = effectiveNowMs - durationMs;
    return rows.filter(
      (row) =>
        row.timestampMs > 0 && row.timestampMs >= cutoffMs && row.timestampMs <= effectiveNowMs
    );
  }, [effectiveNowMs, effectiveTimeRangeFilter, pageTimeRangeDurationMs, rows]);

  const hasLatencyData = useMemo(
    () => timeScopedRows.some((row) => row.latencyMs !== null),
    [timeScopedRows]
  );
  const hasTTFBData = useMemo(
    () => timeScopedRows.some((row) => row.ttfbMs !== null),
    [timeScopedRows]
  );
  const hasOutputTpsData = useMemo(
    () => timeScopedRows.some((row) => row.outputTps !== null),
    [timeScopedRows]
  );
  const hasAverageTpsData = useMemo(
    () => timeScopedRows.some((row) => row.averageTps !== null),
    [timeScopedRows]
  );

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(timeScopedRows.map((row) => row.model))).map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [t, timeScopedRows]
  );

  const requestKeyOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    timeScopedRows.forEach((row) => {
      if (!optionMap.has(row.requestIdentityToken)) {
        optionMap.set(row.requestIdentityToken, row.requestIdentityLabel);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [t, timeScopedRows]);

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    timeScopedRows.forEach((row) => {
      if (!optionMap.has(row.sourceKey)) {
        optionMap.set(row.sourceKey, row.source);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [t, timeScopedRows]);

  const authIndexOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(timeScopedRows.map((row) => row.authIndex))).map((authIndex) => ({
        value: authIndex,
        label: authIndex,
      })),
    ],
    [t, timeScopedRows]
  );

  const serviceTierOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      { value: SERVICE_TIER_FAST_FILTER, label: t('usage_stats.request_events_tier_fast') },
      { value: SERVICE_TIER_STD_FILTER, label: t('usage_stats.request_events_tier_standard') },
    ],
    [t]
  );

  const reasoningEffortOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    timeScopedRows.forEach((row) => {
      if (!optionMap.has(row.reasoningEffortFilterValue)) {
        optionMap.set(row.reasoningEffortFilterValue, row.reasoningEffortLabel);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries())
        .sort(([, left], [, right]) => left.localeCompare(right, i18n.language))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [i18n.language, t, timeScopedRows]);

  const resultOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      { value: RESULT_SUCCESS_FILTER, label: t('stats.success') },
      { value: RESULT_FAILED_FILTER, label: t('stats.failure') },
    ],
    [t]
  );

  const timeRangeOptions = useMemo(() => {
    const pageRangeLabel = t(PAGE_TIME_RANGE_LABEL_KEYS[pageTimeRange]);

    return [
      {
        value: 'page',
        label: t('usage_stats.request_events_range_page', { range: pageRangeLabel }),
      },
      { value: 'all', label: t('usage_stats.range_all') },
      ...(['1h', '24h', '7d', '30d'] as const).map((range) => ({
        value: range,
        label: t(`usage_stats.range_${range}`),
      })),
    ];
  }, [pageTimeRange, t]);

  const cacheOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      { value: CACHE_PRESENT_FILTER, label: t('usage_stats.request_events_cache_present') },
      { value: CACHE_ABSENT_FILTER, label: t('usage_stats.request_events_cache_absent') },
    ],
    [t]
  );

  const numericMetricOptions = useMemo(
    () => [
      {
        value: 'totalInputTokens',
        label: t('usage_stats.request_events_total_input_tokens'),
      },
      {
        value: 'nonCacheReadInputTokens',
        label: t('usage_stats.request_events_non_cache_read_input_tokens'),
      },
      {
        value: 'totalOutputTokens',
        label: t('usage_stats.request_events_total_output_tokens'),
      },
      {
        value: 'displayedOutputTokens',
        label: t('usage_stats.request_events_explicit_output_tokens'),
      },
      { value: 'reasoningTokens', label: t('usage_stats.reasoning_tokens') },
      { value: 'cacheReadTokens', label: t('usage_stats.cache_read_tokens') },
      { value: 'cacheWriteTokens', label: t('usage_stats.cache_write_tokens') },
      { value: 'totalTokens', label: t('usage_stats.total_tokens') },
    ],
    [t]
  );

  const columnOptions = useMemo(
    () => [
      {
        id: 'timestamp' as const,
        label: t('usage_stats.request_events_timestamp'),
      },
      { id: 'model' as const, label: t('usage_stats.model_name') },
      { id: 'requestKey' as const, label: t('usage_stats.request_events_request_key') },
      { id: 'source' as const, label: t('usage_stats.request_events_source') },
      { id: 'authIndex' as const, label: t('usage_stats.request_events_auth_index') },
      { id: 'tier' as const, label: t('usage_stats.request_events_tier') },
      { id: 'result' as const, label: t('usage_stats.request_events_result') },
      { id: 'latency' as const, label: t('usage_stats.time') },
      { id: 'ttfb' as const, label: t('usage_stats.request_events_ttfb') },
      {
        id: 'firstContent' as const,
        label: t('usage_stats.request_events_first_content'),
      },
      { id: 'ttft' as const, label: t('usage_stats.request_events_ttft') },
      { id: 'ttfa' as const, label: t('usage_stats.request_events_ttfa') },
      { id: 'outputTps' as const, label: t('usage_stats.request_events_output_tps') },
      { id: 'averageTps' as const, label: t('usage_stats.request_events_average_tps') },
      {
        id: 'visibleAverageTps' as const,
        label: t('usage_stats.request_events_visible_average_tps'),
      },
      {
        id: 'reasoningRatio' as const,
        label: t('usage_stats.request_events_reasoning_ratio'),
      },
      { id: 'effort' as const, label: t('usage_stats.request_events_effort') },
      {
        id: 'totalInputTokens' as const,
        label: t('usage_stats.request_events_total_input_tokens'),
      },
      {
        id: 'nonCacheReadInputTokens' as const,
        label: t('usage_stats.request_events_non_cache_read_input_tokens'),
      },
      {
        id: 'totalOutputTokens' as const,
        label: t('usage_stats.request_events_total_output_tokens'),
      },
      {
        id: 'displayedOutputTokens' as const,
        label: t('usage_stats.request_events_explicit_output_tokens'),
      },
      { id: 'reasoningTokens' as const, label: t('usage_stats.reasoning_tokens') },
      { id: 'cacheReadTokens' as const, label: t('usage_stats.cache_read_tokens') },
      { id: 'cacheWriteTokens' as const, label: t('usage_stats.cache_write_tokens') },
      { id: 'totalTokens' as const, label: t('usage_stats.total_tokens') },
      { id: 'cost' as const, label: t('usage_stats.request_events_cost_estimate') },
    ],
    [t]
  );

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
  );
  const requestKeyOptionSet = useMemo(
    () => new Set(requestKeyOptions.map((option) => option.value)),
    [requestKeyOptions]
  );
  const sourceOptionSet = useMemo(
    () => new Set(sourceOptions.map((option) => option.value)),
    [sourceOptions]
  );
  const authIndexOptionSet = useMemo(
    () => new Set(authIndexOptions.map((option) => option.value)),
    [authIndexOptions]
  );
  const serviceTierOptionSet = useMemo(
    () => new Set(serviceTierOptions.map((option) => option.value)),
    [serviceTierOptions]
  );
  const reasoningEffortOptionSet = useMemo(
    () => new Set(reasoningEffortOptions.map((option) => option.value)),
    [reasoningEffortOptions]
  );
  const numericMetricOptionSet = useMemo(
    () => new Set(numericMetricOptions.map((option) => option.value)),
    [numericMetricOptions]
  );

  const effectiveModelFilter = modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER;
  const effectiveRequestKeyFilter = requestKeyOptionSet.has(requestKeyFilter)
    ? requestKeyFilter
    : ALL_FILTER;
  const effectiveSourceFilter = sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER;
  const effectiveAuthIndexFilter = authIndexOptionSet.has(authIndexFilter)
    ? authIndexFilter
    : ALL_FILTER;
  const effectiveServiceTierFilter = serviceTierOptionSet.has(serviceTierFilter)
    ? serviceTierFilter
    : ALL_FILTER;
  const effectiveReasoningEffortFilter = reasoningEffortOptionSet.has(reasoningEffortFilter)
    ? reasoningEffortFilter
    : ALL_FILTER;
  const effectiveNumericMetricFilter = numericMetricOptionSet.has(numericMetricFilter)
    ? numericMetricFilter
    : ALL_FILTER;
  const numericMinimumValue = parseNumericFilterBound(numericMinimumFilter);
  const numericMaximumValue = parseNumericFilterBound(numericMaximumFilter);
  const hasAppliedNumericFilter =
    isRequestEventNumericMetricId(effectiveNumericMetricFilter) &&
    (numericMinimumValue !== null || numericMaximumValue !== null);
  const draftNumericMinimumValue = parseNumericFilterBound(draftNumericMinimumFilter);
  const draftNumericMaximumValue = parseNumericFilterBound(draftNumericMaximumFilter);
  const draftNumericMinimumInvalid =
    draftNumericMinimumFilter.trim() !== '' && draftNumericMinimumValue === null;
  const draftNumericMaximumInvalid =
    draftNumericMaximumFilter.trim() !== '' && draftNumericMaximumValue === null;
  const draftNumericRangeInvalid =
    draftNumericMinimumValue !== null &&
    draftNumericMaximumValue !== null &&
    draftNumericMinimumValue > draftNumericMaximumValue;
  const draftNumericFilterInvalid =
    draftNumericMinimumInvalid || draftNumericMaximumInvalid || draftNumericRangeInvalid;
  const draftNumericFilterHasBounds =
    draftNumericMinimumValue !== null || draftNumericMaximumValue !== null;
  const draftNumericFilterError =
    draftNumericMinimumInvalid || draftNumericMaximumInvalid
      ? t('usage_stats.request_events_numeric_invalid')
      : draftNumericRangeInvalid
        ? t('usage_stats.request_events_numeric_range_invalid')
        : '';
  const formatNumericRange = (minimum: number | null, maximum: number | null): string => {
    if (minimum !== null && maximum !== null) {
      return `${numericBoundFormatter.format(minimum)}–${numericBoundFormatter.format(maximum)}`;
    }
    if (minimum !== null) return `≥ ${numericBoundFormatter.format(minimum)}`;
    if (maximum !== null) return `≤ ${numericBoundFormatter.format(maximum)}`;
    return '';
  };
  const getNumericMetricLabel = (metric: string): string =>
    numericMetricOptions.find((option) => option.value === metric)?.label ??
    t('usage_stats.request_events_numeric_filter');
  const numericAppliedSummary = hasAppliedNumericFilter
    ? `${getNumericMetricLabel(effectiveNumericMetricFilter)} · ${formatNumericRange(
        numericMinimumValue,
        numericMaximumValue
      )}`
    : '';
  const numericDraftSummary =
    !draftNumericFilterInvalid && draftNumericFilterHasBounds
      ? `${getNumericMetricLabel(draftNumericMetricFilter)} · ${formatNumericRange(
          draftNumericMinimumValue,
          draftNumericMaximumValue
        )}`
      : '';

  useEffect(() => {
    if (!shouldTrackTime) return;

    const updateClock = () => setTimeRangeClockMs(Date.now());
    updateClock();
    const intervalId = window.setInterval(updateClock, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [effectiveTimeRangeFilter, shouldTrackTime]);

  const filteredRows = useMemo(
    () =>
      timeScopedRows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER || row.model === effectiveModelFilter;
        const requestKeyMatched =
          effectiveRequestKeyFilter === ALL_FILTER ||
          row.requestIdentityToken === effectiveRequestKeyFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.sourceKey === effectiveSourceFilter;
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_FILTER || row.authIndex === effectiveAuthIndexFilter;
        const serviceTierMatched =
          effectiveServiceTierFilter === ALL_FILTER ||
          row.serviceTierFilterValue === effectiveServiceTierFilter;
        const reasoningEffortMatched =
          effectiveReasoningEffortFilter === ALL_FILTER ||
          row.reasoningEffortFilterValue === effectiveReasoningEffortFilter;
        const resultMatched =
          resultFilter === ALL_FILTER ||
          (resultFilter === RESULT_FAILED_FILTER ? row.failed : !row.failed);
        const hasCacheTokens = row.cacheReadTokens > 0 || row.cacheWriteTokens > 0;
        const cacheMatched =
          cacheFilter === ALL_FILTER ||
          (cacheFilter === CACHE_PRESENT_FILTER ? hasCacheTokens : !hasCacheTokens);
        const numericMetric = isRequestEventNumericMetricId(effectiveNumericMetricFilter)
          ? effectiveNumericMetricFilter
          : null;
        const numericValue = numericMetric ? getRequestEventNumericValue(row, numericMetric) : null;
        const numericMatched =
          numericMetric === null ||
          ((numericMinimumValue === null || numericValue! >= numericMinimumValue) &&
            (numericMaximumValue === null || numericValue! <= numericMaximumValue));
        return (
          modelMatched &&
          requestKeyMatched &&
          sourceMatched &&
          authIndexMatched &&
          serviceTierMatched &&
          reasoningEffortMatched &&
          resultMatched &&
          cacheMatched &&
          numericMatched
        );
      }),
    [
      cacheFilter,
      effectiveAuthIndexFilter,
      effectiveModelFilter,
      effectiveRequestKeyFilter,
      effectiveReasoningEffortFilter,
      effectiveServiceTierFilter,
      effectiveSourceFilter,
      effectiveNumericMetricFilter,
      numericMaximumValue,
      numericMinimumValue,
      resultFilter,
      timeScopedRows,
    ]
  );

  const renderedRows = useMemo(() => filteredRows.slice(0, MAX_RENDERED_EVENTS), [filteredRows]);

  const performanceSummary = useMemo(
    () =>
      summarizeUsagePerformance(
        filteredRows.map((row) => ({
          outputTokens: row.outputTokens,
          reasoningTokens: row.reasoningTokens,
          latencyMs: row.latencyMs,
          ttfbMs: row.ttfbMs,
        }))
      ),
    [filteredRows]
  );

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
    effectiveRequestKeyFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveAuthIndexFilter !== ALL_FILTER ||
    effectiveServiceTierFilter !== ALL_FILTER ||
    effectiveReasoningEffortFilter !== ALL_FILTER ||
    resultFilter !== ALL_FILTER ||
    effectiveTimeRangeFilter !== 'page' ||
    cacheFilter !== ALL_FILTER ||
    hasAppliedNumericFilter;

  const openNumericFilter = () => {
    setDraftNumericMetricFilter(
      isRequestEventNumericMetricId(effectiveNumericMetricFilter)
        ? effectiveNumericMetricFilter
        : 'totalTokens'
    );
    setDraftNumericMinimumFilter(numericMinimumFilter);
    setDraftNumericMaximumFilter(numericMaximumFilter);
    const nextPresentation = useNumericFilterSheet ? 'sheet' : 'popover';
    setNumericFilterPresentation(nextPresentation);
    if (nextPresentation === 'popover') {
      const trigger = numericFilterRef.current?.querySelector<HTMLElement>(
        '[data-numeric-filter-trigger]'
      );
      if (trigger) setNumericFilterPopoverStyle(resolveNumericFilterPopoverStyle(trigger));
    }
    setNumericFilterOpen(true);
  };

  const closeNumericFilter = () => {
    const shouldRestoreFocusImmediately = numericFilterPresentation !== 'sheet';
    setNumericFilterOpen(false);
    setNumericFilterPresentation(null);
    if (shouldRestoreFocusImmediately) {
      numericFilterRef.current
        ?.querySelector<HTMLButtonElement>('[data-numeric-filter-trigger]')
        ?.focus();
    }
  };

  const handleApplyNumericFilter = () => {
    if (draftNumericFilterInvalid || !draftNumericFilterHasBounds) return;
    setNumericMetricFilter(draftNumericMetricFilter);
    setNumericMinimumFilter(draftNumericMinimumFilter.trim());
    setNumericMaximumFilter(draftNumericMaximumFilter.trim());
    closeNumericFilter();
  };

  const handleClearNumericFilter = () => {
    setNumericMetricFilter(ALL_FILTER);
    setNumericMinimumFilter('');
    setNumericMaximumFilter('');
    setDraftNumericMetricFilter('totalTokens');
    setDraftNumericMinimumFilter('');
    setDraftNumericMaximumFilter('');
    closeNumericFilter();
  };

  const handleClearFilters = () => {
    setModelFilter(ALL_FILTER);
    setRequestKeyFilter(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setAuthIndexFilter(ALL_FILTER);
    setServiceTierFilter(ALL_FILTER);
    setReasoningEffortFilter(ALL_FILTER);
    setResultFilter(ALL_FILTER);
    setTimeRangeFilter('page');
    setCacheFilter(ALL_FILTER);
    setNumericMetricFilter(ALL_FILTER);
    setNumericMinimumFilter('');
    setNumericMaximumFilter('');
    setDraftNumericMetricFilter('totalTokens');
    setDraftNumericMinimumFilter('');
    setDraftNumericMaximumFilter('');
    setNumericFilterOpen(false);
    setNumericFilterPresentation(null);
  };

  const stableVisibleColumnCount = REQUEST_EVENT_COLUMN_IDS.reduce(
    (count, columnId) => count + (columnId !== 'latency' && columnVisibility[columnId] ? 1 : 0),
    0
  );

  const handleToggleColumn = (columnId: RequestEventColumnId) => {
    setStoredColumnVisibility({
      ...columnVisibility,
      [columnId]: !columnVisibility[columnId],
    });
  };

  const handleRestoreDefaultColumns = () => {
    setStoredColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'model',
      'request_identity_type',
      'request_key_hint',
      'request_key_config_index',
      'source',
      'source_raw',
      'auth_index',
      'service_tier',
      'request_service_tier',
      'outbound_service_tier',
      'response_service_tier',
      'effective_service_tier',
      'resolved_service_tier',
      'service_tier_evidence',
        'reasoning_effort',
        'result',
        ...(hasLatencyData ? ['latency_ms'] : []),
        ...(hasTTFBData ? ['ttfb_ms'] : []),
        'first_content_ms',
        'timing_version',
        'ttft_ms',
        'ttfa_ms',
        ...(hasOutputTpsData ? ['decode_duration_ms', 'output_tps'] : []),
        ...(hasAverageTpsData ? ['average_tps'] : []),
        'visible_average_tps',
        'reasoning_ratio',
        'input_tokens',
      'non_cache_read_input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'cache_read_tokens',
      'cache_creation_tokens',
      'total_tokens',
      'estimated_cost_usd',
      'pricing_status',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.requestIdentityType,
        row.requestKeyHint,
        row.requestKeyConfigIndex ?? '',
        row.source,
        row.sourceRaw,
        row.authIndex,
        row.serviceTier ?? '',
        row.requestServiceTier ?? '',
        row.outboundServiceTier ?? '',
        row.responseServiceTier ?? '',
        row.effectiveServiceTier ?? '',
        row.resolvedServiceTier.tier,
        row.resolvedServiceTier.evidence,
        row.reasoningEffort ?? '',
        row.failed ? 'failed' : 'success',
        ...(hasLatencyData ? [row.latencyMs ?? ''] : []),
        ...(hasTTFBData ? [row.ttfbMs ?? ''] : []),
        row.firstContentMs ?? '',
        row.timingVersion ?? '',
        row.ttftMs ?? '',
        row.ttfaMs ?? '',
        ...(hasOutputTpsData ? [row.decodeDurationMs ?? '', row.outputTps ?? ''] : []),
        ...(hasAverageTpsData ? [row.averageTps ?? ''] : []),
        row.visibleAverageTps ?? '',
        row.reasoningRatio ?? '',
        row.inputTokens,
        row.nonCacheReadInputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cacheReadTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
        row.totalTokens,
        row.costAmount ?? '',
        row.costStatus,
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      request_identity_type: row.requestIdentityType,
      request_key_hint: row.requestKeyHint,
      request_key_config_index: row.requestKeyConfigIndex,
      source: row.source,
      source_raw: row.sourceRaw,
      auth_index: row.authIndex,
      service_tier: row.serviceTier,
      request_service_tier: row.requestServiceTier,
      outbound_service_tier: row.outboundServiceTier,
      response_service_tier: row.responseServiceTier,
      effective_service_tier: row.effectiveServiceTier,
      resolved_service_tier: row.resolvedServiceTier.tier,
      service_tier_evidence: row.resolvedServiceTier.evidence,
      reasoning_effort: row.reasoningEffort,
      failed: row.failed,
      ...(hasLatencyData && row.latencyMs !== null ? { latency_ms: row.latencyMs } : {}),
      ...(hasTTFBData && row.ttfbMs !== null ? { ttfb_ms: row.ttfbMs } : {}),
      first_content_ms: row.firstContentMs,
      timing_version: row.timingVersion,
      ttft_ms: row.ttftMs,
      ttfa_ms: row.ttfaMs,
      ...(hasOutputTpsData && row.outputTps !== null
        ? { decode_duration_ms: row.decodeDurationMs, output_tps: row.outputTps }
        : {}),
      ...(hasAverageTpsData && row.averageTps !== null ? { average_tps: row.averageTps } : {}),
      visible_average_tps: row.visibleAverageTps,
      reasoning_ratio: row.reasoningRatio,
      tokens: {
        input_tokens: row.inputTokens,
        non_cache_read_input_tokens: row.nonCacheReadInputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cacheReadTokens,
        cache_read_tokens: row.cacheReadTokens,
        cache_creation_tokens: row.cacheWriteTokens,
        total_tokens: row.totalTokens,
      },
      estimated_cost_usd: row.costAmount,
      pricing_status: row.costStatus,
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
    });
  };

  const numericFilterEditor = (
    <>
      <div className={styles.requestEventsNumericFilterFields}>
        <div className={styles.requestEventsNumericMetricField}>
          <span
            id={`${numericFilterId}-metric-label`}
            className={styles.requestEventsNumericFieldLabel}
          >
            {t('usage_stats.request_events_numeric_metric')}
          </span>
          <Select
            id={numericMetricSelectId}
            value={draftNumericMetricFilter}
            options={numericMetricOptions}
            onChange={(value) => {
              if (isRequestEventNumericMetricId(value)) {
                setDraftNumericMetricFilter(value);
                window.requestAnimationFrame(() => {
                  document.getElementById(numericMetricSelectId)?.focus();
                });
              }
            }}
            className={styles.requestEventsNumericMetric}
            ariaLabelledBy={`${numericFilterId}-metric-label`}
            fullWidth
          />
        </div>
        <div className={styles.requestEventsNumericBounds}>
          <Input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draftNumericMinimumFilter}
            onChange={(event) => setDraftNumericMinimumFilter(event.target.value)}
            label={t('usage_stats.request_events_numeric_min')}
            placeholder="0"
            aria-describedby={draftNumericFilterError ? numericFilterErrorId : undefined}
            aria-invalid={draftNumericMinimumInvalid || draftNumericRangeInvalid}
            className={styles.requestEventsNumericInput}
          />
          <Input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draftNumericMaximumFilter}
            onChange={(event) => setDraftNumericMaximumFilter(event.target.value)}
            label={t('usage_stats.request_events_numeric_max')}
            placeholder="∞"
            aria-describedby={draftNumericFilterError ? numericFilterErrorId : undefined}
            aria-invalid={draftNumericMaximumInvalid || draftNumericRangeInvalid}
            className={styles.requestEventsNumericInput}
          />
        </div>
      </div>
      {numericDraftSummary && (
        <div className={styles.requestEventsNumericPreview} aria-live="polite" data-valid="true">
          <span>{t('usage_stats.request_events_numeric_preview')}</span>
          <strong>{numericDraftSummary}</strong>
        </div>
      )}
      {draftNumericFilterError && (
        <span id={numericFilterErrorId} className={styles.requestEventsNumericError} role="alert">
          {draftNumericFilterError}
        </span>
      )}
    </>
  );

  const numericFilterActions = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleClearNumericFilter}
        disabled={
          !hasAppliedNumericFilter &&
          !draftNumericMinimumFilter.trim() &&
          !draftNumericMaximumFilter.trim() &&
          draftNumericMetricFilter === 'totalTokens'
        }
      >
        {t('usage_stats.request_events_numeric_clear')}
      </Button>
      <div className={styles.requestEventsNumericFilterFooterActions}>
        <Button type="button" variant="secondary" size="sm" onClick={closeNumericFilter}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleApplyNumericFilter}
          disabled={draftNumericFilterInvalid || !draftNumericFilterHasBounds}
        >
          {t('usage_stats.request_events_numeric_apply')}
        </Button>
      </div>
    </>
  );

  const performanceSummaryCards = [
    {
      key: 'output-tps',
      label: t('usage_stats.request_events_weighted_output_tps'),
      value: formatPerSecondValue(performanceSummary.outputTps.value),
      samples: performanceSummary.outputTps.sampleCount,
    },
    {
      key: 'average-tps',
      label: t('usage_stats.request_events_weighted_average_tps'),
      value: formatPerSecondValue(performanceSummary.averageTps.value),
      samples: performanceSummary.averageTps.sampleCount,
    },
    {
      key: 'visible-average-tps',
      label: t('usage_stats.request_events_visible_average_tps'),
      value: formatPerSecondValue(performanceSummary.visibleAverageTps.value),
      samples: performanceSummary.visibleAverageTps.sampleCount,
    },
    {
      key: 'reasoning-ratio',
      label: t('usage_stats.request_events_reasoning_ratio'),
      value: formatReasoningRatioValue(performanceSummary.reasoningRatio.value, i18n.language),
      samples: performanceSummary.reasoningRatio.sampleCount,
    },
  ];

  const performanceSummaryGrid = (
    <div className={styles.requestEventsPerformanceSummary} data-performance-summary>
      {performanceSummaryCards.map((card) => (
        <div
          key={card.key}
          className={styles.requestEventsPerformanceSummaryCard}
          data-performance-summary-key={card.key}
        >
          <span className={styles.requestEventsPerformanceSummaryLabel}>{card.label}</span>
          <strong className={styles.requestEventsPerformanceSummaryValue}>{card.value}</strong>
          <span className={styles.requestEventsPerformanceSummarySamples}>
            {t('usage_stats.request_events_performance_samples', {
              valid: card.samples,
              total: performanceSummary.totalCount,
            })}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <Card
      title={t('usage_stats.request_events_title')}
      extra={
        <div className={styles.requestEventsActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            disabled={!hasActiveFilters}
          >
            {t('usage_stats.clear_filters')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
          >
            {t('usage_stats.export_csv')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportJson}
            disabled={filteredRows.length === 0}
          >
            {t('usage_stats.export_json')}
          </Button>
          <div
            ref={columnSettingsRef}
            className={styles.requestEventsColumnSettings}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && !event.currentTarget.contains(nextTarget)) {
                setColumnSettingsOpen(false);
              }
            }}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.requestEventsColumnSettingsTrigger}
              data-column-settings-trigger
              aria-haspopup="dialog"
              aria-expanded={columnSettingsOpen}
              aria-controls={columnSettingsId}
              aria-label={t('usage_stats.request_events_column_settings')}
              onClick={() => setColumnSettingsOpen((open) => !open)}
            >
              <IconSettings size={15} aria-hidden="true" />
              <span className={styles.requestEventsColumnSettingsTriggerLabel}>
                {t('usage_stats.request_events_column_settings')}
              </span>
            </Button>
            {columnSettingsOpen && (
              <div
                ref={columnSettingsPanelRef}
                id={columnSettingsId}
                role="dialog"
                aria-modal="false"
                aria-labelledby={`${columnSettingsId}-title`}
                className={styles.requestEventsColumnSettingsPopover}
              >
                <div
                  id={`${columnSettingsId}-title`}
                  className={styles.requestEventsColumnSettingsTitle}
                >
                  {t('usage_stats.request_events_column_settings')}
                </div>
                <div className={styles.requestEventsColumnSettingsGrid}>
                  {columnOptions
                    .filter(
                      (column) =>
                        (column.id !== 'latency' || hasLatencyData) &&
                        (column.id !== 'ttfb' || hasTTFBData) &&
                        (column.id !== 'outputTps' || hasOutputTpsData) &&
                        (column.id !== 'averageTps' || hasAverageTpsData)
                    )
                    .map((column) => {
                      const checkboxId = `${columnSettingsId}-${column.id}`;
                      const checked = columnVisibility[column.id];
                      return (
                        <label
                          key={column.id}
                          htmlFor={checkboxId}
                          className={styles.requestEventsColumnToggle}
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={checked}
                            disabled={
                              checked && column.id !== 'latency' && stableVisibleColumnCount === 1
                            }
                            onChange={() => handleToggleColumn(column.id)}
                          />
                          <span>{column.label}</span>
                        </label>
                      );
                    })}
                </div>
                <div className={styles.requestEventsColumnSettingsFooter}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRestoreDefaultColumns}
                  >
                    {t('usage_stats.request_events_restore_default_columns')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className={styles.requestEventsToolbar}>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_model')}
          </span>
          <Select
            value={effectiveModelFilter}
            options={modelOptions}
            onChange={setModelFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_model')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_request_key')}
          </span>
          <Select
            value={effectiveRequestKeyFilter}
            options={requestKeyOptions}
            onChange={setRequestKeyFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_request_key')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_source')}
          </span>
          <Select
            value={effectiveSourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_source')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_auth_index')}
          </span>
          <Select
            value={effectiveAuthIndexFilter}
            options={authIndexOptions}
            onChange={setAuthIndexFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_auth_index')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_tier')}
          </span>
          <Select
            value={effectiveServiceTierFilter}
            options={serviceTierOptions}
            onChange={setServiceTierFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_tier')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_effort')}
          </span>
          <Select
            value={effectiveReasoningEffortFilter}
            options={reasoningEffortOptions}
            onChange={setReasoningEffortFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_effort')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_result')}
          </span>
          <Select
            value={resultFilter}
            options={resultOptions}
            onChange={setResultFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_result')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>{t('usage_stats.range_filter')}</span>
          <Select
            value={effectiveTimeRangeFilter}
            options={timeRangeOptions}
            onChange={(value) => {
              if (!isRequestEventTimeRange(value)) return;
              setTimeRangeFilter(value);
              if (value !== 'page' && value !== 'all') {
                setTimeRangeClockMs(Date.now());
              }
            }}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.range_filter')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_cache')}
          </span>
          <Select
            value={cacheFilter}
            options={cacheOptions}
            onChange={setCacheFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_cache')}
            fullWidth={false}
          />
        </div>
        <div
          ref={numericFilterRef}
          className={`${styles.requestEventsFilterItem} ${styles.requestEventsNumericFilterItem}`}
        >
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_numeric_filter')}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            fullWidth
            data-numeric-filter-trigger
            className={`${styles.requestEventsNumericFilterTrigger} ${
              hasAppliedNumericFilter ? styles.requestEventsNumericFilterTriggerActive : ''
            }`}
            aria-haspopup="dialog"
            aria-expanded={numericFilterOpen}
            aria-controls={useNumericFilterSheet ? undefined : numericFilterId}
            aria-label={
              numericAppliedSummary
                ? t('usage_stats.request_events_numeric_active_label', {
                    filter: numericAppliedSummary,
                  })
                : t('usage_stats.request_events_numeric_filter')
            }
            title={numericAppliedSummary || t('usage_stats.request_events_numeric_filter')}
            onClick={() => {
              if (numericFilterOpen) {
                closeNumericFilter();
              } else {
                openNumericFilter();
              }
            }}
          >
            <span className={styles.requestEventsNumericFilterTriggerContent}>
              <IconSlidersHorizontal size={15} aria-hidden="true" />
              <span className={styles.requestEventsNumericFilterTriggerText}>
                {numericAppliedSummary || t('usage_stats.request_events_numeric_filter')}
              </span>
              {hasAppliedNumericFilter && (
                <span className={styles.requestEventsNumericFilterActiveDot} aria-hidden="true" />
              )}
            </span>
          </Button>
          {numericFilterOpen && numericFilterPresentation === 'popover' && (
            <div
              ref={numericFilterPanelRef}
              id={numericFilterId}
              role="dialog"
              aria-modal="false"
              aria-labelledby={`${numericFilterId}-title`}
              aria-describedby={`${numericFilterId}-description`}
              className={styles.requestEventsNumericFilterPopover}
              style={numericFilterPopoverStyle ?? undefined}
            >
              <div
                id={`${numericFilterId}-title`}
                className={styles.requestEventsNumericFilterTitle}
              >
                {t('usage_stats.request_events_numeric_filter')}
              </div>
              <p
                id={`${numericFilterId}-description`}
                className={styles.requestEventsNumericFilterDescription}
              >
                {t('usage_stats.request_events_numeric_help')}
              </p>
              {numericFilterEditor}
              <div className={styles.requestEventsNumericFilterFooter}>{numericFilterActions}</div>
            </div>
          )}
        </div>
      </div>

      {useNumericFilterSheet && (
        <Sheet
          open={numericFilterOpen && numericFilterPresentation === 'sheet'}
          onClose={() => {
            setNumericFilterOpen(false);
            setNumericFilterPresentation(null);
          }}
          size="md"
          className={styles.requestEventsNumericFilterSheet}
          title={t('usage_stats.request_events_numeric_filter')}
          description={t('usage_stats.request_events_numeric_help')}
          footer={
            <div className={styles.requestEventsNumericFilterSheetFooter}>
              {numericFilterActions}
            </div>
          }
        >
          {numericFilterEditor}
        </Sheet>
      )}

      {performanceSummaryGrid}

      {loading && timeScopedRows.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : timeScopedRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          <div className={styles.requestEventsMeta}>
            <span>{t('usage_stats.request_events_count', { count: filteredRows.length })}</span>
            {hasLatencyData && <span className={styles.requestEventsLimitHint}>{latencyHint}</span>}
            {hasTTFBData && <span className={styles.requestEventsLimitHint}>{ttfbHint}</span>}
            {hasOutputTpsData && (
              <span className={styles.requestEventsLimitHint}>{outputTpsHint}</span>
            )}
            {filteredRows.length > MAX_RENDERED_EVENTS && (
              <span className={styles.requestEventsLimitHint}>
                {t('usage_stats.request_events_limit_hint', {
                  shown: MAX_RENDERED_EVENTS,
                  total: filteredRows.length,
                })}
              </span>
            )}
          </div>

          <div
            className={styles.requestEventsTableWrapper}
            role="region"
            tabIndex={0}
            aria-label={t('usage_stats.request_events_table_region')}
          >
            <table className={`${styles.table} ${styles.requestEventsTable}`}>
              <thead>
                <tr>
                  {columnVisibility.timestamp && (
                    <th>{t('usage_stats.request_events_timestamp')}</th>
                  )}
                  {columnVisibility.model && <th>{t('usage_stats.model_name')}</th>}
                  {columnVisibility.requestKey && (
                    <th title={requestKeyColumnHint}>
                      {t('usage_stats.request_events_request_key')}
                    </th>
                  )}
                  {columnVisibility.source && <th>{t('usage_stats.request_events_source')}</th>}
                  {columnVisibility.authIndex && (
                    <th>{t('usage_stats.request_events_auth_index')}</th>
                  )}
                  {columnVisibility.tier && <th>{t('usage_stats.request_events_tier')}</th>}
                  {columnVisibility.result && <th>{t('usage_stats.request_events_result')}</th>}
                  {columnVisibility.latency && hasLatencyData && (
                    <th title={latencyHint}>{t('usage_stats.time')}</th>
                  )}
                  {columnVisibility.ttfb && hasTTFBData && (
                    <th title={ttfbHint}>{t('usage_stats.request_events_ttfb')}</th>
                  )}
                  {columnVisibility.firstContent && (
                    <th title={firstContentHint}>
                      {t('usage_stats.request_events_first_content')}
                    </th>
                  )}
                  {columnVisibility.ttft && (
                    <th title={ttftHint}>{t('usage_stats.request_events_ttft')}</th>
                  )}
                  {columnVisibility.ttfa && (
                    <th title={ttfaHint}>{t('usage_stats.request_events_ttfa')}</th>
                  )}
                  {columnVisibility.outputTps && hasOutputTpsData && (
                    <th title={outputTpsHint}>{t('usage_stats.request_events_output_tps')}</th>
                  )}
                  {columnVisibility.averageTps && hasAverageTpsData && (
                    <th title={averageTpsHint}>{t('usage_stats.request_events_average_tps')}</th>
                  )}
                  {columnVisibility.visibleAverageTps && (
                    <th title={visibleAverageTpsHint}>
                      {t('usage_stats.request_events_visible_average_tps')}
                    </th>
                  )}
                  {columnVisibility.reasoningRatio && (
                    <th title={reasoningRatioHint}>
                      {t('usage_stats.request_events_reasoning_ratio')}
                    </th>
                  )}
                  {columnVisibility.effort && <th>{t('usage_stats.request_events_effort')}</th>}
                  {columnVisibility.totalInputTokens && (
                    <th className={styles.requestEventsTokenHeader}>
                      {t('usage_stats.request_events_total_input_tokens')}
                    </th>
                  )}
                  {columnVisibility.nonCacheReadInputTokens && (
                    <th
                      className={`${styles.requestEventsTokenHeader} ${styles.requestEventsTokenHeaderHint}`}
                      {...getHeaderTooltipProps('non-cache-read-input', nonCacheReadInputHint)}
                    >
                      {t('usage_stats.request_events_non_cache_read_input_tokens')}
                    </th>
                  )}
                  {columnVisibility.totalOutputTokens && (
                    <th className={styles.requestEventsTokenHeader}>
                      {t('usage_stats.request_events_total_output_tokens')}
                    </th>
                  )}
                  {columnVisibility.displayedOutputTokens && (
                    <th
                      className={`${styles.requestEventsTokenHeader} ${styles.requestEventsTokenHeaderHint}`}
                      {...getHeaderTooltipProps('displayed-output', displayedOutputHint)}
                    >
                      {t('usage_stats.request_events_explicit_output_tokens')}
                    </th>
                  )}
                  {columnVisibility.reasoningTokens && (
                    <th className={styles.requestEventsTokenHeader}>
                      {t('usage_stats.reasoning_tokens')}
                    </th>
                  )}
                  {columnVisibility.cacheReadTokens && (
                    <th
                      className={`${styles.requestEventsTokenHeader} ${styles.requestEventsTokenHeaderHint} ${styles.requestEventsTokenCacheRead}`}
                      {...getHeaderTooltipProps(
                        'cache-read-rate',
                        t('usage_stats.request_events_cache_rate_hint')
                      )}
                    >
                      {t('usage_stats.cache_read_tokens')}
                    </th>
                  )}
                  {columnVisibility.cacheWriteTokens && (
                    <th className={styles.requestEventsTokenHeader}>
                      {t('usage_stats.cache_write_tokens')}
                    </th>
                  )}
                  {columnVisibility.totalTokens && (
                    <th
                      className={`${styles.requestEventsTokenHeader} ${styles.requestEventsTokenTotal}`}
                    >
                      {t('usage_stats.total_tokens')}
                    </th>
                  )}
                  {columnVisibility.cost && (
                    <th className={styles.requestEventsCostHeader}>
                      {t('usage_stats.request_events_cost_estimate')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => {
                  const cacheRateToneClassName = getCacheRateToneClassName(row.cacheRateTone);
                  const cacheReadTokensLabel = row.cacheReadTokens.toLocaleString();
                  const inputTokensLabel = row.inputTokens.toLocaleString();
                  const cacheRateLabel =
                    row.cacheRate === null
                      ? t('common.not_set')
                      : cacheRateFormatter.format(row.cacheRate);
                  const cacheRateToneLabel =
                    row.cacheRateTone === 'anomaly'
                      ? t('usage_stats.request_events_cache_rate_anomaly')
                      : row.cacheRateTone === 'unavailable'
                        ? t('common.not_set')
                        : t(`usage_stats.request_events_cache_rate_${row.cacheRateTone}`);
                  const cacheAnomalyLabel =
                    row.cacheRateTone === 'anomaly'
                      ? t('usage_stats.request_events_cache_rate_anomaly_label', {
                          tokens: cacheReadTokensLabel,
                          input: inputTokensLabel,
                        })
                      : null;
                  const cacheRateCellLabel = t('usage_stats.request_events_cache_rate_cell_label', {
                    tokens: cacheReadTokensLabel,
                    rate: cacheRateLabel,
                    tone: cacheRateToneLabel,
                  });
                  const cacheRateCellDescription = cacheAnomalyLabel
                    ? `${cacheRateCellLabel} ${cacheAnomalyLabel}`
                    : cacheRateCellLabel;
                  const longContextLabel = t('usage_stats.pricing_long_context');
                  const inputTokensCellLabel = row.longContext
                    ? `${inputTokensLabel} · ${longContextLabel}`
                    : undefined;

                  return (
                    <tr key={row.id}>
                      {columnVisibility.timestamp && (
                        <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                          {row.timestampLabel}
                        </td>
                      )}
                      {columnVisibility.model && <td className={styles.modelCell}>{row.model}</td>}
                      {columnVisibility.requestKey && (
                        <td
                          className={styles.requestEventsRequestKey}
                          title={row.requestIdentityLabel}
                          data-request-identity-type={row.requestIdentityType}
                          data-request-key-config-index={row.requestKeyConfigIndex ?? undefined}
                        >
                          {row.requestIdentityLabel}
                        </td>
                      )}
                      {columnVisibility.source && (
                        <td className={styles.requestEventsSourceCell} title={row.source}>
                          <span>{row.source}</span>
                          {row.sourceType && (
                            <span className={styles.credentialType}>{row.sourceType}</span>
                          )}
                        </td>
                      )}
                      {columnVisibility.authIndex && (
                        <td className={styles.requestEventsAuthIndex} title={row.authIndex}>
                          {row.authIndex}
                        </td>
                      )}
                      {columnVisibility.tier && (
                        <td>
                          <span
                            className={styles.requestEventsTierFlow}
                            title={row.serviceTierTitle}
                            aria-label={row.serviceTierTitle}
                            role="group"
                            data-service-tier-flow={
                              row.requestDisplayServiceTier &&
                              row.requestDisplayServiceTier !== row.resolvedServiceTier.tier
                                ? 'combined'
                                : 'resolved'
                            }
                          >
                            {row.requestDisplayServiceTier &&
                              row.requestDisplayServiceTier !== row.resolvedServiceTier.tier && (
                                <>
                                  <span
                                    className={`${styles.requestEventsTierBadge} ${
                                      row.requestDisplayServiceTier === 'fast'
                                        ? styles.requestEventsTierFast
                                        : styles.requestEventsTierStd
                                    }`}
                                    aria-hidden="true"
                                  >
                                    {row.requestServiceTierLabel}
                                  </span>
                                  <span
                                    className={styles.requestEventsTierArrow}
                                    aria-hidden="true"
                                  >
                                    →
                                  </span>
                                </>
                              )}
                            <span
                              className={`${styles.requestEventsTierBadge} ${
                                row.resolvedServiceTier.tier === 'fast'
                                  ? styles.requestEventsTierFast
                                  : styles.requestEventsTierStd
                              }`}
                              aria-hidden="true"
                            >
                              {row.serviceTierLabel}
                            </span>
                          </span>
                        </td>
                      )}
                      {columnVisibility.result && (
                        <td>
                          <span
                            className={
                              row.failed
                                ? styles.requestEventsResultFailed
                                : styles.requestEventsResultSuccess
                            }
                          >
                            {row.failed ? t('stats.failure') : t('stats.success')}
                          </span>
                        </td>
                      )}
                      {columnVisibility.latency && hasLatencyData && (
                        <td className={styles.durationCell}>{formatDurationMs(row.latencyMs)}</td>
                      )}
                      {columnVisibility.ttfb && hasTTFBData && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="ttfb"
                          data-ttfb-ms={row.ttfbMs ?? undefined}
                        >
                          {formatDurationMs(row.ttfbMs)}
                        </td>
                      )}
                      {columnVisibility.firstContent && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="first-content"
                          data-first-content-ms={row.firstContentMs ?? undefined}
                          title={firstContentHint}
                        >
                          {formatDurationMs(row.firstContentMs)}
                        </td>
                      )}
                      {columnVisibility.ttft && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="ttft"
                          data-ttft-ms={row.ttftMs ?? undefined}
                          title={ttftHint}
                        >
                          {formatDurationMs(row.ttftMs)}
                        </td>
                      )}
                      {columnVisibility.ttfa && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="ttfa"
                          data-ttfa-ms={row.ttfaMs ?? undefined}
                          title={ttfaHint}
                        >
                          {formatDurationMs(row.ttfaMs)}
                        </td>
                      )}
                      {columnVisibility.outputTps && hasOutputTpsData && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="output-tps"
                          data-output-tps={row.outputTps ?? undefined}
                          title={
                            row.outputTps === null
                              ? outputTpsHint
                              : `${outputTpsHint} (${formatDurationMs(row.decodeDurationMs)})`
                          }
                        >
                          {formatPerSecondValue(row.outputTps)}
                        </td>
                      )}
                      {columnVisibility.averageTps && hasAverageTpsData && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="average-tps"
                          data-average-tps={row.averageTps ?? undefined}
                          title={averageTpsHint}
                        >
                          {formatPerSecondValue(row.averageTps)}
                        </td>
                      )}
                      {columnVisibility.visibleAverageTps && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="visible-average-tps"
                          data-visible-average-tps={row.visibleAverageTps ?? undefined}
                          title={visibleAverageTpsHint}
                        >
                          {formatPerSecondValue(row.visibleAverageTps)}
                        </td>
                      )}
                      {columnVisibility.reasoningRatio && (
                        <td
                          className={styles.durationCell}
                          data-request-performance="reasoning-ratio"
                          data-reasoning-ratio={row.reasoningRatio ?? undefined}
                          title={reasoningRatioHint}
                        >
                          {formatReasoningRatioValue(row.reasoningRatio, i18n.language)}
                        </td>
                      )}
                      {columnVisibility.effort && (
                        <td>
                          <span
                            className={getReasoningEffortClassName(row.reasoningEffort)}
                            title={row.reasoningEffort ?? undefined}
                            data-reasoning-effort-tone={getReasoningEffortTone(row.reasoningEffort)}
                          >
                            {row.reasoningEffortLabel}
                          </span>
                        </td>
                      )}
                      {columnVisibility.totalInputTokens && (
                        <td
                          className={`${styles.requestEventsTokenCell} ${
                            row.longContext ? styles.requestEventsLongContext : ''
                          }`}
                          data-context-band={row.longContext ? 'long' : 'short'}
                          title={inputTokensCellLabel}
                          aria-label={inputTokensCellLabel}
                        >
                          <span className={styles.requestEventsTokenValue}>
                            {row.inputTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.nonCacheReadInputTokens && (
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.nonCacheReadInputTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.totalOutputTokens && (
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.outputTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.displayedOutputTokens && (
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.displayedOutputTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.reasoningTokens && (
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.reasoningTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.cacheReadTokens && (
                        <td
                          className={`${styles.requestEventsTokenCell} ${styles.requestEventsTokenCacheRead} ${cacheRateToneClassName}`}
                          data-cache-rate-tone={row.cacheRateTone}
                          data-cache-token-count={row.cacheReadTokens}
                          title={cacheRateCellDescription}
                          aria-label={cacheRateCellDescription}
                        >
                          <span className={styles.requestEventsTokenValue}>
                            {cacheReadTokensLabel}
                            {cacheAnomalyLabel && (
                              <span
                                className={styles.requestEventsCacheAnomalyMarker}
                                title={cacheAnomalyLabel}
                                aria-hidden="true"
                              >
                                !
                              </span>
                            )}
                          </span>
                        </td>
                      )}
                      {columnVisibility.cacheWriteTokens && (
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.cacheWriteTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.totalTokens && (
                        <td
                          className={`${styles.requestEventsTokenCell} ${styles.requestEventsTokenTotal}`}
                        >
                          <span className={styles.requestEventsTokenValue}>
                            {row.totalTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.cost && (
                        <td
                          className={styles.requestEventsCostCell}
                          data-request-cost-status={row.costStatus}
                          data-request-cost-tone={row.costTone}
                          title={
                            row.costStatus === 'priced'
                              ? t('usage_stats.pricing_estimate_notice')
                              : row.costStatus === 'unmatched'
                                ? t('usage_stats.pricing_unmatched')
                                : t('usage_stats.pricing_anomaly')
                          }
                        >
                          {row.costAmount === null
                            ? '--'
                            : formatRequestEventCostUsd(row.costAmount, i18n.language)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {activeHeaderTooltip &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={headerTooltipId}
            role="tooltip"
            className={styles.requestEventsHeaderTooltip}
            style={{
              left: activeHeaderTooltip.left,
              top: activeHeaderTooltip.top,
              width: activeHeaderTooltip.width,
              transform: activeHeaderTooltip.transform,
            }}
          >
            {activeHeaderTooltip.text}
          </div>,
          document.body
        )}
    </Card>
  );
}
