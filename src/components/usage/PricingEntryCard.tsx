import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconDollarSign, IconSettings } from '@/components/ui/icons';
import {
  formatCompactNumber,
  formatUsd,
  getApiCoverageDisplay,
  hasUnknownBillingUsage,
  isApiUsdEstimateComplete,
  type PricingCoverage,
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface PricingEntryCardProps {
  coverage: PricingCoverage;
  onOpen: () => void;
}

export function PricingEntryCard({ coverage, onOpen }: PricingEntryCardProps) {
  const { t } = useTranslation();
  const apiCoverageDisplay = getApiCoverageDisplay(coverage);
  const requestPercent = apiCoverageDisplay.requestPercent ?? 0;
  const hasUnknownBilling = hasUnknownBillingUsage(coverage);
  const pricingComplete = isApiUsdEstimateComplete(coverage);

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
          <span>{t('usage_stats.pricing_api_usd_estimate')}</span>
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
          {t('usage_stats.pricing_api_models_covered', {
            priced: coverage.apiPricedModels,
            total: coverage.apiTokenUsdModels,
          })}
        </span>
        <span>
          {apiCoverageDisplay.requestPercent === null
            ? t('usage_stats.pricing_no_api_requests')
            : t('usage_stats.pricing_api_requests_covered', {
                priced: coverage.pricedRequests,
                total: coverage.apiTokenUsdRequests,
                percent: apiCoverageDisplay.requestPercent.toFixed(1),
              })}
        </span>
        <span>
          {t('usage_stats.pricing_credit_requests', {
            count: coverage.chatGptCreditRequests,
          })}
        </span>
        <span>
          {t('usage_stats.pricing_unknown_requests', {
            count: coverage.unknownBillingRequests,
          })}
        </span>
        {!pricingComplete && (coverage.apiTokenUsdRequests > 0 || hasUnknownBilling) && (
          <span>{t('usage_stats.pricing_cost_incomplete')}</span>
        )}
        {coverage.unknownBillingTokens > 0 && (
          <span>
            {t('usage_stats.pricing_unknown_tokens', {
              count: coverage.unknownBillingTokens,
              tokens: formatCompactNumber(coverage.unknownBillingTokens),
            })}
          </span>
        )}
      </div>
    </Card>
  );
}
