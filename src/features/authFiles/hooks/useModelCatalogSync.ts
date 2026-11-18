import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { modelsApi } from '@/services/api';
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
  const [syncingModelCatalog, setSyncingModelCatalog] = useState(false);
  const pendingRef = useRef(false);
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

  const syncModelCatalog = useCallback(async () => {
    if (pendingRef.current || useAuthStore.getState().connectionStatus !== 'connected') return;
    pendingRef.current = true;
    if (mountedRef.current) setSyncingModelCatalog(true);
    try {
      const { stale, changedProviders } = await modelsApi.refreshCatalog();
      if (stale || !mountedRef.current) return;
      useModelsStore.getState().clearCache();
      onSyncedRef.current();
      showNotification(
        changedProviders.length
          ? t('auth_files.sync_catalog_success', { providers: changedProviders.join(', ') })
          : t('auth_files.sync_catalog_unchanged'),
        'success'
      );
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      showNotification(
        `${t('auth_files.sync_catalog_failed')}: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setSyncingModelCatalog(false);
    }
  }, [showNotification, t]);

  return { syncingModelCatalog, syncModelCatalog };
}
