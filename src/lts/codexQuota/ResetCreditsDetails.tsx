import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { IconInfo, IconRefreshCw } from '@/components/ui/icons';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { QuotaResetAction } from '@/components/quota/QuotaCard';
import type { CodexRateLimitResetCredit } from '@/types';
import { formatUnixTimestamp } from '@/utils/format';
import { normalizeStringValue } from '@/utils/quota';
import {
  getCodexResetCreditStatus,
  getCodexResetCreditValue,
  getEarliestCodexResetCreditExpiry,
  isCodexResetCreditAvailable,
  sortCodexResetCredits,
} from './resetCredits';
import codexQuotaStyles from './styles.module.scss';

type CodexResetCreditsDetailsButtonProps = {
  credits: CodexRateLimitResetCredit[];
  availableCount: number | null;
  t: TFunction;
  resetQuotaAction?: QuotaResetAction;
};

const formatCodexResetCreditTimestamp = (
  value: unknown,
  t: TFunction,
  emptyKey = 'codex_quota.reset_credits_missing_value'
): string => {
  const formatted = formatUnixTimestamp(value);
  return formatted || t(emptyKey);
};

const formatCodexResetCreditText = (value: unknown, t: TFunction): string =>
  normalizeStringValue(value) ?? t('codex_quota.reset_credits_missing_value');

