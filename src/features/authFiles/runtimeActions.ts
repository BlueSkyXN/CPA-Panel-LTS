import { isRecord } from '@/utils/helpers';

export type CredentialAction = 'refresh' | 'refresh-all' | 'cooldown';
export interface CredentialActionResult {
  id: string;
  success: boolean;
  status?: number;
  uncertain?: boolean;
}

// Keep only status fields; refresh responses from older Core versions may contain tokens.
export function normalizeRefreshResults(payload: unknown): CredentialActionResult[] {
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.results)) {
    throw new Error('Invalid credential refresh response');
  }
  return payload.results.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      typeof entry.success !== 'boolean'
    ) {
      throw new Error('Invalid credential refresh result');
    }
    return { id: entry.id, success: entry.success };
  });
}

export function validateRefreshResponse(payload: unknown): void {
  if (!isRecord(payload) || payload.ok !== true)
    throw new Error('Invalid credential refresh response');
}

export function validateCooldownResponse(payload: unknown, authIndex: string): void {
  if (!isRecord(payload) || payload.status !== 'ok' || payload.auth_index !== authIndex) {
    throw new Error('Invalid cooldown reset response');
  }
}
