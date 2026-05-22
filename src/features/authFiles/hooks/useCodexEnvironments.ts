import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { codexEnvironmentsApi, type CodexRemoteEnvironment } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';

type CodexEnvironmentsState = {
  open: boolean;
  file: AuthFileItem | null;
  fileName: string;
  loading: boolean;
  error: string | null;
  environments: CodexRemoteEnvironment[];
  truncated: boolean;
};

const initialState: CodexEnvironmentsState = {
  open: false,
  file: null,
  fileName: '',
  loading: false,
  error: null,
  environments: [],
  truncated: false,
};

export function useCodexEnvironments() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [state, setState] = useState<CodexEnvironmentsState>(initialState);

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
        const result = await codexEnvironmentsApi.list(file);
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
        const status = getStatusFromError(err);
        const message =
          status === 401
            ? t('auth_files.codex_env_auth_required')
            : status === 403
              ? t('auth_files.codex_env_permission_denied')
              : status === 404
                ? t('auth_files.codex_env_unsupported')
                : status === 429
                  ? t('auth_files.codex_env_rate_limited')
                  : err instanceof Error
                    ? err.message
                    : t('common.unknown_error');
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
          t('auth_files.codex_env_load_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [showNotification, t]
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
      });
      void load(file);
    },
    [load]
  );

  const refresh = useCallback(() => {
    if (!state.file) return;
    void load(state.file);
  }, [load, state.file]);

  const close = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    codexEnvironments: state,
    openCodexEnvironments: open,
    refreshCodexEnvironments: refresh,
    closeCodexEnvironments: close,
  };
}
