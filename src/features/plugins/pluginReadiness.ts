import type { AuthFileItem } from '@/types';
import { isRecord } from '@/utils/helpers';

const states = new Set(['ready', 'not_ready', 'degraded', 'unknown', 'unsupported']);
const levels = new Set([
  'plugin_installed',
  'runner_installed',
  'protocol_ready',
  'auth_ready',
  'session_ready',
]);
const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 512) : '');

export interface PluginReadiness {
  ready: boolean;
  generation: string;
  checks: Array<{ level: string; state: string; version: string; message: string }>;
}

export function parsePluginReadiness(value: unknown): PluginReadiness {
  const source = isRecord(value) ? value : {};
  const checks = Array.isArray(source.Checks) ? source.Checks : [];
  return {
    ready: source.Ready === true,
    generation: text(source.Generation),
    checks: checks
      .filter(isRecord)
      .filter((check) => levels.has(text(check.Level)))
      .slice(0, 5)
      .map((check) => ({
        level: text(check.Level),
        state: states.has(text(check.State)) ? text(check.State) : 'unknown',
        version: text(check.Version),
        message: text(check.Message),
      })),
  };
}

export function readinessAccounts(files: AuthFileItem[], provider: string): AuthFileItem[] {
  return files.filter(
    (file) =>
      (file.provider || file.type || '').toLowerCase() === provider.toLowerCase() &&
      file.disabled !== true &&
      file.authIndex !== undefined &&
      file.authIndex !== null &&
      String(file.authIndex).trim() !== ''
  );
}
