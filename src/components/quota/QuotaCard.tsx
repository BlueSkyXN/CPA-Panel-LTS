/**
 * Generic quota card component.
 */

import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaStatus = 'idle' | 'loading' | 'success' | 'error';

export interface QuotaStatusState {
  status: QuotaStatus;
  error?: string;
  errorStatus?: number;
}

export interface QuotaProgressBarProps {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
}

export interface QuotaResetAction {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
}: QuotaProgressBarProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? styles.quotaBarFillMedium
      : normalized >= highThreshold
        ? styles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? styles.quotaBarFillMedium
          : styles.quotaBarFillLow;
  const widthPercent = Math.round(normalized ?? 0);

  return (
    <div className={styles.quotaBar}>
      <div
        className={`${styles.quotaBarFill} ${fillClass}`}
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

export interface QuotaRenderHelpers {
  styles: typeof styles;
  QuotaProgressBar: (props: QuotaProgressBarProps) => ReactElement;
  resetQuotaAction?: QuotaResetAction;
}

interface QuotaCardProps<TState extends QuotaStatusState> {
  item: AuthFileItem;
  quota?: TState;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  cardClassName: string;
  defaultType: string;
  canRefresh?: boolean;
  onRefresh?: () => void;
  resetQuotaAction?: QuotaResetAction;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

export function QuotaCard<TState extends QuotaStatusState>({
  item,
  quota,
  i18nPrefix,
  cardIdleMessageKey,
  cardClassName,
  defaultType,
  canRefresh = false,
  onRefresh,
  resetQuotaAction,
  renderQuotaItems,
}: QuotaCardProps<TState>) {
  const { t } = useTranslation();

  const displayType = item.type || item.provider || defaultType;
  const typeLabel = getTypeLabel(t, displayType);
  const iconSrc = getAuthFileIcon(displayType);

  const quotaStatus = quota?.status ?? 'idle';
  const quotaLoading = quotaStatus === 'loading';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const idleMessageKey = onRefresh
    ? `${i18nPrefix}.idle`
    : (cardIdleMessageKey ?? `${i18nPrefix}.idle`);

  return (
    <div className={`${styles.fileCard} ${cardClassName}`} role="article">
      <div className={styles.cardHeader}>
        <span
          className={styles.providerIconWrap}
          title={typeLabel}
          style={
            isThemeSurfaceIconProvider(displayType)
              ? { background: getThemeSurfaceIconBackground() }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.providerIcon} />
          ) : (
            <span className={styles.providerIconFallback}>
              {typeLabel.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className={styles.cardIdentity}>
          <span className={styles.fileName} title={item.name}>
            {item.name}
          </span>
          <span className={styles.providerName}>{typeLabel}</span>
        </span>
      </div>

      <div className={styles.quotaSection}>
        {quotaLoading ? (
          <div className={styles.quotaSkeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${i18nPrefix}.loading`)}</span>
            {[0, 1].map((row) => (
              <span key={row} className={styles.quotaSkeletonRow} aria-hidden="true">
                <span className={styles.quotaSkeletonLabel} />
                <span className={styles.quotaSkeletonTrack} />
              </span>
            ))}
          </div>
        ) : quotaStatus === 'idle' ? (
          onRefresh ? (
            <button
              type="button"
              className={styles.quotaIdleAction}
              onClick={onRefresh}
              disabled={!canRefresh}
            >
              <IconRefreshCw size={15} aria-hidden="true" />
              <span>{t(idleMessageKey)}</span>
            </button>
          ) : (
            <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
          )
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError} role="alert">
            {t(`${i18nPrefix}.load_failed`, {
              message: quotaErrorMessage,
            })}
          </div>
        ) : quota ? (
          renderQuotaItems(quota, t, { styles, QuotaProgressBar, resetQuotaAction })
        ) : (
          <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
        )}
      </div>

      {onRefresh && quotaStatus !== 'idle' && (
        <div className={styles.quotaCardActions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={styles.quotaRefreshButton}
            onClick={onRefresh}
            disabled={!canRefresh || quotaLoading}
            loading={quotaLoading}
            title={t('auth_files.quota_refresh_hint')}
          >
            {!quotaLoading && <IconRefreshCw size={14} />}
            {t('auth_files.quota_refresh_single')}
          </Button>
        </div>
      )}
    </div>
  );
}

const resolveQuotaErrorMessage = (
  t: TFunction,
  status: number | undefined,
  fallback: string
): string => {
  if (status === 404) return t('common.quota_update_required');
  if (status === 403) return t('common.quota_check_credential');
  return fallback;
};
