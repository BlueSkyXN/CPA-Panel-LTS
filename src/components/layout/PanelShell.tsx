import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useLanguageStore, useThemeStore } from '@/stores';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  readProfiles,
  saveProfile,
  deleteProfile,
  validateConnectionBase,
  type ConnectionProfile,
} from '@/services/storage/connectionProfiles';
import {
  connectionFrameDocument,
  connectionFrameUrl,
  type ConnectionControls,
  type ConnectionHost,
} from '@/services/connectionRuntime';
import { safeSessionPath } from '@/services/connectionSession';
import { generateId, isRecord } from '@/utils/helpers';
import { isSupportedLanguage } from '@/utils/language';
import { normalizeTheme } from '@/stores/useThemeStore';
import type { ConnectionStatus } from '@/types';
import { apiClient } from '@/services/api/client';
import styles from './PanelShell.module.scss';

const WORKSPACE_KEY = 'cpa-connection-workspace-v1';
type Session = {
  id: string;
  profile: ConnectionProfile;
  secret: string;
  status: ConnectionStatus;
  path: string;
  url: string;
  document?: string;
  activateWhenReady: boolean;
};

function makeSession(
  profile: ConnectionProfile,
  secret: string,
  path: string,
  activateWhenReady = false
): Session {
  const id = generateId();
  return {
    id,
    profile: { ...profile, managementKey: undefined },
    secret,
    status: 'connecting',
    path,
    url: connectionFrameUrl(id, path),
    document: connectionFrameDocument(id, path),
    activateWhenReady,
  };
}

function restoreWorkspace() {
  const profiles = readProfiles();
  const hash = window.location.hash.slice(1);
  const path = hash.startsWith('/') && !hash.startsWith('//') && hash !== '/login' ? hash : '/';
  const raw = sessionStorage.getItem(WORKSPACE_KEY);
  if (raw) {
    try {
      const stored: unknown = JSON.parse(raw);
      if (isRecord(stored) && Array.isArray(stored.enabled)) {
        const seen = new Set<string>();
        const sessions = stored.enabled.flatMap((item): Session[] => {
          if (!isRecord(item) || typeof item.profileId !== 'string' || seen.has(item.profileId))
            return [];
          seen.add(item.profileId);
          const profile = profiles.find((entry) => entry.id === item.profileId);
          if (!profile?.managementKey) return [];
          const route =
            item.profileId === stored.activeId
              ? path
              : safeSessionPath(typeof item.path === 'string' ? item.path : '/');
          return [makeSession(profile, profile.managementKey, route)];
        });
        return {
          sessions,
          activeId: typeof stored.activeId === 'string' ? stored.activeId : '',
          started: true,
        };
      }
    } catch {
      /* 损坏的布局记录不影响旧连接档案。 */
    }
  }
  const auth = useAuthStore.getState();
  const profile = profiles.find(
    (item) => item.id === auth.profileId && item.apiBase === auth.apiBase
  );
  if (profile && auth.managementKey && sessionStorage.getItem('isLoggedIn') === 'true') {
    return {
      sessions: [makeSession(profile, auth.managementKey, path)],
      activeId: profile.id,
      started: true,
    };
  }
  return { sessions: [] as Session[], activeId: profile?.id || '', started: false };
}