// LTS-owned reset credit details dialog. Keep it out of quota config to reduce
// upstream selective-port conflicts around Codex quota display logic.
export const CodexResetCreditsDetailsButton = ({
  credits,
  availableCount,
  t,
  resetQuotaAction,
}: CodexResetCreditsDetailsButtonProps): ReactNode => {
  const [open, setOpen] = React.useState(false);
  const { createElement: h } = React;
  const sortedCredits = React.useMemo(() => sortCodexResetCredits(credits), [credits]);

  if (sortedCredits.length === 0 && !resetQuotaAction) return null;

  const available = availableCount ?? sortedCredits.filter(isCodexResetCreditAvailable).length;
  const earliestExpiryLabel = formatCodexResetCreditTimestamp(
    getEarliestCodexResetCreditExpiry(sortedCredits),
    t
  );

  const renderSummaryMetric = (
    key: string,
    labelKey: string,
    value: string | number,
    tone?: 'strong'
  ): ReactNode =>
    h(
      'div',
      { key, className: codexQuotaStyles.codexResetCreditsSummaryMetric },
      h('span', { className: codexQuotaStyles.codexResetCreditsSummaryLabel }, t(labelKey)),
      h(
        'span',
        {
          className:
            tone === 'strong'
              ? `${codexQuotaStyles.codexResetCreditsSummaryValue} ${codexQuotaStyles.codexResetCreditsSummaryValueStrong}`
              : codexQuotaStyles.codexResetCreditsSummaryValue,
        },
        String(value)
      )
    );

  const renderField = (
    key: string,
    labelKey: string,
    value: string,
    options?: { long?: boolean }
  ): ReactNode =>
    h(
      'div',
      { key, className: codexQuotaStyles.codexResetCreditField },
      h('span', { className: codexQuotaStyles.codexResetCreditFieldLabel }, t(labelKey)),
      h(
        'span',
        {
          className: [
            codexQuotaStyles.codexResetCreditFieldValue,
            options?.long ? codexQuotaStyles.codexResetCreditFieldValueLong : '',
          ]
            .filter(Boolean)
            .join(' '),
        },
        value
      )
    );

  const renderTimelineItem = (key: string, labelKey: string, value: string): ReactNode =>
    h(
      'div',
      { key, className: codexQuotaStyles.codexResetCreditTimelineItem },
      h('span', { className: codexQuotaStyles.codexResetCreditTimelineDot, 'aria-hidden': true }),
      h(
        'span',
        { className: codexQuotaStyles.codexResetCreditTimelineBody },
        h('span', { className: codexQuotaStyles.codexResetCreditTimelineLabel }, t(labelKey)),
        h('span', { className: codexQuotaStyles.codexResetCreditTimelineValue }, value)
      )
    );

  return h(
    React.Fragment,
    null,
    h(
      Button,
      {
        type: 'button',
        variant: 'ghost',
        size: 'sm',
        className: codexQuotaStyles.codexResetCreditsDetailsButton,
        onClick: () => setOpen(true),
        title: t('codex_quota.reset_credits_details_button'),
        'aria-label': t('codex_quota.reset_credits_details_button'),
      },
      h(IconInfo, { size: 13 })
    ),
    h(
      Modal,
      {
        open,
        onClose: () => setOpen(false),
        title: t('codex_quota.reset_credits_details_title'),
        width: 760,
        className: codexQuotaStyles.codexResetCreditsModal,
        footer: h(
          React.Fragment,
          null,
          h(
            Button,
            { type: 'button', variant: 'ghost', size: 'sm', onClick: () => setOpen(false) },
            t('common.close')
          ),
          resetQuotaAction
            ? h(
                Button,
                {
                  type: 'button',
                  variant: 'danger',
                  size: 'sm',
                  onClick: () => {
                    setOpen(false);
                    resetQuotaAction.onClick();
                  },
                  disabled: resetQuotaAction.disabled,
                  loading: resetQuotaAction.loading,
                  title: t('codex_quota.reset_button'),
                  'aria-label': t('codex_quota.reset_button'),
                },
                !resetQuotaAction.loading ? h(IconRefreshCw, { size: 14 }) : null,
                t('codex_quota.reset_button')
              )
            : null
        ),
      },
      h(
        'div',
        { className: codexQuotaStyles.codexResetCreditsPanel },
        h(
          'div',
          { className: codexQuotaStyles.codexResetCreditsSummary },
          renderSummaryMetric(
            'available',
            'codex_quota.reset_credits_summary_available',
            available,
            'strong'
          ),
          renderSummaryMetric(
            'records',
            'codex_quota.reset_credits_summary_records',
            sortedCredits.length
          ),
          renderSummaryMetric(
            'earliest',
            'codex_quota.reset_credits_summary_earliest_expiry',
            earliestExpiryLabel
          )
        ),
        h(
          'div',
          { className: codexQuotaStyles.codexResetCreditList },
          ...sortedCredits.map((credit, index) => {
            const status = getCodexResetCreditStatus(credit);
            const title =
              normalizeStringValue(credit.title) ??
              t('codex_quota.reset_credits_credit_title', { index: index + 1 });
            const description = normalizeStringValue(credit.description);
            const id = normalizeStringValue(credit.id);
            const resetType = formatCodexResetCreditText(
              credit.reset_type ?? credit.resetType,
              t
            );
            const grantedAt = formatCodexResetCreditTimestamp(
              getCodexResetCreditValue(credit, 'granted_at', 'grantedAt'),
              t
            );
            const expiresAt = formatCodexResetCreditTimestamp(
              getCodexResetCreditValue(credit, 'expires_at', 'expiresAt'),
              t
            );
            const redeemStartedAt = formatCodexResetCreditTimestamp(
              getCodexResetCreditValue(credit, 'redeem_started_at', 'redeemStartedAt'),
              t,
              'codex_quota.reset_credits_not_started'
            );
            const redeemedAt = formatCodexResetCreditTimestamp(
              getCodexResetCreditValue(credit, 'redeemed_at', 'redeemedAt'),
              t,
              'codex_quota.reset_credits_not_redeemed'
            );
            const profileUserId = normalizeStringValue(
              credit.profile_user_id ?? credit.profileUserId
            );
            const profileImageUrl = normalizeStringValue(
              credit.profile_image_url ?? credit.profileImageUrl
            );
            const sequence = `#${String(index + 1).padStart(2, '0')}`;

            return h(
              'article',
              {
                key: id ?? `credit-${index}`,
                className: [
                  codexQuotaStyles.codexResetCreditCard,
                  isCodexResetCreditAvailable(credit)
                    ? codexQuotaStyles.codexResetCreditCardAvailable
                    : '',
                ]
                  .filter(Boolean)
                  .join(' '),
              },
              h(
                'div',
                { className: codexQuotaStyles.codexResetCreditCardHeader },
                h(
                  'div',
                  { className: codexQuotaStyles.codexResetCreditTitleArea },
                  h(
                    'div',
                    { className: codexQuotaStyles.codexResetCreditTopline },
                    h('span', { className: codexQuotaStyles.codexResetCreditIndex }, sequence),
                    h(
                      'span',
                      {
                        className: [
                          codexQuotaStyles.codexResetCreditStatus,
                          isCodexResetCreditAvailable(credit)
                            ? codexQuotaStyles.codexResetCreditStatusAvailable
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' '),
                      },
                      status
                    )
                  ),
                  h('span', { className: codexQuotaStyles.codexResetCreditTitle }, title)
                ),
                h(
                  'div',
                  { className: codexQuotaStyles.codexResetCreditExpiryCallout },
                  h(
                    'span',
                    { className: codexQuotaStyles.codexResetCreditExpiryLabel },
                    t('codex_quota.reset_credits_expires_at')
                  ),
                  h('span', { className: codexQuotaStyles.codexResetCreditExpiryValue }, expiresAt)
                )
              ),
              description
                ? h(
                    'p',
                    { className: codexQuotaStyles.codexResetCreditDescription },
                    description
                  )
                : null,
              h(
                'div',
                { className: codexQuotaStyles.codexResetCreditTimeline },
                renderTimelineItem('granted-at', 'codex_quota.reset_credits_granted_at', grantedAt),
                renderTimelineItem(
                  'redeem-started-at',
                  'codex_quota.reset_credits_redeem_started_at',
                  redeemStartedAt
                ),
                renderTimelineItem('redeemed-at', 'codex_quota.reset_credits_redeemed_at', redeemedAt)
              ),
              h(
                'div',
                { className: codexQuotaStyles.codexResetCreditFields },
                renderField('reset-type', 'codex_quota.reset_credits_type', resetType),
                id
                  ? renderField('id', 'codex_quota.reset_credits_id', id, { long: true })
                  : null,
                profileUserId
                  ? renderField(
                      'profile-user-id',
                      'codex_quota.reset_credits_profile_user_id',
                      profileUserId,
                      { long: true }
                    )
                  : null,
                profileImageUrl
                  ? renderField(
                      'profile-image-url',
                      'codex_quota.reset_credits_profile_image_url',
                      profileImageUrl,
                      { long: true }
                    )
                  : null
              )
            );
          })
        )
      )
    )
  );
};
