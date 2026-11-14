import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import {
  AnthropicResetGrantError,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/usage';
import {
  resetGrantOperations,
  RETRY_WINDOW_MS,
  ResetGrantPreflightError,
  resetGrantFailureMessageKey,
} from './resetGrantOperations';
import { canChooseResetGrant } from './resetGrantChoice';
import { readResetGrantsForCard, scheduleResetGrantRead } from './resetGrantReads';

/** Card-owned reads; the session-scoped journal owns spending and ambiguous retries. */
export function useClaudeResetGrants(
  file: AuthFileItem,
  enabled: boolean,
  disabled: boolean,
  refreshToken: unknown,
  onRefresh: () => void
) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const key = JSON.stringify([file.name, authIndex]);
  const [status, setStatus] = useState<AnthropicResetGrantStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setStatus(null);
    if (!enabled || disabled || !sessionActive || !authIndex) return;
    let cancelled = false;
    const current = () =>
      !cancelled && version === generation.current && session === apiClient.getConnectionRevision();
    const cancelRead = scheduleResetGrantRead(() => {
      void readResetGrantsForCard(authIndex).then(
        (result) => {
          if (current()) {
            setStatus(result);
            setMessage('');
          }
        },
        (error: unknown) => {
          if (current()) {
            setMessage(
              error instanceof AnthropicResetGrantError && error.code === 'rate_limited'
                ? 'rate_limited'
                : 'read_error'
            );
          }
        }
      );
    }, current);
    return () => {
      cancelled = true;
      cancelRead();
      generation.current += 1;
    };
  }, [authIndex, key, enabled, disabled, sessionActive, session, refreshToken, reload]);

  const operation = resetGrantOperations.inspect(key);
  const pending = operation && !operation.code ? operation : undefined;
  const expired = Boolean(pending && now - pending.createdAt >= RETRY_WINDOW_MS);
  // An uncertain claim must stay selectable even if discovery no longer lists it.
  const grants = [...(status?.grants ?? [])];
  if (pending && !grants.some((grant) => grant.id === pending.grantId)) grants.push(pending.grant);
  const blocked = disabled || !sessionActive || !authIndex || busy || expired;
  const canRedeemGrant = (grantId: unknown) =>
    !blocked && canChooseResetGrant(status, pending?.grantId, grantId, now);
  const confirm = (
    grantId: string
  ): Promise<{ code: string; unresolved: boolean } | null | undefined> => {
    if (!canRedeemGrant(grantId) || lock.current || !authIndex) return Promise.resolve(null);
    const version = generation.current;
    const current = () =>
      session === apiClient.getConnectionRevision() && version === generation.current;
    if (!current() || useAuthStore.getState().connectionStatus !== 'connected')
      return Promise.resolve(null);
    lock.current = true;
    setBusy(true);
    let lastAnswer: { code: string; unresolved: boolean } | null = null;
    return (async () => {
      try {
        const answer = await resetGrantOperations.run(key, authIndex, grantId);
        lastAnswer = { code: answer.unresolved ? 'unknown' : answer.code, unresolved: answer.unresolved };
        if (!current()) return;
        showNotification(
          t(`claude_reset.${answer.unresolved ? 'unknown' : answer.code}`),
          !answer.unresolved && (answer.code === 'reset' || answer.code === 'already_used')
            ? 'success'
            : 'error'
        );
      } catch (error: unknown) {
        if (!current()) return;
        const unresolved = resetGrantOperations.inspect(key);
        showNotification(
          t(
            unresolved && !unresolved.code
              ? 'claude_reset.unknown'
              : resetGrantFailureMessageKey(error),
            {
              code: error instanceof ResetGrantPreflightError ? error.reason : '',
            }
          ),
          'error'
        );
      } finally {
        lock.current = false;
        // A concurrent page-wide refresh can invalidate this read generation.
        // Release the local lock regardless, but never refresh a replacement account.
        setBusy(false);
        setReload((value) => value + 1);
        if (current()) onRefresh();
      }
    })().then((value) => value ?? lastAnswer);
  };
  return {
    count: status?.grants.reduce((sum, grant) => sum + grant.resetsLeft, 0) ?? null,
    grants,
    loading: !status && !message && !pending,
    blocked,
    pendingGrantId: pending?.grantId,
    canRedeemGrant,
    busy,
    confirm,
    message: pending ? (expired ? 'expired' : 'unknown') : message,
    buttonLabel: pending ? 'retry' : 'use',
  };
}