export function PanelShell({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [initial, clearInitial] = useState<ReturnType<typeof restoreWorkspace> | null>(
    restoreWorkspace
  );
  const [sessions, setSessions] = useState(initial?.sessions || []);
  const sessionsRef = useRef(sessions);
  const [activeId, setActiveId] = useState(initial?.activeId || '');
  const activeRef = useRef(activeId);
  const [started, setStarted] = useState(initial?.started || false);
  const selectionIntent = useRef('');
  const [profiles, setProfiles] = useState(readProfiles);
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [activateAfterEdit, setActivateAfterEdit] = useState(true);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const controls = useRef(new Map<string, ConnectionControls>());
  const startupTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const focusReturn = useRef<HTMLElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = sessions.find((session) => session.profile.id === activeId);
  const currentProfile = current?.profile || profiles.find((profile) => profile.id === activeId);
  const unavailable = current?.status === 'error' && !controls.current.has(current.id);

  const commit = (next: Session[]) => {
    sessionsRef.current = next;
    setSessions(next);
  };
  const select = (profileId: string) => {
    selectionIntent.current = '';
    activeRef.current = profileId;
    setActiveId(profileId);
    const session = sessionsRef.current.find((item) => item.profile.id === profileId);
    if (session) window.history.replaceState(null, '', `#${session.path}`);
  };
  const refresh = () => setProfiles(readProfiles());
  const closeMenu = () => {
    setOpen(false);
    setManaging(false);
    setSearch('');
    setError('');
    requestAnimationFrame(() => {
      const selected = sessionsRef.current.find((item) => item.profile.id === activeRef.current);
      const target =
        selected &&
        frames.current
          .get(selected.id)
          ?.contentDocument?.querySelector<HTMLElement>('[data-connection-switcher]');
      (target || focusReturn.current)?.focus();
    });
  };
  const edit = (profile: ConnectionProfile, activate = true) => {
    setEditing({ ...profile });
    setKey(profile.managementKey || '');
    setActivateAfterEdit(activate);
    setError('');
    setOpen(false);
  };
  const connect = (profile: ConnectionProfile, secret: string, activate: boolean) => {
    if (sessionsRef.current.some((item) => item.profile.id === profile.id)) {
      if (activate) {
        select(profile.id);
        closeMenu();
      }
      return;
    }
    if (!secret.trim()) {
      edit(profile, activate);
      return;
    }
    try {
      const next = {
        ...profile,
        name: profile.name.trim(),
        apiBase: validateConnectionBase(profile.apiBase),
        managementKey: secret.trim(),
        lastUsedAt: Date.now(),
      };
      if (!next.name) throw new Error('Invalid name');
      saveProfile(next);
      refresh();
      const path = activate ? safeSessionPath(current?.path || '/') : '/';
      commit([...sessionsRef.current, makeSession(next, secret.trim(), path, activate)]);
      setStarted(true);
      if (
        !activeRef.current ||
        !sessionsRef.current.some((item) => item.profile.id === activeRef.current)
      )
        select(profile.id);
      if (activate) selectionIntent.current = profile.id;
      setEditing(null);
      setKey('');
      setError('');
    } catch {
      setError(t('connections.invalid'));
    }
  };
  const disconnect = (session: Session) => {
    const inspection = controls.current.get(session.id)?.inspect();
    if (inspection?.busy) {
      setOpen(true);
      setError(t('connections.busy'));
      return;
    }
    if (
      inspection?.dirty &&
      !window.confirm(t('connections.disconnect_confirm', { name: session.profile.name }))
    )
      return;
    controls.current.delete(session.id);
    commit(sessionsRef.current.filter((item) => item.id !== session.id));
    setError('');
  };

  // 同源运行上下文按 iframe Window 校验归属，不共享单例 client/store 或密钥持久化。
  const hostRef = useRef<ConnectionHost | null>(null);
  hostRef.current = {
    bootstrap: (id, source) => {
      const session = sessionsRef.current.find((item) => item.id === id);
      return session && frames.current.get(id)?.contentWindow === source
        ? { profile: session.profile, managementKey: session.secret }
        : null;
    },
    report: (id, source, status, path) => {
      if (frames.current.get(id)?.contentWindow !== source) return;
      const session = sessionsRef.current.find((item) => item.id === id);
      if (!session) return;
      const route = path.startsWith('/') && !path.startsWith('//') ? path : '/';
      const ready =
        session.activateWhenReady &&
        status === 'connected' &&
        selectionIntent.current === session.profile.id;
      if (session.status !== status || session.path !== route || ready) {
        commit(
          sessionsRef.current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status,
                  path: route,
                  activateWhenReady: ready ? false : item.activateWhenReady,
                }
              : item
          )
        );
      }
      if (ready) {
        select(session.profile.id);
        closeMenu();
      } else if (session.profile.id === activeRef.current)
        window.history.replaceState(null, '', `#${route}`);
    },
    register: (id, source, control) => {
      if (frames.current.get(id)?.contentWindow !== source) return;
      if (control) controls.current.set(id, control);
      else controls.current.delete(id);
    },
    open: (id, source, requestedId) => {
      if (
        frames.current.get(id)?.contentWindow !== source ||
        !sessionsRef.current.some((item) => item.id === id)
      )
        return;
      const language = source.document.documentElement.lang;
      if (isSupportedLanguage(language)) useLanguageStore.getState().setLanguage(language);
      useThemeStore
        .getState()
        .setTheme(normalizeTheme(source.document.documentElement.dataset.theme));
      focusReturn.current = source.document.activeElement as HTMLElement | null;
      refresh();
      setOpen(true);
      setError('');
      if (requestedId) {
        const profile = readProfiles().find((item) => item.id === requestedId);
        if (profile) connect(profile, profile.managementKey || '', true);
      }
    },
    disconnect: (id, source) => {
      if (frames.current.get(id)?.contentWindow !== source) return;
      const session = sessionsRef.current.find((item) => item.id === id);
      if (session) disconnect(session);
    },
  };
  useLayoutEffect(() => {
    const host: ConnectionHost = {
      bootstrap: (...args) => hostRef.current!.bootstrap(...args),
      report: (...args) => hostRef.current!.report(...args),
      register: (...args) => hostRef.current!.register(...args),
      open: (...args) => hostRef.current!.open(...args),
      disconnect: (...args) => hostRef.current!.disconnect(...args),
    };
    window.__cpaConnectionHost = host;
    return () => {
      if (window.__cpaConnectionHost === host) delete window.__cpaConnectionHost;
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    clearInitial(null);
    // 初次登录交给独立运行上下文后，外壳不再持有一份认证客户端或密钥。
    apiClient.clearConfig();
    useAuthStore.setState({ managementKey: '', isAuthenticated: false });
  }, [started]);
  useEffect(() => {
    for (const session of sessions) {
      if (controls.current.has(session.id) || startupTimers.current.has(session.id)) continue;
      startupTimers.current.set(
        session.id,
        setTimeout(() => {
          if (!controls.current.has(session.id)) {
            const next = sessionsRef.current.map((item) =>
              item.id === session.id ? { ...item, status: 'error' as const } : item
            );
            sessionsRef.current = next;
            setSessions(next);
          }
        }, 20_000)
      );
    }
    for (const [id, timer] of startupTimers.current) {
      if (!sessions.some((session) => session.id === id) || controls.current.has(id)) {
        clearTimeout(timer);
        startupTimers.current.delete(id);
      }
    }
  }, [sessions]);
  useEffect(() => {
    const timers = startupTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!started) return;
    // 只保存连接开关和安全路由；未记住的密钥不会写入 workspace 记录。
    sessionStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({
        activeId,
        enabled: sessions.map((session) => ({
          profileId: session.profile.id,
          path: safeSessionPath(session.path),
        })),
      })
    );
  }, [sessions, activeId, started]);
  useEffect(() => {
    if (started) return;
    return useAuthStore.subscribe((auth) => {
      if (!auth.isAuthenticated) return;
      const profile = readProfiles().find((item) => item.id === auth.profileId);
      if (!profile || sessionsRef.current.length) return;
      const next = makeSession(profile, auth.managementKey, '/');
      sessionsRef.current = [next];
      setSessions([next]);
      activeRef.current = profile.id;
      setActiveId(profile.id);
      setProfiles(readProfiles());
      setStarted(true);
    });
  }, [started]);
  useEffect(() => {
    const show = () => {
      setProfiles(readProfiles());
      setOpen(true);
      setError('');
    };
    const refreshProfiles = () => setProfiles(readProfiles());
    const navigate = () => {
      const session = sessionsRef.current.find((item) => item.profile.id === activeRef.current);
      const frame = session && frames.current.get(session.id);
      if (frame?.contentWindow) frame.contentWindow.location.hash = window.location.hash;
    };
    const leave = (event: BeforeUnloadEvent) => {
      if (
        [...controls.current.values()].some((control) => {
          const state = control.inspect();
          return state.dirty || state.busy;
        })
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('storage', refreshProfiles);
    window.addEventListener('cpa-open-connections', show);
    window.addEventListener('hashchange', navigate);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('storage', refreshProfiles);
      window.removeEventListener('cpa-open-connections', show);
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [open]);

  const save = () => {
    if (!editing?.name.trim()) {
      setError(t('connections.invalid'));
      return;
    }
    try {
      saveProfile({
        ...editing,
        name: editing.name.trim(),
        apiBase: validateConnectionBase(editing.apiBase),
        managementKey: key.trim(),
      });
      refresh();
      setEditing(null);
      setKey('');
      setError('');
      setOpen(true);
      setManaging(true);
    } catch {
      setError(t('connections.invalid'));
    }
  };
  const add = () =>
    edit({ id: generateId(), name: '', apiBase: '', environment: '', rememberPassword: false });

  return (
    <div className={styles.shell}>
      {!started && (
        <div className={styles.host} inert={open || Boolean(editing)}>
          {children}
        </div>
      )}
      {sessions.map((session) => (
        <iframe
          key={session.id}
          src={session.url}
          srcDoc={session.document}
          title={session.profile.name}
          data-connection-frame={session.profile.id}
          data-active={session.profile.id === activeId}
          className={styles.frame}
          aria-hidden={session.profile.id !== activeId}
          inert={session.profile.id !== activeId || open || Boolean(editing)}
          ref={(element) => {
            if (element) frames.current.set(session.id, element);
            else frames.current.delete(session.id);
          }}
        />
      ))}
      {started && (!current || unavailable) && (
        <div className={styles.empty}>
          <h2>{currentProfile?.name || t('connections.title')}</h2>
          <p role={unavailable ? 'alert' : undefined}>
            {t(unavailable ? 'connections.frame_unavailable' : 'connections.off_hint')}
          </p>
          <Button
            onClick={() => {
              refresh();
              setOpen(true);
            }}
          >
            {t('connections.choose')}
          </Button>
        </div>
      )}
      {(!current || unavailable) && (
        <div className={styles.fallbackSwitcher}>
          <button
            className={styles.selector}
            aria-label={t('connections.switch')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={(event) => {
              focusReturn.current = event.currentTarget;
              refresh();
              setOpen(true);
            }}
          >
            <span className={styles.instanceIcon}>C</span>
            <span className={styles.selectorText}>
              <strong>{currentProfile?.name || t('connections.choose')}</strong>
              <small>{t('connections.disconnected')}</small>
            </span>
            <span aria-hidden="true">⌃</span>
          </button>
        </div>
      )}
      {open && (
        <div
          className={styles.menuBackdrop}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeMenu();
          }}
        >
          <div
            ref={menu}
            className={styles.menu}
            role="dialog"
            aria-modal="true"
            aria-label={t('connections.title')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
              }
              if (event.key === 'Tab') {
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled)'
                  ),
                ];
                const first = items[0],
                  last = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                }
                if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className={styles.menuHeader}>
              <strong>{t('connections.title')}</strong>
              <Button variant="ghost" size="sm" onClick={closeMenu} aria-label={t('common.close')}>
                ×
              </Button>
            </div>
            <Input
              label={t('connections.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <p className={styles.hint}>{t('connections.hint')}</p>
            {error && (
              <div role="alert" className={styles.error}>
                {error}
              </div>
            )}
            <div className={styles.list}>
              {profiles
                .filter((profile) =>
                  `${profile.name} ${profile.apiBase} ${profile.environment}`
                    .toLowerCase()
                    .includes(search.toLowerCase())
                )
                .map((profile) => {
                  const session = sessions.find((item) => item.profile.id === profile.id);
                  return (
                    <div
                      key={profile.id}
                      className={styles.row}
                      data-current={profile.id === activeId}
                    >
                      <div className={styles.rowMain}>
                        <button
                          className={styles.target}
                          onClick={() => connect(profile, profile.managementKey || '', true)}
                          aria-current={profile.id === activeId ? 'true' : undefined}
                        >
                          <strong>
                            {profile.name}
                            {profile.id === activeId && (
                              <span className={styles.currentMark}>✓</span>
                            )}
                          </strong>
                          <span title={profile.apiBase}>
                            {profile.environment || profile.apiBase}
                          </span>
                          <small>
                            <i
                              className={styles.dot}
                              data-status={session?.status || 'disconnected'}
                            />
                            {t(`connections.${session?.status || 'disconnected'}`)}
                          </small>
                        </button>
                        <ToggleSwitch
                          checked={Boolean(session)}
                          ariaLabel={t('connections.keep_connected', { name: profile.name })}
                          onChange={(enabled) => {
                            if (enabled) connect(profile, profile.managementKey || '', false);
                            else if (session) disconnect(session);
                          }}
                        />
                      </div>
                      {session?.status === 'error' && (
                        <p className={styles.hint} role="alert">
                          {t('connections.retry_hint')}
                        </p>
                      )}
                      {managing && (
                        <div className={styles.actions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(session)}
                            onClick={() => edit(profile)}
                          >
                            {t('connections.edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(session)}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t('connections.delete_confirm', { name: profile.name })
                                )
                              ) {
                                deleteProfile(profile.id);
                                refresh();
                              }
                            }}
                          >
                            {t('connections.remove')}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
            {managing && <p className={styles.hint}>{t('connections.edit_hint')}</p>}
            <div className={styles.menuFooter}>
              <Button variant="ghost" size="sm" onClick={add}>
                {t('connections.add')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setManaging(!managing)}>
                {t(managing ? 'common.back' : 'connections.manage')}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Modal
        className="connection-manager-modal"
        open={Boolean(editing)}
        title={t('connections.title')}
        width={520}
        onClose={() => {
          setEditing(null);
          setKey('');
          setError('');
          setOpen(true);
        }}
      >
        {editing && (
          <div className={styles.body}>
            <Input
              label={t('connections.name')}
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
            <Input
              label={t('connections.address')}
              value={editing.apiBase}
              onChange={(event) => setEditing({ ...editing, apiBase: event.target.value })}
              placeholder="https://core.example.com"
            />
            <Input
              label={t('connections.environment')}
              value={editing.environment}
              onChange={(event) => setEditing({ ...editing, environment: event.target.value })}
            />
            <Input
              label={t('login.management_key_label')}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <SelectionCheckbox
              checked={editing.rememberPassword}
              onChange={(rememberPassword) => setEditing({ ...editing, rememberPassword })}
              label={t('login.remember_password_label')}
            />
            <p className={styles.hint}>{t('connections.key_hint')}</p>
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
            <div className={styles.actions}>
              <Button variant="secondary" onClick={save}>
                {t('connections.save')}
              </Button>
              <Button
                disabled={!editing.name.trim() || !key.trim()}
                onClick={() => connect(editing, key, activateAfterEdit)}
              >
                {t('connections.connect')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
