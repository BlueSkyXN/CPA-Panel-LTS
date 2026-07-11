import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore } from '@/stores';
import styles from './PluginRuntimeUnavailable.module.scss';

export function PluginRuntimeUnavailable() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pluginSupportSource = useAuthStore((state) => state.pluginSupportSource);
  const descriptionKey =
    pluginSupportSource === 'header'
      ? 'plugin_management.runtime_unavailable_desc'
      : 'plugin_management.runtime_probe_failed_desc';

  return (
    <div className={styles.root}>
      <EmptyState
        title={t('plugin_management.runtime_unavailable_title')}
        description={t(descriptionKey)}
        action={
          <Button
            className={styles.action}
            variant="secondary"
            onClick={() => navigate('/config')}
          >
            {t('plugin_management.runtime_unavailable_action')}
          </Button>
        }
      />
    </div>
  );
}
