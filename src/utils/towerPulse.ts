/**
 * Pure helpers for the sidebar tower pulse: recent traffic totals derived
 * from auth-file recent requests, and a cross-provider quota canary derived
 * from the shared quota cache (no network access here).
 */

import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
} from '@/types';
import {
  mergeRecentRequestBucketGroups,
  sumRecentRequests,
  type RecentRequestBucket,
} from '@/utils/recentRequests';

export interface TowerTraffic {
  success: number;
  failure: number;
}

export interface TowerTrafficSource {
  recentRequests?: RecentRequestBucket[];
}

export function sumTrafficFromAuthFiles(files: TowerTrafficSource[]): TowerTraffic {
  const merged = mergeRecentRequestBucketGroups(files.map((file) => file.recentRequests ?? []));
  const { success, failure } = sumRecentRequests(merged);
  return { success, failure };
}

export function compactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(value);
  const scaled = value / 1000;
  const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '');
  return `${text}k`;
}

export type QuotaCanaryTag = 'claude' | 'codex' | 'gemini' | 'antigravity' | 'kimi';

export interface QuotaCanarySample {
  tag: QuotaCanaryTag;
  file: string;
  windowLabel: string;
  remainingPercent: number;
}

export interface QuotaCanarySnapshot {
  claude: Record<string, ClaudeQuotaState>;
  codex: Record<string, CodexQuotaState>;
  geminiCli: Record<string, GeminiCliQuotaState>;
  antigravity: Record<string, AntigravityQuotaState>;
  kimi: Record<string, KimiQuotaState>;
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const pushUsedPercentSample = (
  samples: QuotaCanarySample[],
  tag: QuotaCanaryTag,
  file: string,
  label: string,
  usedPercent: number | null
): void => {
  if (usedPercent === null || !Number.isFinite(usedPercent)) return;
  samples.push({ tag, file, windowLabel: label, remainingPercent: clampPercent(100 - usedPercent) });
};

const pushRemainingFractionSample = (
  samples: QuotaCanarySample[],
  tag: QuotaCanaryTag,
  file: string,
  label: string,
  remainingFraction: number | null
): void => {
  if (remainingFraction === null || !Number.isFinite(remainingFraction)) return;
  samples.push({
    tag,
    file,
    windowLabel: label,
    remainingPercent: clampPercent(remainingFraction * 100),
  });
};

export function collectQuotaCanarySamples(snapshot: QuotaCanarySnapshot): QuotaCanarySample[] {
  const samples: QuotaCanarySample[] = [];

  Object.entries(snapshot.claude ?? {}).forEach(([file, state]) => {
    if (state?.status !== 'success') return;
    state.windows?.forEach((window) => {
      pushUsedPercentSample(samples, 'claude', file, window.label, window.usedPercent);
    });
  });

  Object.entries(snapshot.codex ?? {}).forEach(([file, state]) => {
    if (state?.status !== 'success') return;
    state.windows?.forEach((window) => {
      pushUsedPercentSample(samples, 'codex', file, window.label, window.usedPercent);
    });
  });

  Object.entries(snapshot.geminiCli ?? {}).forEach(([file, state]) => {
    if (state?.status !== 'success') return;
    state.buckets?.forEach((bucket) => {
      pushRemainingFractionSample(samples, 'gemini', file, bucket.label, bucket.remainingFraction);
    });
  });

  Object.entries(snapshot.antigravity ?? {}).forEach(([file, state]) => {
    if (state?.status !== 'success') return;
    state.groups?.forEach((group) => {
      group.buckets?.forEach((bucket) => {
        pushRemainingFractionSample(samples, 'antigravity', file, bucket.label, bucket.remainingFraction);
      });
    });
  });

  Object.entries(snapshot.kimi ?? {}).forEach(([file, state]) => {
    if (state?.status !== 'success') return;
    state.rows?.forEach((row) => {
      if (!Number.isFinite(row.limit) || row.limit <= 0) return;
      const remaining = (1 - row.used / row.limit) * 100;
      samples.push({
        tag: 'kimi',
        file,
        windowLabel: row.label || row.id,
        remainingPercent: clampPercent(remaining),
      });
    });
  });

  return samples;
}

export function pickQuotaCanary(samples: QuotaCanarySample[]): QuotaCanarySample | null {
  if (samples.length === 0) return null;
  return samples.reduce((lowest, sample) =>
    sample.remainingPercent < lowest.remainingPercent ? sample : lowest
  );
}

export type QuotaCanaryTone = 'warn' | 'critical';

export function quotaCanaryTone(remainingPercent: number): QuotaCanaryTone | null {
  if (remainingPercent < 10) return 'critical';
  if (remainingPercent < 25) return 'warn';
  return null;
}

export function trimVersionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^[vV]+/, '');
  return trimmed ? `v${trimmed}` : null;
}
