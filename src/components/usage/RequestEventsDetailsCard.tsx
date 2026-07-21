import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  collectUsageDetails,
  extractLatencyMs,
  extractTotalTokens,
  formatDurationMs,
  LATENCY_SOURCE_FIELD,
  normalizeAuthIndex,
  resolveServiceTier,
  type ResolvedServiceTier,
  type UsageTimeRange,
} from '@/utils/usage';
import {
  getUsageCacheTokenCounts,
  getUsageUncachedInputTokenCount,
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
  'source',
  'authIndex',
  'tier',
  'result',
  'latency',
  'effort',
  'totalInputTokens',
  'displayedUncachedInputTokens',
  'totalOutputTokens',
  'displayedOutputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'totalTokens',
] as const;

type RequestEventColumnId = (typeof REQUEST_EVENT_COLUMN_IDS)[number];
type RequestEventColumnVisibility = Record<RequestEventColumnId, boolean>;
type RequestEventCacheRateTone = 'unavailable' | 'low' | 'medium' | 'high' | 'anomaly';
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

const REQUEST_EVENT_NUMERIC_METRIC_IDS = [
  'totalInputTokens',
  'displayedUncachedInputTokens',
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
  source: false,
  authIndex: false,
  tier: true,
  result: true,
  latency: true,
  effort: true,
  totalInputTokens: true,
  displayedUncachedInputTokens: true,
  totalOutputTokens: true,
  displayedOutputTokens: true,
  reasoningTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  totalTokens: true,
};

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  serviceTier: string | null;
  requestServiceTier: string | null;
  responseServiceTier: string | null;
  effectiveServiceTier: string | null;
  resolvedServiceTier: ResolvedServiceTier;
  serviceTierFilterValue: string;
  serviceTierLabel: string;
  serviceTierTitle: string;
  reasoningEffort: string | null;
  reasoningEffortFilterValue: string;
  reasoningEffortLabel: string;
  failed: boolean;
  latencyMs: number | null;
  inputTokens: number;
  displayedUncachedInputTokens: number;
  outputTokens: number;
  displayedOutputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheRate: number | null;
  cacheRateTone: RequestEventCacheRateTone;
  totalTokens: number;
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
    case 'displayedUncachedInputTokens':
      return row.displayedUncachedInputTokens;
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

