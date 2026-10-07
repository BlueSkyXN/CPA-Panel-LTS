import { apiCallApi } from '@/services/api/apiCall';
import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';

export function parseCodexSubscriptionActiveUntil(payload: unknown): string | number | null {
  if (typeof payload === 'string') {
    try {
      return parseCodexSubscriptionActiveUntil(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  if (!isRecord(payload)) return null;
  const value = payload.active_until ?? payload.activeUntil;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric > 0 ? numeric : null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}

export async function fetchCodexSubscriptionActiveUntil(
  authIndex: string,
  accountId: string | null,
  header: Record<string, string>
): Promise<string | number | null> {
  if (!accountId) return null;
  const generation = apiClient.getConnectionGeneration();
  try {
    const result = await apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: `https://chatgpt.com/backend-api/subscriptions?account_id=${encodeURIComponent(accountId)}`,
        header,
      },
      { timeout: 8000 }
    );
    if (
      !apiClient.isCurrentConnection(generation) ||
      result.statusCode < 200 ||
      result.statusCode >= 300
    )
      return null;
    return parseCodexSubscriptionActiveUntil(result.body ?? result.bodyText);
  } catch {
    return null;
  }
}

export function normalizeCodexAccountCredits(credits: unknown): {
  balance: string | null;
  unlimited: boolean;
} {
  const value = isRecord(credits) ? credits : {};
  const raw = value.balance;
  const balance = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  return {
    balance: /^\d+(?:\.\d+)?$/.test(balance) && Number.isFinite(Number(balance)) ? balance : null,
    unlimited: value.unlimited === true,
  };
}
