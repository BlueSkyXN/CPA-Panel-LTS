import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { CredentialAction, CredentialActionResult } from '../runtimeActions';

export interface CredentialActionTarget {
  action: CredentialAction;
  files: AuthFileItem[];
  revision: number;
}

export function CredentialActionDialog({
  target,
  onClose,
  onMutated,
}: {
  target: CredentialActionTarget;
  onClose: () => void;
  onMutated: (names?: string[]) => void;
}) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const pending = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [results, setResults] = useState<CredentialActionResult[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () => alive.current && target.revision === apiClient.getConnectionRevision();
  const title = t(`credential_actions.${target.action}`);
  const run = async () => {
    if (pending.current || attempted || !current() || connectionStatus !== 'connected') return;
    pending.current = true;
    setBusy(true);
    setAttempted(true);
    const next: CredentialActionResult[] = [];
    let sent = false;
    try {
      if (target.action === 'refresh-all') {
        sent = true;
        next.push(...(await authFilesApi.requestAllManualRefresh()));
      } else {
        for (const file of target.files) {
          if (!current()) return;
          try {
            sent = true;
            if (target.action === 'cooldown')
              await authFilesApi.resetCooldown(String(file.authIndex ?? '').trim());
            else
              await authFilesApi.requestManualRefresh(
                file.name,
                String(file.authIndex ?? '').trim() || undefined
              );
            next.push({ id: file.name, success: true });
          } catch (cause) {
            const status =
              typeof cause === 'object' &&
              cause !== null &&
              'status' in cause &&
              typeof cause.status === 'number'
                ? cause.status
                : undefined;
            next.push({
              id: file.name,
              success: false,
              status,
              uncertain: status === undefined || status >= 500,
            });
          }
        }
      }
      if (current()) setResults(next);
    } catch {
      if (current()) setError(t('credential_actions.unknown_result'));
    } finally {
      if (current() && sent) {
        onMutated(
          target.action === 'refresh-all' ? undefined : target.files.map((file) => file.name)
        );
        try {
          await authFilesApi.list();
        } catch {
          if (current()) setError(t('credential_actions.readback_failed'));
        }
      }
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const connected =
    target.revision === apiClient.getConnectionRevision() && connectionStatus === 'connected';
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.close')}
          </Button>
          {!attempted && (
            <Button onClick={() => void run()} disabled={!connected} loading={busy}>
              {t('common.confirm')}
            </Button>
          )}
        </>
      }
    >
      {!attempted && (
        <p>{t(`credential_actions.${target.action}_confirm`, { count: target.files.length })}</p>
      )}
      {!connected && <p role="alert">{t('credential_actions.connection_changed')}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul>
          {results.map((result, i) => (
            <li key={`${i}:${result.id}`}>
              {result.id}:{' '}
              {result.success
                ? t('credential_actions.success')
                : result.uncertain
                  ? t('credential_actions.unknown_result')
                  : (result.status ?? t('credential_actions.failed'))}
            </li>
          ))}
        </ul>
      )}
      {attempted && !busy && !results.length && !error && connected && (
        <p>{t('credential_actions.no_results')}</p>
      )}
    </Modal>
  );
}
