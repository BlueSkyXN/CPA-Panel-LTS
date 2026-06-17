import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconSatellite } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import { resolveAuthProvider } from '@/utils/quota';
import { normalizeProviderKey } from '@/features/authFiles/constants';
import type { CodexRemoteCloudConnectEnvironmentSummary } from './viewModel';
import styles from './styles.module.scss';
import pageStyles from '@/pages/AuthFilesPage.module.scss';

type CodexRemoteCloudConnectAuthFileProps = {
  file: AuthFileItem;
  isRuntimeOnly: boolean;
};

type CodexRemoteCloudConnectAuthFileSummaryProps = CodexRemoteCloudConnectAuthFileProps & {
  summary?: CodexRemoteCloudConnectEnvironmentSummary;
};

type CodexRemoteCloudConnectAuthFileActionProps = CodexRemoteCloudConnectAuthFileProps & {
  disabled: boolean;
  onOpen: (file: AuthFileItem) => void;
};

const isCodexAuthFile = (file: AuthFileItem): boolean => {
  const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  return resolveAuthProvider(file) === 'codex' || providerKey === 'codex';
};

export function CodexRemoteCloudConnectAuthFileSummary({
  file,
  isRuntimeOnly,
  summary,
}: CodexRemoteCloudConnectAuthFileSummaryProps) {
  const { t } = useTranslation();

  if (isRuntimeOnly || !summary || !isCodexAuthFile(file)) return null;

  return (
    <div className={styles.codexRemoteCloudConnectEnvironmentCardSummary}>
      {t('auth_files.codex_remote_cloud_connect_environment_card_summary', {
        count: summary.total,
        online: summary.online,
        cleanable: summary.cleanable,
      })}
    </div>
  );
}

export function CodexRemoteCloudConnectAuthFileAction({
  file,
  isRuntimeOnly,
  disabled,
  onOpen,
}: CodexRemoteCloudConnectAuthFileActionProps) {
  const { t } = useTranslation();

  if (isRuntimeOnly || !isCodexAuthFile(file)) return null;

  return (
    <div className={pageStyles.cardHeaderActions}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onOpen(file)}
        className={styles.codexRemoteCloudConnectEnvironmentHeaderButton}
        title={t('auth_files.codex_remote_cloud_connect_environment_button')}
        aria-label={t('auth_files.codex_remote_cloud_connect_environment_button')}
        disabled={disabled}
      >
        <IconSatellite className={pageStyles.actionIcon} size={16} />
      </Button>
    </div>
  );
}

export type { CodexRemoteCloudConnectEnvironmentSummary };
