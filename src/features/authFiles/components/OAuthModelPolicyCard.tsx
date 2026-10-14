import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { OAuthConfigLoadError } from '@/features/authFiles/constants';
import type { OAuthModelPolicy } from '@/types';
import styles from '@/pages/AuthFilesPage.module.scss';

export type OAuthModelPolicyCardProps = {
  disableControls: boolean;
  policyError: OAuthConfigLoadError;
  policies: OAuthModelPolicy;
  onRetry: () => void | Promise<void>;
  onAdd: () => void;
  onEdit: (provider: string) => void;
};

const countEntryModels = (entry: {
  allowlist?: { models: string[] } | null;
  denylist?: { models: string[] } | null;
}): number => (entry.allowlist?.models.length ?? 0) + (entry.denylist?.models.length ?? 0);

export function OAuthModelPolicyCard(props: OAuthModelPolicyCardProps) {
  const { t } = useTranslation();
  const { disableControls, policyError, policies, onRetry, onAdd, onEdit } = props;

  return (
    <Card
      title={t('model_policy.card_title')}
      extra={
        <Button size="sm" onClick={onAdd} disabled={disableControls || policyError !== null}>
          {t('oauth_excluded.add')}
        </Button>
      }
    >
      {policyError === 'unsupported' ? (
        <EmptyState
          title={t('oauth_excluded.upgrade_required_title')}
          description={t('model_policy.upgrade_required_desc')}
        />
      ) : policyError === 'load' ? (
        <EmptyState
          title={t('notification.refresh_failed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void onRetry()}>
              {t('common.refresh')}
            </Button>
          }
        />
      ) : policyError === 'loading' ? (
        <EmptyState title={t('common.loading')} />
      ) : Object.keys(policies).length === 0 ? (
        <EmptyState
          title={t('model_policy.list_empty')}
          description={t('model_policy.card_desc')}
        />
      ) : (
        <div className={styles.excludedList}>
          {Object.entries(policies).map(([provider, entry]) => {
            const allowOn = entry?.allowlist?.enabled ?? false;
            const denyOn = entry?.denylist?.enabled ?? false;
            return (
              <div key={provider} className={styles.excludedItem}>
                <div className={styles.excludedInfo}>
                  <div className={styles.excludedProvider}>{provider}</div>
                  <div className={styles.excludedModels}>
                    {allowOn || denyOn
                      ? t('model_policy.entry_summary', {
                          count: countEntryModels(entry ?? {}),
                          allow: allowOn ? 1 : 0,
                          deny: denyOn ? 1 : 0,
                        })
                      : t('model_policy.entry_all_disabled', {
                          count: countEntryModels(entry ?? {}),
                        })}
                  </div>
                </div>
                <div className={styles.excludedActions}>
                  <Button variant="secondary" size="sm" onClick={() => onEdit(provider)}>
                    {t('common.edit')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
