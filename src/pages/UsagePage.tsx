import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { buildUsageEventsSearch } from '@/utils/usage/eventWorkspace';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { providersApi } from '@/services/api';
import { useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import {
  StatCards,
  UsageChart,
  ChartLineSelector,
  ApiDetailsCard,
  ModelStatsCard,
  PricingEntryCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  TokenBreakdownChart,
  CostTrendChart,
  ServiceHealthCard,
  useUsageData,
  useSparklines,
  useChartData,
} from '@/components/usage';
import {
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  calculatePricingCoverage,
  filterUsageByTimeRange,
  isUsageTimeRange,
  resolveUsageTimeRangeWindow,
  USAGE_PRESET_TIME_RANGES,
  usageTimeRangeWindowHours,
  type UsageTimeRange,
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const CUSTOM_RANGE_STORAGE_KEY = 'cli-proxy-usage-custom-time-range-v1';
const DEFAULT_CHART_LINES = ['all'];
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const MAX_CHART_LINES = 9;
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  ...USAGE_PRESET_TIME_RANGES.map((preset) => ({
    value: preset as UsageTimeRange,
    labelKey: `usage_stats.range_${preset}`,
  })),
  { value: 'custom', labelKey: 'usage_stats.range_custom' },
];

// 自定义时间范围的表单草稿（datetime-local 字符串）
interface CustomRangeDraft {
  start: string;
  end: string;
}

const CUSTOM_RANGE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const formatDateTimeLocal = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const parseDateTimeLocal = (value: string): number | null => {
  if (!CUSTOM_RANGE_INPUT_PATTERN.test(value)) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const createDefaultCustomRange = (): CustomRangeDraft => {
  const now = Date.now();
  return {
    start: formatDateTimeLocal(now - 24 * 60 * 60 * 1000),
    end: formatDateTimeLocal(now),
  };
};

const isCustomRangeDraft = (value: unknown): value is CustomRangeDraft =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as CustomRangeDraft).start === 'string' &&
  typeof (value as CustomRangeDraft).end === 'string' &&
  CUSTOM_RANGE_INPUT_PATTERN.test((value as CustomRangeDraft).start) &&
  CUSTOM_RANGE_INPUT_PATTERN.test((value as CustomRangeDraft).end);

const loadCustomRange = (): CustomRangeDraft => {
  try {
    if (typeof localStorage === 'undefined') {
      return createDefaultCustomRange();
    }
    const raw = localStorage.getItem(CUSTOM_RANGE_STORAGE_KEY);
    if (!raw) {
      return createDefaultCustomRange();
    }
    const parsed = JSON.parse(raw);
    return isCustomRangeDraft(parsed) ? parsed : createDefaultCustomRange();
  } catch {
    return createDefaultCustomRange();
  }
};

const normalizeChartLines = (value: unknown, maxLines = MAX_CHART_LINES): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

export function UsagePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);

  // Data hook
  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    priceProfile,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  } = useUsageData();

  useHeaderRefresh(loadUsage);

  // Chart lines state
  const [showRequestEvents, setShowRequestEvents] = useState(false);
  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [customRange, setCustomRange] = useState<CustomRangeDraft>(loadCustomRange);

  useEffect(() => {
    let cancelled = false;
    const source = openaiCompatibilityConfig;

    providersApi
      .getOpenAIProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex({ source, providers: providers || [] });
      })
      .catch(() => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex(null);
      });

    return () => {
      cancelled = true;
    };
  }, [openaiCompatibilityConfig]);

  const openaiProviderState = openaiProvidersWithAuthIndex;
  const openaiProvidersForUsage =
    openaiProviderState && openaiProviderState.source === openaiCompatibilityConfig
      ? openaiProviderState.providers
      : (openaiCompatibilityConfig ?? []);

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const nowMs = lastRefreshedAt?.getTime() ?? 0;

  const customWindow = useMemo(() => {
    const startMs = parseDateTimeLocal(customRange.start);
    const endMs = parseDateTimeLocal(customRange.end);
    return startMs !== null && endMs !== null && endMs > startMs
      ? { startMs, endMs }
      : null;
  }, [customRange]);

  const effectiveWindow = useMemo(() => {
    if (timeRange === 'all') return null;
    if (timeRange === 'custom') return customWindow;
    return nowMs > 0 ? resolveUsageTimeRangeWindow(timeRange, nowMs) : null;
  }, [customWindow, nowMs, timeRange]);

  const filteredUsage = useMemo(
    () =>
      usage && effectiveWindow && nowMs > 0
        ? filterUsageByTimeRange(usage, effectiveWindow, nowMs)
        : (usage ?? null),
    [effectiveWindow, nowMs, usage]
  );
  const hourWindowHours = usageTimeRangeWindowHours(effectiveWindow);

  const handleChartLinesChange = useCallback((lines: string[]) => {
    setChartLines(normalizeChartLines(lines));
  }, []);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
    } catch {
      // Ignore storage errors.
    }
  }, [chartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CUSTOM_RANGE_STORAGE_KEY, JSON.stringify(customRange));
    } catch {
      // Ignore storage errors.
    }
  }, [customRange]);

  const handleCustomRangeChange = useCallback((field: 'start' | 'end', value: string) => {
    setCustomRange((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Sparklines hook
  const { requestsSparkline, tokensSparkline, rpmSparkline, tpmSparkline, costSparkline } =
    useSparklines({ usage: filteredUsage, loading, nowMs, priceProfile });

  // Chart data hook
  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions,
  } = useChartData({ usage: filteredUsage, chartLines, isMobile, hourWindowHours });

  // Derived data
  const modelNames = useMemo(() => getModelNamesFromUsage(usage), [usage]);
  const apiStats = useMemo(
    () => getApiStats(filteredUsage, priceProfile),
    [filteredUsage, priceProfile]
  );
  const modelStats = useMemo(
    () => getModelStats(filteredUsage, priceProfile),
    [filteredUsage, priceProfile]
  );
  const pricingCoverage = useMemo(
    () => calculatePricingCoverage(filteredUsage, priceProfile),
    [filteredUsage, priceProfile]
  );
  const showPricing = pricingCoverage.pricedRequests > 0;
  const openPricing = useCallback(() => navigate('/usage/pricing'), [navigate]);

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as UsageTimeRange)}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
            {timeRange === 'custom' && (
              <div className={styles.customRangeInputs}>
                <input
                  type="datetime-local"
                  className={styles.customRangeInput}
                  value={customRange.start}
                  onChange={(event) => handleCustomRangeChange('start', event.target.value)}
                  aria-label={t('usage_stats.range_custom_start')}
                />
                <span className={styles.customRangeSeparator} aria-hidden="true">
                  –
                </span>
                <input
                  type="datetime-local"
                  className={styles.customRangeInput}
                  value={customRange.end}
                  onChange={(event) => handleCustomRangeChange('end', event.target.value)}
                  aria-label={t('usage_stats.range_custom_end')}
                />
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Stats Overview Cards */}
      <StatCards
        usage={filteredUsage}
        loading={loading}
        pricingCoverage={pricingCoverage}
        onOpenPricing={openPricing}
        nowMs={nowMs}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline,
        }}
      />

      {/* Chart Line Selection */}
      <ChartLineSelector
        chartLines={chartLines}
        modelNames={modelNames}
        maxLines={MAX_CHART_LINES}
        onChange={handleChartLinesChange}
      />

      {/* Service Health */}
      <ServiceHealthCard usage={usage} loading={loading} />

      {/* Charts Grid */}
      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      {/* Token Breakdown Chart */}
      <TokenBreakdownChart
        usage={filteredUsage}
        loading={loading}
        isMobile={isMobile}
        hourWindowHours={hourWindowHours}
      />

      {/* Cost Trend Chart */}
      <CostTrendChart
        usage={filteredUsage}
        loading={loading}
        isMobile={isMobile}
        priceProfile={priceProfile}
        onOpenPricing={openPricing}
        hourWindowHours={hourWindowHours}
      />

      {/* Details Grid */}
      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} showPricing={showPricing} />
        <ModelStatsCard modelStats={modelStats} loading={loading} showPricing={showPricing} />
      </div>

      <Card title={t('usage_stats.request_events_workspace_title')}>
        <p className={styles.hint}>{t('usage_stats.request_events_entry_hint')}</p>
        <div className={styles.requestEventsActions}>
          <Button
            variant="secondary"
            onClick={() => navigate(`/usage/events${buildUsageEventsSearch(timeRange, customWindow)}`)}
          >
            {t('usage_stats.request_events_open_workspace')}
          </Button>
          <Button variant="ghost" onClick={() => setShowRequestEvents((value) => !value)}>
            {t(showRequestEvents ? 'usage_stats.request_events_hide_inline' : 'usage_stats.request_events_show_inline')}
          </Button>
        </div>
      </Card>

      {showRequestEvents && (
        <RequestEventsDetailsCard
          usage={usage}
          loading={loading}
          pageTimeRange={timeRange}
          pageTimeRangeCustom={timeRange === 'custom' ? customWindow : null}
          referenceNowMs={nowMs}
          priceProfile={priceProfile}
          requestApiKeys={config?.apiKeys || []}
          geminiKeys={config?.geminiApiKeys || []}
          claudeConfigs={config?.claudeApiKeys || []}
          codexConfigs={config?.codexApiKeys || []}
          vertexConfigs={config?.vertexApiKeys || []}
          openaiProviders={openaiProvidersForUsage}
        />
      )}

      {/* Credential Stats */}
      <CredentialStatsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      <PricingEntryCard coverage={pricingCoverage} onOpen={openPricing} />
    </div>
  );
}
