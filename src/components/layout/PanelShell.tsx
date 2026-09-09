import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  readProfiles,
  saveProfile,
  deleteProfile,
  prepareHandoff,
  validateConnectionBase,
  type ConnectionProfile,
} from '@/services/storage/connectionProfiles';
import { probeConnection } from '@/services/api/connectionProbe';
import { generateId } from '@/utils/helpers';
import {
  hasActiveWrites,
  hasSessionChanges,
  safeSessionPath,
  setSessionFrozen,
} from '@/services/connectionSession';
import styles from './PanelShell.module.scss';

const newProfile = (): ConnectionProfile => ({
  id: generateId(),
  name: '',
  apiBase: '',
  environment: '',
  rememberPassword: false,
});

export function PanelShell({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const location = useLocation();
  const profileId = useAuthStore((state) => state.profileId);
  const apiBase = useAuthStore((state) => state.apiBase);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const status = useAuthStore((state) => state.connectionStatus);
  const [profiles, setProfiles] = useState(readProfiles);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  const connectRef = useRef<((profile: ConnectionProfile, secret: string) => Promise<void>) | null>(
    null
  );
  const host = useRef<HTMLDivElement>(null);
  const current = profiles.find((profile) => profile.id === profileId);
  const refresh = useCallback(() => setProfiles(readProfiles()), []);

  useEffect(() => {
    refresh();
  }, [refresh, profileId, authenticated]);
  useEffect(() => {
    const show = (event: Event) => {
      refresh();
      setOpen(true);
      const requestedId: unknown = (event as CustomEvent).detail?.profileId;
      const profile = readProfiles().find((item) => item.id === requestedId);
      if (profile) void connectRef.current?.(profile, profile.managementKey || '');
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('cpa-open-connections', show);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('cpa-open-connections', show);
    };
  }, [refresh]);
  useEffect(() => {
    const element = host.current;
    if (element) element.inert = pending;
    // Portal 不在 inert 容器内，也必须阻止其用户操作。
    const blockOutsideManager = (event: Event) => {
      if (event.target instanceof Element && !event.target.closest('.connection-manager-modal')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const events = ['click', 'pointerdown', 'keydown'];
    if (pending)
      events.forEach((name) => document.addEventListener(name, blockOutsideManager, true));
    return () => {
      if (element) element.inert = false;
      events.forEach((name) => document.removeEventListener(name, blockOutsideManager, true));
    };
  }, [pending]);
  useEffect(
    () => () => {
      attempt.current?.abort();
      setSessionFrozen(false);
    },
    []
  );

  const connect = async (profile: ConnectionProfile, secret: string) => {
    if (pending) return;
    if (!secret.trim()) {
      setEditing(profile);
      setKey('');
      setError('');
      return;
    }
    if (hasActiveWrites() || useNotificationStore.getState().confirmation.isLoading) {
      setError(t('connections.busy'));
      return;
    }
    if (hasSessionChanges() && !window.confirm(t('connections.discard'))) return;
    const controller = new AbortController();
    attempt.current?.abort();
    attempt.current = controller;
    setSessionFrozen(true);
    setPending(true);
    setError('');
    try {
      await probeConnection(profile.apiBase, secret, controller.signal);
      if (attempt.current !== controller || controller.signal.aborted) return;
      if (hasActiveWrites()) throw new Error('busy');
      const next = {
        ...profile,
        lastUsedAt: Date.now(),
        ...(profile.rememberPassword ? { managementKey: secret.trim() } : {}),
      };
      saveProfile(next);
      prepareHandoff(next, secret.trim(), safeSessionPath(location.pathname), profileId);
      // 不改变旧文档的 client。重建整个文档，销毁页面叠层、store、轮询和旧回调。
      window.location.reload();
    } catch {
      if (attempt.current === controller) {
        if (!controller.signal.aborted) setError(t('connections.failed', { name: profile.name }));
        setSessionFrozen(false);
        setPending(false);
      }
    }
  };
  useEffect(() => {
    connectRef.current = connect;
  });

  const edit = (profile: ConnectionProfile) => {
    setEditing({ ...profile });
    setKey(profile.managementKey || '');
    setError('');
  };
  const save = () => {
    if (!editing || !editing.name.trim()) {
      setError(t('connections.invalid'));
      return;
    }
    try {
      const next = {
        ...editing,
        name: editing.name.trim(),
        apiBase: validateConnectionBase(editing.apiBase),
        managementKey: key.trim(),
      };
      saveProfile(next);
      refresh();
      setEditing(null);
      setKey('');
      setError('');
    } catch {
      setError(t('connections.invalid'));
    }
  };
  const cancel = () => {
    attempt.current?.abort();
    attempt.current = null;
    setSessionFrozen(false);
    setPending(false);
    setEditing(null);
    setKey('');
    setError('');
    setOpen(false);
  };
  const previous = profiles.find(
    (profile) => profile.id === sessionStorage.getItem('cpa-previous-profile')
  );

  return (
    <div className={styles.shell}>
      <div className={styles.bar}>
        <button
          className={styles.selector}
          onClick={() => {
            refresh();
            setOpen(true);
          }}
          aria-label={t('connections.switch')}
        >
          <strong>{current?.name || apiBase || t('connections.choose')}</strong>
          {current?.environment && <span className={styles.tag}>{current.environment}</span>}
          <span aria-hidden="true">▾</span>
        </button>
        <span className={styles.status} data-status={status}>
          {t(`connections.${status}`)}
        </span>
      </div>
      <div ref={host} className={styles.host}>
        {children}
      </div>
      <Modal
        className="connection-manager-modal"
        open={open}
        title={t('connections.title')}
        onClose={cancel}
        closeDisabled={pending}
        width={620}
      >
        <div className={styles.body}>
          <p className={styles.hint}>{t('connections.hint')}</p>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          )}
          {pending && <p role="status">{t('connections.switching')}</p>}
          {editing ? (
            <>
              <Input
                label={t('connections.name')}
                value={editing.name}
                disabled={pending}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
              <Input
                label={t('connections.address')}
                value={editing.apiBase}
                disabled={pending}
                onChange={(event) => setEditing({ ...editing, apiBase: event.target.value })}
                placeholder="https://core.example.com"
              />
              <Input
                label={t('connections.environment')}
                value={editing.environment}
                disabled={pending}
                onChange={(event) => setEditing({ ...editing, environment: event.target.value })}
              />
              <Input
                label={t('login.management_key_label')}
                type="password"
                autoComplete="off"
                value={key}
                disabled={pending}
                onChange={(event) => setKey(event.target.value)}
              />
              <SelectionCheckbox
                checked={editing.rememberPassword}
                disabled={pending}
                onChange={(rememberPassword) => setEditing({ ...editing, rememberPassword })}
                label={t('login.remember_password_label')}
              />
              <p className={styles.hint}>{t('connections.key_hint')}</p>
              <div className={styles.actions}>
                <Button disabled={pending} onClick={save}>
                  {t('connections.save')}
                </Button>
                <Button
                  disabled={pending || !editing.name.trim() || !key.trim()}
                  onClick={() => void connect(editing, key)}
                >
                  {t('connections.connect')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setEditing(null);
                    setKey('');
                    setError('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Input
                label={t('connections.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={pending}
              />
              <div className={styles.list}>
                {[...profiles]
                  .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
                  .filter((profile) =>
                    `${profile.name} ${profile.apiBase} ${profile.environment}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                  )
                  .map((profile) => (
                    <div className={styles.row} key={profile.id}>
                      <button
                        className={styles.target}
                        disabled={
                          pending ||
                          (authenticated && profile.id === profileId && profile.apiBase === apiBase)
                        }
                        onClick={() => void connect(profile, profile.managementKey || '')}
                      >
                        <strong>
                          {profile.name}
                          {profile.environment ? ` · ${profile.environment}` : ''}
                        </strong>
                        <span>{profile.apiBase}</span>
                        <small>
                          {authenticated && profile.id === profileId
                            ? t('connections.current')
                            : profile.lastUsedAt
                              ? t('connections.last_used', {
                                  time: new Date(profile.lastUsedAt).toLocaleString(),
                                })
                              : t('connections.unchecked')}
                        </small>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => edit(profile)}
                      >
                        {t('connections.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending || (authenticated && profile.id === profileId)}
                        onClick={() => {
                          if (
                            window.confirm(t('connections.delete_confirm', { name: profile.name }))
                          ) {
                            deleteProfile(profile.id);
                            refresh();
                          }
                        }}
                      >
                        {t('connections.remove')}
                      </Button>
                    </div>
                  ))}
              </div>
              <div className={styles.actions}>
                <Button disabled={pending} onClick={() => edit(newProfile())}>
                  {t('connections.add')}
                </Button>
                {previous && previous.id !== profileId && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void connect(previous, previous.managementKey || '')}
                  >
                    {t('connections.previous')}
                  </Button>
                )}
              </div>
            </>
          )}
          {pending && (
            <Button variant="secondary" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}
