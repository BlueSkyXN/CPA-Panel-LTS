import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { copyToClipboard } from '@/utils/clipboard';
import {
  CODING_PLAN_MAC_API_KEY_COMMANDS,
  CODING_PLAN_MAC_DEVICE_ID_COMMAND,
  isMacOSClient,
} from '../codingPlanLocalCredentials';
import styles from './CodingPlanLocalCredentialsHelp.module.scss';

export function CodingPlanLocalCredentialsHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(isMacOSClient);
  const [region, setRegion] = useState<keyof typeof CODING_PLAN_MAC_API_KEY_COMMANDS>('bigmodel');
  const [copyStatus, setCopyStatus] = useState('');

  const copyCommand = async (command: string) => {
    const copied = await copyToClipboard(command);
    setCopyStatus(copied ? 'copy_success' : 'copy_failed');
  };

  const commands = [
    { label: t('pat_accounts.api_key_label'), command: CODING_PLAN_MAC_API_KEY_COMMANDS[region] },
    { label: t('pat_accounts.device_id_label'), command: CODING_PLAN_MAC_DEVICE_ID_COMMAND },
  ];

  return (
    <details
      className={styles.help}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t('pat_accounts.local_credentials.title')}</summary>
      <div className={styles.content}>
        <p>{t('pat_accounts.local_credentials.instructions')}</p>
        <Select
          value={region}
          ariaLabel={t('pat_accounts.local_credentials.region')}
          options={[
            { value: 'bigmodel', label: t('pat_accounts.local_credentials.bigmodel') },
            { value: 'zai', label: t('pat_accounts.local_credentials.zai') },
          ]}
          onChange={(value) => {
            if (value === 'bigmodel' || value === 'zai') {
              setRegion(value);
              setCopyStatus('');
            }
          }}
        />
        <p>{t('pat_accounts.local_credentials.region_hint')}</p>
        {commands.map(({ label, command }) => (
          <div key={label} className={styles.command}>
            <div className={styles.commandHeader}>
              <strong>{label}</strong>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={t('pat_accounts.local_credentials.copy_label', { field: label })}
                onClick={() => void copyCommand(command)}
              >
                {t('pat_accounts.local_credentials.copy')}
              </Button>
            </div>
            <code>{command}</code>
          </div>
        ))}
        {copyStatus && (
          <p role="status" aria-live="polite">
            {t(`pat_accounts.local_credentials.${copyStatus}`)}
          </p>
        )}
        <p className={styles.warning}>{t('pat_accounts.local_credentials.warning')}</p>
        <p>{t('pat_accounts.local_credentials.troubleshooting')}</p>
      </div>
    </details>
  );
}
