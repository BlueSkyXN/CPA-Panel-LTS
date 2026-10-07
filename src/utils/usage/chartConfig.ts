/**
 * Chart.js configuration utilities for usage statistics
 * Extracted from UsagePage.tsx for reusability
 */

import type { ChartOptions } from 'chart.js';

export interface ChartThemeColors {
  gridColor: string;
  axisBorderColor: string;
  tickColor: string;
}

let chartThemeColorsCache: { key: string; colors: ChartThemeColors } | null = null;

const readCssVar = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const value = document.documentElement ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return value || fallback;
};

const LIGHT_CHART_THEME: ChartThemeColors = {
  gridColor: 'rgba(17, 24, 39, 0.06)',
  axisBorderColor: 'rgba(17, 24, 39, 0.10)',
  tickColor: 'rgba(17, 24, 39, 0.72)',
};

/**
 * 图表文字/网格颜色跟随 data-theme 的 CSS 变量；浅色默认值与历史行为一致。
 * 结果按主题名缓存，主题切换后的下一次构建自然生效。
 */
export function getChartThemeColors(): ChartThemeColors {
  if (typeof document === 'undefined') return LIGHT_CHART_THEME;
  const key = document.documentElement.getAttribute('data-theme') ?? '';
  if (!key) return LIGHT_CHART_THEME;
  if (chartThemeColorsCache?.key === key) return chartThemeColorsCache.colors;
  const colors: ChartThemeColors = {
    gridColor: readCssVar('--border-color', LIGHT_CHART_THEME.gridColor),
    axisBorderColor: readCssVar('--border-color', LIGHT_CHART_THEME.axisBorderColor),
    tickColor: readCssVar('--text-secondary', LIGHT_CHART_THEME.tickColor),
  };
  chartThemeColorsCache = { key, colors };
  return colors;
}

/**
 * Static sparkline chart options (no dependencies on theme/mobile)
 */
export const sparklineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  elements: { line: { tension: 0.45 }, point: { radius: 0 } }
};

export interface ChartConfigOptions {
  period: 'hour' | 'day';
  labels: string[];
  isMobile: boolean;
}

/**
 * Build chart options with theme and responsive awareness
 */
export function buildChartOptions({
  period,
  labels,
  isMobile
}: ChartConfigOptions): ChartOptions<'line'> {
  const pointRadius = isMobile && period === 'hour' ? 0 : isMobile ? 2 : 4;
  const tickFontSize = isMobile ? 10 : 12;
  const maxTickLabelCount = isMobile ? (period === 'hour' ? 8 : 6) : period === 'hour' ? 12 : 10;
  const theme = getChartThemeColors();
  const tooltipBg = 'rgba(255, 255, 255, 0.98)';
  const tooltipTitle = '#111827';
  const tooltipBody = '#374151';
  const tooltipBorder = 'rgba(17, 24, 39, 0.10)';

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        usePointStyle: true
      }
    },
    scales: {
      x: {
        grid: {
          color: theme.gridColor,
          drawTicks: false
        },
        border: {
          color: theme.axisBorderColor
        },
        ticks: {
          color: theme.tickColor,
          font: { size: tickFontSize },
          maxRotation: isMobile ? 0 : 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: maxTickLabelCount,
          callback: (value) => {
            const index = typeof value === 'number' ? value : Number(value);
            const raw =
              Number.isFinite(index) && labels[index] ? labels[index] : typeof value === 'string' ? value : '';

            if (period === 'hour') {
              const [md, time] = raw.split(' ');
              if (!time) return raw;
              if (time.startsWith('00:')) {
                return md ? [md, time] : time;
              }
              return time;
            }

            if (isMobile) {
              const parts = raw.split('-');
              if (parts.length === 3) {
                return `${parts[1]}-${parts[2]}`;
              }
            }
            return raw;
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: theme.gridColor
        },
        border: {
          color: theme.axisBorderColor
        },
        ticks: {
          color: theme.tickColor,
          font: { size: tickFontSize }
        }
      }
    },
    elements: {
      line: {
        tension: 0.35,
        borderWidth: isMobile ? 1.5 : 2
      },
      point: {
        borderWidth: 2,
        radius: pointRadius,
        hoverRadius: 4
      }
    }
  };
}

/**
 * Calculate minimum chart width for hourly data on mobile devices
 */
export function getHourChartMinWidth(labelCount: number, isMobile: boolean): string | undefined {
  if (!isMobile || labelCount <= 0) return undefined;
  const perPoint = 56;
  const minWidth = Math.min(labelCount * perPoint, 3000);
  return `${minWidth}px`;
}

/**
 * 供独立构建 Chart options 的卡片取当前主题的轴/网格颜色。
 */
export function buildStaticAxisTheme(fontSize = 11): {
  gridColor: string;
  axisBorderColor: string;
  tickColor: string;
  tickFont: { size: number };
} {
  const theme = getChartThemeColors();
  return {
    gridColor: theme.gridColor,
    axisBorderColor: theme.axisBorderColor,
    tickColor: theme.tickColor,
    tickFont: { size: fontSize },
  };
}

/**
 * 稀疏序列（单点/少点）在移动端也保证可见的最小点半径。
 * Chart.js 的 point radius 是 scriptable 值，这里只接受其中的数字形态。
 */
export function sparsePointRadius(baseRadius: unknown, minimum = 3): number {
  const parsed = typeof baseRadius === 'number' ? baseRadius : Number(baseRadius);
  return Number.isFinite(parsed) ? Math.max(parsed, minimum) : minimum;
}
