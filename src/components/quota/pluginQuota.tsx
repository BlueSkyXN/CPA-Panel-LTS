import type { PluginQuotaState } from '@/types';
import type { QuotaConfig } from './quotaConfigs';
import { fetchPluginQuota, type PluginQuotaData } from '@/services/api/pluginQuota';
import { isPluginQuotaFile, isDisabledAuthFile } from '@/utils/quota';
import styles from '@/pages/QuotaPage.module.scss';
export const PLUGIN_CONFIG: QuotaConfig<PluginQuotaState, PluginQuotaData> = {
  type: 'plugin',
  i18nPrefix: 'plugin_quota',
  filterFn: (file) => isPluginQuotaFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchPluginQuota,
  storeSelector: (state) => state.pluginQuota,
  storeSetter: 'setPluginQuota',
  buildLoadingState: () => ({ status: 'loading', groups: [], subscription: null, summary: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    groups: [],
    subscription: null,
    summary: [],
    error,
    errorStatus,
  }),
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: (quota, t, { styles: classes, QuotaProgressBar }) => {
    const plan =
      quota.subscription?.tierName || quota.subscription?.plan || quota.subscription?.tierId;
    return (
      <>
        {plan && (
          <div className={classes.quotaMeta}>
            {t('plugin_quota.plan_label')}: {plan}
          </div>
        )}
        {quota.summary.map((metric) => (
          <div key={metric.key} className={classes.quotaRowHeader}>
            <span>{metric.label}</span>
            <span>
              {metric.format === 'currency' && metric.currency
                ? new Intl.NumberFormat(undefined, {
                    style: 'currency',
                    currency: metric.currency,
                  }).format(metric.value)
                : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
                    metric.value
                  )}
              {metric.unit ? ` ${metric.unit}` : ''}
            </span>
          </div>
        ))}
        {!plan && !quota.summary.length && !quota.groups.length && (
          <div className={classes.quotaMessage}>{t('plugin_quota.empty_data')}</div>
        )}
        {quota.groups.map((group) => (
          <div key={group.id} className={classes.antigravityQuotaGroup}>
            <div className={classes.antigravityQuotaGroupHeader}>{group.label}</div>
            {group.description && (
              <div className={classes.antigravityQuotaGroupDescription}>{group.description}</div>
            )}
            {group.buckets.map((bucket) => (
              <div key={bucket.id} className={classes.quotaRow}>
                <div className={classes.quotaRowHeader}>
                  <span>{bucket.label}</span>
                  <span>
                    {t('plugin_quota.remaining_percent', {
                      percent: Math.round(bucket.remainingFraction * 100),
                    })}
                  </span>
                  <span>
                    {bucket.resetTime ? new Date(bucket.resetTime).toLocaleString() : '-'}
                  </span>
                </div>
                <QuotaProgressBar
                  percent={bucket.remainingFraction * 100}
                  highThreshold={70}
                  mediumThreshold={30}
                />
              </div>
            ))}
          </div>
        ))}
      </>
    );
  },
};