export function RequestEventsDetailsCard({
  usage,
  loading,
  pageTimeRange,
  referenceNowMs,
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
  const uncachedInputHint = t('usage_stats.request_events_uncached_input_tokens_hint');
  const displayedOutputHint = t('usage_stats.request_events_output_tokens_hint');
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
  const [storedColumnVisibility, setStoredColumnVisibility] = useLocalStorage<unknown>(
    COLUMN_VISIBILITY_STORAGE_KEY,
    DEFAULT_COLUMN_VISIBILITY
  );
  const columnVisibility = useMemo(
    () => normalizeColumnVisibility(storedColumnVisibility),
    [storedColumnVisibility]
  );
  const columnSettingsId = useId();
  const numericFilterId = useId();
  const numericMetricSelectId = useId();
  const numericFilterErrorId = useId();
  const columnSettingsRef = useRef<HTMLDivElement | null>(null);
  const columnSettingsPanelRef = useRef<HTMLDivElement | null>(null);
  const numericFilterRef = useRef<HTMLDivElement | null>(null);
  const numericFilterPanelRef = useRef<HTMLDivElement | null>(null);
  const numericFilterPopoverRafRef = useRef<number | null>(null);

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

      // v1/v2 were development-era defaults. v3 intentionally starts from the
      // formal Source/Auth-hidden and eight-Token-visible default set.
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
      const serviceTier = detail.service_tier ?? null;
      const requestServiceTier = detail.request_service_tier ?? null;
      const responseServiceTier = detail.response_service_tier ?? null;
      const effectiveServiceTier = detail.effective_service_tier ?? null;
      const resolvedServiceTier = resolveServiceTier({
        serviceTier,
        requestServiceTier,
        responseServiceTier,
        effectiveServiceTier,
      });
      const serviceTierFilterValue =
        resolvedServiceTier.tier === 'fast' ? SERVICE_TIER_FAST_FILTER : SERVICE_TIER_STD_FILTER;
      const serviceTierLabel =
        resolvedServiceTier.tier === 'fast'
          ? t('usage_stats.request_events_tier_fast')
          : t('usage_stats.request_events_tier_standard');
      const serviceTierTitle = t(
        `usage_stats.request_events_tier_tooltip_${resolvedServiceTier.evidence}`,
        { tier: serviceTierLabel }
      );
      const reasoningEffort = normalizeReasoningEffort(detail.reasoning_effort);
      const reasoningEffortFilterValue = getReasoningEffortFilterValue(reasoningEffort);
      const reasoningEffortLabel =
        reasoningEffort ?? t('usage_stats.request_events_effort_legacy_unknown');
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const { cacheReadTokens, cacheWriteTokens } = getUsageCacheTokenCounts(detail.tokens);
      const displayedUncachedInputTokens = getUsageUncachedInputTokenCount(detail.tokens);
      const displayedOutputTokens = Math.max(outputTokens - reasoningTokens, 0);
      const cacheRate = resolveCacheRate(inputTokens, cacheReadTokens);
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );
      const latencyMs = extractLatencyMs(detail);

      return {
        id: `${timestamp}-${model}-${sourceKey}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        model,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        serviceTier,
        requestServiceTier,
        responseServiceTier,
        effectiveServiceTier,
        resolvedServiceTier,
        serviceTierFilterValue,
        serviceTierLabel,
        serviceTierTitle,
        reasoningEffort,
        reasoningEffortFilterValue,
        reasoningEffortLabel,
        failed: detail.failed === true,
        latencyMs,
        inputTokens,
        displayedUncachedInputTokens,
        outputTokens,
        displayedOutputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheRate,
        cacheRateTone: getCacheRateTone(cacheRate, inputTokens, cacheReadTokens),
        totalTokens,
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
  }, [authFileMap, i18n.language, sourceInfoMap, t, usage]);

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
        value: 'displayedUncachedInputTokens',
        label: t('usage_stats.request_events_uncached_input_tokens'),
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
      { id: 'source' as const, label: t('usage_stats.request_events_source') },
      { id: 'authIndex' as const, label: t('usage_stats.request_events_auth_index') },
      { id: 'tier' as const, label: t('usage_stats.request_events_tier') },
      { id: 'result' as const, label: t('usage_stats.request_events_result') },
      { id: 'latency' as const, label: t('usage_stats.time') },
      { id: 'effort' as const, label: t('usage_stats.request_events_effort') },
      {
        id: 'totalInputTokens' as const,
        label: t('usage_stats.request_events_total_input_tokens'),
      },
      {
        id: 'displayedUncachedInputTokens' as const,
        label: t('usage_stats.request_events_uncached_input_tokens'),
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
    ],
    [t]
  );

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
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

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
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
      'source',
      'source_raw',
      'auth_index',
      'service_tier',
      'request_service_tier',
      'response_service_tier',
      'effective_service_tier',
      'resolved_service_tier',
      'service_tier_evidence',
      'reasoning_effort',
      'result',
      ...(hasLatencyData ? ['latency_ms'] : []),
      'input_tokens',
      'uncached_input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'cache_read_tokens',
      'cache_creation_tokens',
      'total_tokens',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.source,
        row.sourceRaw,
        row.authIndex,
        row.serviceTier ?? '',
        row.requestServiceTier ?? '',
        row.responseServiceTier ?? '',
        row.effectiveServiceTier ?? '',
        row.resolvedServiceTier.tier,
        row.resolvedServiceTier.evidence,
        row.reasoningEffort ?? '',
        row.failed ? 'failed' : 'success',
        ...(hasLatencyData ? [row.latencyMs ?? ''] : []),
        row.inputTokens,
        row.displayedUncachedInputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cacheReadTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
        row.totalTokens,
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
      source: row.source,
      source_raw: row.sourceRaw,
      auth_index: row.authIndex,
      service_tier: row.serviceTier,
      request_service_tier: row.requestServiceTier,
      response_service_tier: row.responseServiceTier,
      effective_service_tier: row.effectiveServiceTier,
      resolved_service_tier: row.resolvedServiceTier.tier,
      service_tier_evidence: row.resolvedServiceTier.evidence,
      reasoning_effort: row.reasoningEffort,
      failed: row.failed,
      ...(hasLatencyData && row.latencyMs !== null ? { latency_ms: row.latencyMs } : {}),
      tokens: {
        input_tokens: row.inputTokens,
        uncached_input_tokens: row.displayedUncachedInputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cacheReadTokens,
        cache_read_tokens: row.cacheReadTokens,
        cache_creation_tokens: row.cacheWriteTokens,
        total_tokens: row.totalTokens,
      },
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
                    .filter((column) => column.id !== 'latency' || hasLatencyData)
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
                  {columnVisibility.source && <th>{t('usage_stats.request_events_source')}</th>}
                  {columnVisibility.authIndex && (
                    <th>{t('usage_stats.request_events_auth_index')}</th>
                  )}
                  {columnVisibility.tier && <th>{t('usage_stats.request_events_tier')}</th>}
                  {columnVisibility.result && <th>{t('usage_stats.request_events_result')}</th>}
                  {columnVisibility.latency && hasLatencyData && (
                    <th title={latencyHint}>{t('usage_stats.time')}</th>
                  )}
                  {columnVisibility.effort && <th>{t('usage_stats.request_events_effort')}</th>}
                  {columnVisibility.totalInputTokens && (
                    <th className={styles.requestEventsTokenHeader}>
                      {t('usage_stats.request_events_total_input_tokens')}
                    </th>
                  )}
                  {columnVisibility.displayedUncachedInputTokens && (
                    <th
                      className={`${styles.requestEventsTokenHeader} ${styles.requestEventsTokenHeaderHint}`}
                      title={uncachedInputHint}
                      aria-label={uncachedInputHint}
                    >
                      {t('usage_stats.request_events_uncached_input_tokens')}
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
                      title={displayedOutputHint}
                      aria-label={displayedOutputHint}
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
                      title={t('usage_stats.request_events_cache_rate_hint')}
                      aria-label={t('usage_stats.request_events_cache_rate_hint')}
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

                  return (
                    <tr key={row.id}>
                      {columnVisibility.timestamp && (
                        <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                          {row.timestampLabel}
                        </td>
                      )}
                      {columnVisibility.model && <td className={styles.modelCell}>{row.model}</td>}
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
                            className={`${styles.requestEventsTierBadge} ${
                              row.resolvedServiceTier.tier === 'fast'
                                ? styles.requestEventsTierFast
                                : styles.requestEventsTierStd
                            }`}
                            title={row.serviceTierTitle}
                            aria-label={row.serviceTierTitle}
                          >
                            {row.serviceTierLabel}
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
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.inputTokens.toLocaleString()}
                          </span>
                        </td>
                      )}
                      {columnVisibility.displayedUncachedInputTokens && (
                        <td className={styles.requestEventsTokenCell}>
                          <span className={styles.requestEventsTokenValue}>
                            {row.displayedUncachedInputTokens.toLocaleString()}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
