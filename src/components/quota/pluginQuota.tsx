import type { AntigravityQuotaBucket, PluginQuotaState } from '@/types';
import type { QuotaConfig } from './quotaConfigs';
import { fetchPluginQuota, type PluginQuotaData } from '@/services/api/pluginQuota';
import { isPluginQuotaFile, isDisabledAuthFile } from '@/utils/quota';
import i18n from '@/i18n';
import pageStyles from '@/pages/QuotaPage.module.scss';
import styles from './pluginQuota.module.scss';

const COPILOT_BUCKETS = new Map([
  ['chat', { labelKey: 'chat', descriptionPrefix: 'Chat: ' }],
  ['completions', { labelKey: 'completions', descriptionPrefix: 'Completions: ' }],
  [
    'premium_interactions',
    {
      labelKey: 'premium_interactions',
      descriptionPrefix: 'Premium interactions: ',
    },
  ],
]);

// Copilot 的不限量和数额目前由 description 承载，只拆解已知格式。
const copilotBucketDetail = (bucket: AntigravityQuotaBucket) => {
  const definition = bucket.window ? COPILOT_BUCKETS.get(bucket.window) : undefined;
  const description = bucket.description;
  if (!definition || !description?.startsWith(definition.descriptionPrefix)) {
    return { description, unlimited: false };
  }
  const detail = description.slice(definition.descriptionPrefix.length);
  return { description: detail, unlimited: detail === 'unlimited' };
};

const resetDate = (value: string | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

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
  sectionClassName: styles.section,
  cardClassName: styles.card,
  controlsClassName: pageStyles.antigravityControls,
  controlClassName: pageStyles.antigravityControl,
  gridClassName: styles.grid,
  renderQuotaItems: (quota, t, { QuotaProgressBar }) => {
    const plan =
      quota.subscription?.tierName || quota.subscription?.plan || quota.subscription?.tierId;
    const language = i18n.resolvedLanguage || i18n.language;
    const number = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
    const dateTime = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const copilot = quota.groups.some((group) => group.id === 'copilot-usage');
    const renderReset = (date: Date) => (
      <time className={styles.reset} dateTime={date.toISOString()}>
        {t('plugin_quota.reset_at', { time: dateTime.format(date) })}
      </time>
    );

    return (
      <div className={styles.content}>
        {plan && (
          <div className={styles.plan}>
            <span>{t('plugin_quota.plan_label')}</span>
            <span className={styles.planValue}>{plan}</span>
          </div>
        )}
        {quota.summary.length > 0 && (
          <div className={styles.summary}>
            {quota.summary.map((metric) => {
              const copilotMetric =
                copilot && metric.key.endsWith('_remaining')
                  ? COPILOT_BUCKETS.get(metric.key.slice(0, -'_remaining'.length))
                  : undefined;
              return (
                <div key={metric.key} className={styles.metric}>
                  <span className={styles.metricLabel}>
                    {copilotMetric
                      ? t(`plugin_quota.copilot.${copilotMetric.labelKey}_remaining`)
                      : metric.label}
                  </span>
                  <span className={styles.metricAmount}>
                    <strong>
                      {metric.format === 'currency' && metric.currency
                        ? new Intl.NumberFormat(language, {
                            style: 'currency',
                            currency: metric.currency,
                          }).format(metric.value)
                        : number.format(metric.value)}
                    </strong>
                    {metric.unit && (
                      <span className={styles.metricUnit}>
                        {metric.unit === 'requests' ? t('plugin_quota.request_unit') : metric.unit}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {!plan && !quota.summary.length && !quota.groups.length && (
          <div className={styles.empty}>{t('plugin_quota.empty_data')}</div>
        )}
        {quota.groups.map((group) => {
          const isCopilot = group.id === 'copilot-usage';
          const firstReset = resetDate(group.buckets[0]?.resetTime);
          const commonReset =
            firstReset &&
            group.buckets.every(
              (bucket) => resetDate(bucket.resetTime)?.getTime() === firstReset.getTime()
            )
              ? firstReset
              : null;
          return (
            <div key={group.id} className={styles.group}>
              <div className={styles.groupTitle}>
                {isCopilot ? t('plugin_quota.copilot.usage') : group.label}
              </div>
              {group.description && <p className={styles.description}>{group.description}</p>}
              {group.buckets.map((bucket) => {
                const definition =
                  isCopilot && bucket.window ? COPILOT_BUCKETS.get(bucket.window) : undefined;
                const label = definition
                  ? t(`plugin_quota.copilot.${definition.labelKey}`)
                  : bucket.label;
                const detail = isCopilot
                  ? copilotBucketDetail(bucket)
                  : { description: bucket.description, unlimited: false };
                const percent = Math.round(bucket.remainingFraction * 100);
                const remaining = t('plugin_quota.remaining_percent', { percent });
                const reset = !commonReset ? resetDate(bucket.resetTime) : null;
                return (
                  <div key={bucket.id} className={styles.bucket}>
                    <div className={styles.bucketHeader}>
                      <span className={styles.bucketLabel}>{label}</span>
                      <span className={detail.unlimited ? styles.unlimited : styles.remaining}>
                        {detail.unlimited ? t('plugin_quota.unlimited') : remaining}
                      </span>
                    </div>
                    {!detail.unlimited && (
                      <div
                        role="meter"
                        aria-label={label}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        aria-valuetext={remaining}
                      >
                        <QuotaProgressBar
                          percent={percent}
                          highThreshold={70}
                          mediumThreshold={30}
                        />
                      </div>
                    )}
                    {detail.description && !detail.unlimited && (
                      <div className={styles.description}>{detail.description}</div>
                    )}
                    {reset && renderReset(reset)}
                  </div>
                );
              })}
              {commonReset && <div className={styles.groupReset}>{renderReset(commonReset)}</div>}
            </div>
          );
        })}
      </div>
    );
  },
};
