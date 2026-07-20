import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScriptableContext } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildHourlyCostSeries,
  buildDailyCostSeries,
  formatUsd,
  isApiUsdEstimateComplete,
  type PriceProfileV3,
  type PricingCoverage,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CostTrendChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  priceProfile: PriceProfileV3;
  onOpenPricing: () => void;
  hourWindowHours?: number;
}

const COST_COLOR = '#f59e0b';
const COST_BG = 'rgba(245, 158, 11, 0.15)';

function buildGradient(ctx: ScriptableContext<'line'>) {
  const chart = ctx.chart;
  const area = chart.chartArea;
  if (!area) return COST_BG;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, 'rgba(245, 158, 11, 0.28)');
  gradient.addColorStop(0.6, 'rgba(245, 158, 11, 0.12)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0.02)');
  return gradient;
}

export function CostTrendChart({
  usage,
  loading,
  isDark,
  isMobile,
  priceProfile,
  onOpenPricing,
  hourWindowHours,
}: CostTrendChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');
  const { chartData, chartOptions, hasData, pricingCoverage } = useMemo(() => {
    if (!usage) {
      return {
        chartData: { labels: [], datasets: [] },
        chartOptions: {},
        hasData: false,
        pricingCoverage: null as PricingCoverage | null,
      };
    }

    const series =
      period === 'hour'
        ? buildHourlyCostSeries(usage, priceProfile, hourWindowHours)
        : buildDailyCostSeries(usage, priceProfile);

    const data = {
      labels: series.labels,
      datasets: [
        {
          label: t('usage_stats.pricing_api_usd_estimate'),
          data: series.data,
          borderColor: COST_COLOR,
          backgroundColor: buildGradient,
          pointBackgroundColor: COST_COLOR,
          pointBorderColor: COST_COLOR,
          fill: true,
          tension: 0.35,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...(baseOptions.scales?.y && 'ticks' in baseOptions.scales.y
              ? baseOptions.scales.y.ticks
              : {}),
            callback: (value: string | number) => formatUsd(Number(value)),
          },
        },
      },
    };

    return {
      chartData: data,
      chartOptions: options,
      hasData: series.hasData,
      pricingCoverage: series.pricingCoverage,
    };
  }, [usage, period, isDark, isMobile, priceProfile, hourWindowHours, t]);

  const pricingComplete = pricingCoverage !== null && isApiUsdEstimateComplete(pricingCoverage);
  const hasUnpricedUsage =
    pricingCoverage !== null &&
    pricingCoverage.apiTokenUsdRequests > 0 &&
    pricingCoverage.pricedRequests === 0;
  const hasOnlyNonApiUsage =
    pricingCoverage !== null &&
    pricingCoverage.totalRequests > 0 &&
    pricingCoverage.apiTokenUsdRequests === 0;

  return (
    <Card
      title={t('usage_stats.pricing_api_usd_trend')}
      extra={
        <div className={styles.costTrendActions}>
          <div className={styles.periodButtons}>
            <Button
              variant={period === 'hour' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPeriod('hour')}
            >
              {t('usage_stats.by_hour')}
            </Button>
            <Button
              variant={period === 'day' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPeriod('day')}
            >
              {t('usage_stats.by_day')}
            </Button>
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenPricing}>
            {t('usage_stats.pricing_open')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : !hasData ? (
        <div className={styles.hint}>
          {t(
            hasUnpricedUsage
              ? 'usage_stats.pricing_cost_incomplete'
              : hasOnlyNonApiUsage
                ? 'usage_stats.pricing_no_api_usage'
                : 'usage_stats.cost_no_data'
          )}
        </div>
      ) : (
        <>
          {pricingCoverage && !pricingComplete && (
            <div className={styles.costCoverageNote}>
              {t('usage_stats.pricing_partial_coverage', {
                request: (pricingCoverage.apiPricedRequestRatio * 100).toFixed(1),
                token: (pricingCoverage.apiPricedTokenRatio * 100).toFixed(1),
              })}
            </div>
          )}
          <div className={styles.chartWrapper}>
            <div className={styles.chartArea}>
              <div className={styles.chartScroller}>
                <div
                  className={styles.chartCanvas}
                  style={
                    period === 'hour'
                      ? { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) }
                      : undefined
                  }
                >
                  <Line data={chartData} options={chartOptions} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
