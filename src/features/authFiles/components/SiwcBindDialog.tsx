import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { captureSiwcBindingApi, type SiwcBindResponse } from '@/services/api/oauth';
import { useAuthStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { createOAuthAttempts } from '@/pages/oauthAttempts';
import { createSiwcStart, getSiwcBindingStatus, isSiwcCallbackValid } from '../siwcBinding';

type Phase = 'idle' | 'starting' | 'wait' | 'ok' | 'error' | 'unsupported' | 'expired';
export function SiwcBindDialog({
  file,
  onClose,
  onSaved,
}: {
  file: AuthFileItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [run, setRun] = useState(0);
  const [session, setSession] = useState<SiwcBindResponse>();
  const [callback, setCallback] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [enabled, setEnabled] = useState(file.useSiwc === true);
  const [saving, setSaving] = useState(false);
  const actions = useRef<{ start: () => void; submit: (url: string) => Promise<void> } | null>(
    null
  );
  const callbacks = useRef({ onClose, onSaved });
  useEffect(() => {
    callbacks.current = { onClose, onSaved };
  }, [onClose, onSaved]);

  useEffect(() => {
    const revision = apiClient.getConnectionRevision();
    const api = captureSiwcBindingApi();
    const attempts = createOAuthAttempts({
      setTimeout: (fn, delay) => window.setTimeout(fn, delay),
      clearTimeout: (id) => window.clearTimeout(id),
    });
    const attempt = attempts.begin(file.name);
    let expiresAt = 0;
    let binding: SiwcBindResponse | undefined;
    const current = () => attempt.isCurrent() && apiClient.isCurrentConnection(revision);
    const poll = () => {
      if (!binding || !current() || attempt.isPolling()) return;
      setPhase('wait');
      attempt.poll<{ status: 'ok' | 'wait' | 'error' | 'expired' }>(
        () =>
          Date.now() >= expiresAt
            ? Promise.resolve({ status: 'expired' as const })
            : api.status(binding!.state, attempt.signal),
        (result) => {
          if (!current()) return false;
          setPhase(result.status);
          if (result.status === 'ok') {
            startup.complete();
            setEnabled(true);
            callbacks.current.onSaved();
          }
          return result.status === 'wait';
        },
        () => {
          if (current()) setPhase('error');
        },
        2000
      );
    };
    const startup = createSiwcStart({
      start: () => {
        setPhase('starting');
        return api.start(file.name);
      },
      cancel: api.cancel,
      onResult: (result) => {
        if (!current()) return;
        const url = new URL(result.url);
        if (
          result.status !== 'ok' ||
          result.flow !== 'siwc_bind' ||
          !result.state ||
          !['https:', 'http:'].includes(url.protocol) ||
          !(result.expires_in > 0)
        )
          throw new Error('Invalid SIWC session');
        binding = result;
        expiresAt = Date.now() + result.expires_in * 1000;
        setSession(result);
        poll();
      },
      onError: (error) => {
        if (!current()) return;
        setPhase(
          typeof error === 'object' && error !== null && 'status' in error && error.status === 404
            ? 'unsupported'
            : 'error'
        );
      },
    });
    actions.current = {
      start: () => {
        if (current()) void startup.start();
      },
      submit: async (url) => {
        if (!binding || !current()) return;
        if (!isSiwcCallbackValid(url, binding.state)) {
          setFeedback('invalid_callback');
          return;
        }
        setSubmitting(true);
        setFeedback('');
        try {
          await api.callback(url, attempt.signal);
          if (current()) {
            setFeedback('submitted');
            poll();
          }
        } catch {
          if (current()) setFeedback('callback_failed');
        } finally {
          if (current()) setSubmitting(false);
        }
      },
    };
    const unsubscribe = useAuthStore.subscribe(() => {
      if (!apiClient.isCurrentConnection(revision)) {
        attempt.invalidate();
        startup.close();
        callbacks.current.onClose();
      }
    });
    return () => {
      unsubscribe();
      attempt.invalidate();
      startup.close();
      actions.current = null;
    };
  }, [file.name, run]);

  const toggle = async (value: boolean) => {
    const revision = apiClient.getConnectionRevision();
    setSaving(true);
    setFeedback('');
    try {
      await authFilesApi.patchFields(file.name, { use_siwc: value });
      if (!apiClient.isCurrentConnection(revision)) return;
      const latest = (await authFilesApi.list()).files.find((entry) => entry.name === file.name);
      if (!apiClient.isCurrentConnection(revision)) return;
      if (!latest || latest.useSiwc !== value) throw new Error('SIWC readback mismatch');
      setEnabled(value);
      callbacks.current.onSaved();
    } catch {
      if (apiClient.isCurrentConnection(revision)) setFeedback('toggle_failed');
    } finally {
      if (apiClient.isCurrentConnection(revision)) setSaving(false);
    }
  };
  const retry = () => {
    setSession(undefined);
    setCallback('');
    setFeedback('');
    setSubmitting(false);
    setPhase('idle');
    setRun((value) => value + 1);
  };
  return (
    <Modal
      open
      title={t('siwc.title')}
      onClose={onClose}
      width={620}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t(phase === 'ok' ? 'siwc.done' : 'common.close')}
        </Button>
      }
    >
      <p>
        {t('siwc.target')}: {file.name}
      </p>
      <p>{t(`siwc.${getSiwcBindingStatus({ ...file, useSiwc: enabled })}`)}</p>
      {(file.siwcBound || enabled) && phase === 'idle' && (
        <ToggleSwitch
          label={t('siwc.enable')}
          checked={enabled}
          onChange={(value) => void toggle(value)}
          disabled={saving}
        />
      )}
      {phase === 'idle' && (
        <Button onClick={() => actions.current?.start()} disabled={saving}>
          {t('siwc.start')}
        </Button>
      )}
      {phase !== 'idle' && <p role="status">{t(`siwc.${phase}`)}</p>}
      {session && (phase === 'wait' || phase === 'error') && (
        <>
          <p>
            <a href={session.url} target="_blank" rel="noopener noreferrer">
              {t('siwc.open')}
            </a>
          </p>
          <Input
            label={t('siwc.callback')}
            value={callback}
            onChange={(event) => setCallback(event.target.value)}
            hint={t('siwc.hint')}
            autoComplete="off"
          />
          <Button
            onClick={() => void actions.current?.submit(callback)}
            disabled={submitting || !callback.trim()}
            loading={submitting}
          >
            {t('siwc.submit')}
          </Button>
        </>
      )}
      {feedback && (
        <p role={feedback === 'submitted' ? 'status' : 'alert'}>{t(`siwc.${feedback}`)}</p>
      )}
      {['error', 'expired', 'unsupported'].includes(phase) && (
        <Button variant="secondary" onClick={retry}>
          {t('siwc.retry')}
        </Button>
      )}
    </Modal>
  );
}
