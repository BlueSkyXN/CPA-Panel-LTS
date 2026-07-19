import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconDollarSign, IconSettings } from '@/components/ui/icons';
import { formatUsd, type PricingCoverage } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface PricingEntryCardProps {
  coverage: PricingCoverage;
  onOpen: () => void;
}

export function PricingEntryCard({ coverage, onOpen }: PricingEntryCardProps) {
  const { t } = useTranslation();
  const requestPercent = coverage.pricedRequestRatio * 100;
  const modelPercent = coverage.pricedModelRatio * 100;

  return (
    <Card className={styles.pricingEntryCard}>
      <div className={styles.pricingEntryMain}>
        <div className={styles.pricingEntryIcon} aria-hidden="true">
          <IconDollarSign size={20} />
        </div>
        <div className={styles.pricingEntryCopy}>
          <div className={styles.pricingEntryTitle}>{t('usage_stats.pricing_entry_title')}</div>
          <div className={styles.pricingEntryDescription}>
            {t('usage_stats.pricing_entry_description')}
          </div>
        </div>
        <div className={styles.pricingEntryAmount}>
          <span>{t('usage_stats.total_cost')}</span>
          <strong>
            {coverage.pricedRequests > 0 ? formatUsd(coverage.estimatedAmount) : '--'}
          </strong>
        </div>
        <Button variant="secondary" onClick={onOpen}>
          <IconSettings size={16} />
          {t('usage_stats.pricing_open')}
        </Button>
      </div>
      <div className={styles.pricingCoverageRail} aria-hidden="true">
        <span style={{ width: `${Math.min(Math.max(requestPercent, 0), 100)}%` }} />
      </div>
      <div className={styles.pricingEntryMeta}>
        <span>
          {t('usage_stats.pricing_models_covered', {
            priced: coverage.pricedModels,
            total: coverage.totalModels,
          })}
        </span>
        <span>
          {t('usage_stats.pricing_requests_covered', { percent: requestPercent.toFixed(1) })}
        </span>
        <span>{t('usage_stats.pricing_models_ratio', { percent: modelPercent.toFixed(1) })}</span>
      </div>
    </Card>
  );
}
