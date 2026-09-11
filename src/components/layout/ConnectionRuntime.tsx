import { useEffect, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getManagedConnection } from '@/services/connectionRuntime';
import { hasActiveWrites, hasSessionChanges } from '@/services/connectionSession';
import { probeConnection } from '@/services/api/connectionProbe';
import { ConnectionSwitcher } from './ConnectionSwitcher';
import styles from './PanelShell.module.scss';

export function ConnectionRuntime({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const connection = getManagedConnection();
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const status = useAuthStore((state) => state.connectionStatus);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!connection) return;
    const { id, host } = connection;
    const report = () =>
      host.report(
        id,
        window,
        useAuthStore.getState().connectionStatus,
        window.location.hash.slice(1) || '/'
      );
    const open = (event: Event) => {
      const requested: unknown = (event as CustomEvent).detail?.profileId;
      host.open(id, window, typeof requested === 'string' ? requested : undefined);
    };
    host.register(id, window, {
      inspect: () => ({
        dirty: hasSessionChanges(),
        busy: hasActiveWrites() || useNotificationStore.getState().confirmation.isLoading,
      }),
    });
    const unsubscribe = useAuthStore.subscribe(report);
    window.addEventListener('hashchange', report);
    window.addEventListener('cpa-open-connections', open);
    let alive = true;
    void useAuthStore
      .getState()
      .restoreSession()
      .finally(() => {
        if (alive) setStarted(true);
        report();
      });
    return () => {
      alive = false;
      unsubscribe();
      host.register(id, window, null);
      window.removeEventListener('hashchange', report);
      window.removeEventListener('cpa-open-connections', open);
    };
  }, [connection]);

  useEffect(() => {
    if (!authenticated || !connection) return;
    let controller: AbortController | null = null;
    // 管理 API 是 HTTP；低频认证探测用于区分“保持连接”和实际可达状态。
    const timer = window.setInterval(() => {
      if (controller) return;
      controller = new AbortController();
      const signal = controller.signal;
      const { apiBase, managementKey } = useAuthStore.getState();
      void probeConnection(apiBase, managementKey, signal)
        .then(
          () => {
            if (!signal.aborted) useAuthStore.getState().updateConnectionStatus('connected');
          },
          () => {
            if (!signal.aborted) useAuthStore.getState().updateConnectionStatus('error');
          }
        )
        .finally(() => {
          controller = null;
        });
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [authenticated, connection]);

  if (!connection) return <div className={styles.empty}>{t('connections.frame_unavailable')}</div>;
  if (started && authenticated) return children;
  return (
    <div className={styles.empty}>
      <h2>{connection.bootstrap.profile.name}</h2>
      <p role={status === 'error' ? 'alert' : 'status'}>
        {t(status === 'error' ? 'connections.failed' : 'connections.switching', {
          name: connection.bootstrap.profile.name,
        })}
      </p>
      <div className={styles.fallbackSwitcher}>
        <ConnectionSwitcher />
      </div>
    </div>
  );
}
