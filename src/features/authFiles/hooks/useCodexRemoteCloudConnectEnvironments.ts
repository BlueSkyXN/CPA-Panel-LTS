import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  codexRemoteCloudConnectEnvironmentsApi,
  type CodexRemoteCloudConnectEnvironment,
} from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';

type CodexRemoteCloudConnectEnvironmentsState = {
  open: boolean;
  file: AuthFileItem | null;
  fileName: string;
  loading: boolean;
  error: string | null;
  environments: CodexRemoteCloudConnectEnvironment[];
  truncated: boolean;
  deletingId: string | null;
};

const initialState: CodexRemoteCloudConnectEnvironmentsState = {
  open: false,
  file: null,
  fileName: '',
  loading: false,
  error: null,
  environments: [],
  truncated: false,
  deletingId: null,
};

export function useCodexRemoteCloudConnectEnvironments() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [state, setState] = useState<CodexRemoteCloudConnectEnvironmentsState>(initialState);

  const getFailureMessage = useCallback(
    (err: unknown) => {
      const status = getStatusFromError(err);
      if (status === 401)
        return t('auth_files.codex_remote_cloud_connect_environment_auth_required');
      if (status === 403)
        return t('auth_files.codex_remote_cloud_connect_environment_permission_denied');
      if (status === 404) return t('auth_files.codex_remote_cloud_connect_environment_unsupported');
      if (status === 429)
        return t('auth_files.codex_remote_cloud_connect_environment_rate_limited');
      if (status === 502)
        return t('auth_files.codex_remote_cloud_connect_environment_invalid_response');
      return err instanceof Error ? err.message : t('common.unknown_error');
    },
    [t]
  );

  const load = useCallback(
    async (file: AuthFileItem) => {
      setState((current) => ({
        ...current,
        file,
        fileName: file.name,
        loading: true,
        error: null,
        truncated: false,
      }));

      try {
        const result = await codexRemoteCloudConnectEnvironmentsApi.list(file);
        setState((current) => ({
          ...current,
          file,
          fileName: file.name,
          loading: false,
          error: null,
          environments: result.environments,
          truncated: result.truncated,
        }));
      } catch (err: unknown) {
        const message = getFailureMessage(err);
        setState((current) => ({
          ...current,
          file,
          fileName: file.name,
          loading: false,
          error: message,
          environments: [],
          truncated: false,
        }));
        showNotification(
          t('auth_files.codex_remote_cloud_connect_environment_load_failed', {
            name: file.name,
            message,
          }),
          'error'
        );
      }
    },
    [getFailureMessage, showNotification, t]
  );

  const open = useCallback(
    (file: AuthFileItem) => {
      setState({
        open: true,
        file,
        fileName: file.name,
        loading: true,
        error: null,
        environments: [],
        truncated: false,
        deletingId: null,
      });
      void load(file);
    },
    [load]
  );

  const refresh = useCallback(() => {
    if (!state.file) return;
    void load(state.file);
  }, [load, state.file]);

  const deleteRemoteCloudConnectEnvironment = useCallback(
    (environment: CodexRemoteCloudConnectEnvironment) => {
      const file = state.file;
      if (!file) return;

      showConfirmation({
        title: t('auth_files.codex_remote_cloud_connect_environment_delete_title'),
        message: t('auth_files.codex_remote_cloud_connect_environment_delete_message', {
          name: environment.name,
          envId: environment.envId,
        }),
        variant: 'danger',
        confirmText: t('auth_files.codex_remote_cloud_connect_environment_delete_confirm_button'),
        onConfirm: async () => {
          setState((current) => ({
            ...current,
            deletingId: environment.envId,
          }));
          try {
            await codexRemoteCloudConnectEnvironmentsApi.remove(file, environment.envId);
            showNotification(
              t('auth_files.codex_remote_cloud_connect_environment_delete_success', {
                name: environment.name,
              }),
              'success'
            );
            await load(file);
          } catch (err: unknown) {
            const message = getFailureMessage(err);
            showNotification(
              t('auth_files.codex_remote_cloud_connect_environment_delete_failed', { message }),
              'error'
            );
          } finally {
            setState((current) => ({
              ...current,
              deletingId: null,
            }));
          }
        },
      });
    },
    [getFailureMessage, load, showConfirmation, showNotification, state.file, t]
  );

  const close = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    codexRemoteCloudConnectEnvironments: state,
    openCodexRemoteCloudConnectEnvironments: open,
    refreshCodexRemoteCloudConnectEnvironments: refresh,
    closeCodexRemoteCloudConnectEnvironments: close,
    deleteCodexRemoteCloudConnectEnvironment: deleteRemoteCloudConnectEnvironment,
  };
}
