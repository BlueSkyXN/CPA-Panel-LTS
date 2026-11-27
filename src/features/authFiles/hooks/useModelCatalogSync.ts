import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, modelsApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useModelsStore } from '@/stores/useModelsStore';

/**
 * Global backend catalog sync (v8 POST /models/refresh), deliberately
 * independent of per-credential refreshes. Port of upstream 99a95c4a on the
 * LTS `modelsApi.refreshCatalog` connection guard: a stale response from a
 * superseded connection resolves `stale: true` and must not update views.
 */
export function useModelCatalogSync(onSynced: () => void) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const connectionRevision = apiClient.getConnectionRevision();
  const [syncingModelCatalog, setSyncingModelCatalog] = useState(false);
  const pendingRevisionRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      pendingRevisionRef.current !== null &&
      !apiClient.isCurrentConnection(pendingRevisionRef.current)
    ) {
      pendingRevisionRef.current = null;
    }
    setSyncingModelCatalog(false);
    return () => {
      requestIdRef.current += 1;
      pendingRevisionRef.current = null;
    };
  }, [connectionRevision, connectionStatus, apiBase, managementKey]);

  const syncModelCatalog = useCallback(async () => {
    const currentRevision = apiClient.getConnectionRevision();
    if (
      pendingRevisionRef.current === currentRevision ||
      useAuthStore.getState().connectionStatus !== 'connected'
    ) {
      return;
    }
    const requestId = ++requestIdRef.current;
    pendingRevisionRef.current = currentRevision;
    if (mountedRef.current) setSyncingModelCatalog(true);
    const isCurrent = () =>
      mountedRef.current &&
      requestId === requestIdRef.current &&
      apiClient.isCurrentConnection(currentRevision);
    try {
      const { stale, changedProviders } = await modelsApi.refreshCatalog();
      if (stale || !isCurrent()) return;
      useModelsStore.getState().clearCache();
      onSyncedRef.current();
      showNotification(
        changedProviders.length
          ? t('auth_files.sync_catalog_success', { providers: changedProviders.join(', ') })
          : t('auth_files.sync_catalog_unchanged'),
        'success'
      );
    } catch (error: unknown) {
      if (!isCurrent()) return;
      showNotification(
        `${t('auth_files.sync_catalog_failed')}: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      if (
        requestId === requestIdRef.current &&
        pendingRevisionRef.current === currentRevision
      ) {
        pendingRevisionRef.current = null;
      }
      if (isCurrent()) setSyncingModelCatalog(false);
    }
  }, [showNotification, t]);

  return { syncingModelCatalog, syncModelCatalog };
}
