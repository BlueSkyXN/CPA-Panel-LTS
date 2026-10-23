import type { DevinQuotaData, DevinQuotaState, MetaQuotaData, MetaQuotaState } from '@/types';
import type { QuotaConfig } from './quotaConfigs';
import { apiCallApi } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { isDisabledAuthFile, resolveAuthProvider, createStatusError } from '@/utils/quota';
import { createDevinQuotaFetcher, DevinQuotaError } from './devinRequests';
import { createMetaQuotaFetcher, MetaQuotaError } from './metaRequests';
import styles from '@/pages/QuotaPage.module.scss';

const fetchDevin = createDevinQuotaFetcher({
  request: (payload) => apiCallApi.request(payload),
  generation: (name) => {
    const state = useQuotaStore.getState();
    return {
      session: JSON.stringify([apiClient.getConnectionRevision(), state.cacheGeneration]),
      file: state.fileGenerations[name] ?? 0,
    };
  },
});
const fetchMeta = createMetaQuotaFetcher({
  request: (payload) => apiCallApi.request(payload),
  downloadText: (name) => authFilesApi.downloadText(name),
  captureCurrent: (name) => {
    const revision = apiClient.getConnectionRevision();
    const generation = captureQuotaCacheGeneration(name);
    return () =>
      revision === apiClient.getConnectionRevision() &&
      commitIfQuotaCacheCurrent(generation, () => {});
  },
});
const layout = {
  cardClassName: styles.kimiCard,
  controlsClassName: styles.kimiControls,
  controlClassName: styles.kimiControl,
  gridClassName: styles.kimiGrid,
};

export const DEVIN_CONFIG: QuotaConfig<DevinQuotaState, DevinQuotaData> = {
  ...layout,
  type: 'devin',
  i18nPrefix: 'devin_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'devin' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t) => {
    try {
      return await fetchDevin(file);
    } catch (error) {
      if (error instanceof DevinQuotaError) throw new Error(t(`devin_quota.${error.code}`));
      throw error;
    }
  },
  batchConcurrency: 3,
  storeSelector: (state) => state.devinQuota,
  storeSetter: 'setDevinQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({ status: 'error', error, errorStatus }),
  renderQuotaItems: (quota, t, { styles: css, QuotaProgressBar }) => (
    <>
      {quota.data?.plan && <div className={css.quotaMeta}>{quota.data.plan}</div>}
      {quota.data?.planEndMs && (
        <div className={css.quotaMeta}>
          {t('alignment_quota.plan_end')}: {new Date(quota.data.planEndMs).toLocaleString()}
        </div>
      )}
      {quota.data?.windows.map((window) => (
        <div className={css.quotaRow} key={window.id}>
          <div className={css.quotaRowHeader}>
            <span>{t(`alignment_quota.${window.id}`)}</span>
            <span>
              {window.remainingPercent === null
                ? t('alignment_quota.unknown')
                : t('alignment_quota.remaining', { percent: window.remainingPercent })}
            </span>
          </div>
          <QuotaProgressBar
            percent={window.remainingPercent}
            highThreshold={70}
            mediumThreshold={30}
          />
          {window.resetAtMs && (
            <div>
              {t('alignment_quota.resets')}: {new Date(window.resetAtMs).toLocaleString()}
            </div>
          )}
        </div>
      ))}
    </>
  ),
};

export const META_CONFIG: QuotaConfig<MetaQuotaState, MetaQuotaData> = {
  ...layout,
  type: 'meta',
  i18nPrefix: 'meta_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'meta' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t) => {
    try {
      return await fetchMeta(file);
    } catch (error) {
      if (error instanceof MetaQuotaError)
        throw createStatusError(t(`meta_quota.${error.code}`), error.status);
      throw error;
    }
  },
  storeSelector: (state) => state.metaQuota,
  storeSetter: 'setMetaQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({ status: 'error', error, errorStatus }),
  renderQuotaItems: (quota, t, { styles: css, QuotaProgressBar }) => (
    <>
      {quota.data?.planName && <div className={css.quotaMeta}>{quota.data.planName}</div>}
      {quota.data?.isSubscriptionActive !== undefined && (
        <div className={css.quotaMeta}>
          {t(
            quota.data.isSubscriptionActive ? 'alignment_quota.active' : 'alignment_quota.inactive'
          )}
        </div>
      )}
      {quota.data?.windows.map((window) => (
        <div className={css.quotaRow} key={window.id}>
          <div className={css.quotaRowHeader}>
            <span>
              {window.durationMinutes
                ? t('alignment_quota.minutes', { count: window.durationMinutes })
                : t(`alignment_quota.${window.id}`)}
            </span>
            <span>
              {window.usedPercent === null
                ? t('alignment_quota.unknown')
                : t('alignment_quota.remaining', { percent: 100 - window.usedPercent })}
            </span>
          </div>
          <QuotaProgressBar
            percent={window.usedPercent === null ? null : 100 - window.usedPercent}
            highThreshold={70}
            mediumThreshold={30}
          />
          {window.resetAt && (
            <div>
              {t('alignment_quota.resets')}: {new Date(window.resetAt * 1000).toLocaleString()}
            </div>
          )}
        </div>
      ))}
    </>
  ),
};
