import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';

type ModelsError = 'unsupported' | null;

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsError: ModelsError;
  showModels: (item: AuthFileItem) => Promise<void>;
  closeModelsModal: () => void;
  invalidateModels: (names?: string[]) => void;
};

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const modelsCacheRef = useRef<Map<string, AuthFileModelItem[]>>(new Map());
  const modelsCacheVersionRef = useRef(0);
  const modelsFileVersionRef = useRef<Map<string, number>>(new Map());
  const activeModelsRequestIdRef = useRef(0);

  const closeModelsModal = useCallback(() => {
    activeModelsRequestIdRef.current += 1;
    setModelsModalOpen(false);
    setModelsLoading(false);
  }, []);

  const invalidateModels = useCallback((names?: string[]) => {
    if (!names) {
      modelsCacheRef.current.clear();
      modelsFileVersionRef.current.clear();
      modelsCacheVersionRef.current += 1;
      return;
    }
    new Set(names.map((name) => name.trim()).filter(Boolean)).forEach((name) => {
      modelsCacheRef.current.delete(name);
      modelsFileVersionRef.current.set(name, (modelsFileVersionRef.current.get(name) ?? 0) + 1);
    });
  }, []);

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      const cacheKey = item.name.trim();
      const requestId = ++activeModelsRequestIdRef.current;

      setModelsFileName(item.name);
      setModelsFileType(item.type || '');
      setModelsList([]);
      setModelsError(null);
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(cacheKey);
      if (cached) {
        setModelsList(cached);
        setModelsLoading(false);
        return;
      }

      const cacheVersion = modelsCacheVersionRef.current;
      const fileVersion = modelsFileVersionRef.current.get(cacheKey) ?? 0;
      const isCacheCurrent = () =>
        cacheVersion === modelsCacheVersionRef.current &&
        fileVersion === (modelsFileVersionRef.current.get(cacheKey) ?? 0);
      const isRequestCurrent = () => requestId === activeModelsRequestIdRef.current;

      setModelsLoading(true);
      try {
        let models = await authFilesApi.getModelsForAuthFile(item.name);
        if (isCacheCurrent()) {
          if (models.length === 0) {
            // 空快照可能是注册失败留下的（如 PAT 过期后厂商侧续期），
            // 补一次 refresh 让 Core 重新发现；旧版 Core 无此路由时保持空态。
            try {
              models = await authFilesApi.refreshModelsForAuthFile(item.name);
            } catch (err: unknown) {
              const status =
                typeof err === 'object' && err !== null && 'status' in err ? err.status : undefined;
              // 仅旧版缺少路由时保留空态，其他失败交给外层提示且不缓存。
              if (status !== 404) throw err;
            }
          }
          // refresh 期间凭据可能已更新，旧响应不能重新填回失效的缓存。
          if (!isCacheCurrent()) return;
          modelsCacheRef.current.set(cacheKey, models);
          if (isRequestCurrent()) setModelsList(models);
        }
      } catch (err) {
        if (!isRequestCurrent() || !isCacheCurrent()) return;
        const errorMessage = err instanceof Error ? err.message : '';
        if (
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        if (isRequestCurrent()) setModelsLoading(false);
      }
    },
    [showNotification, t]
  );

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
  };
}
