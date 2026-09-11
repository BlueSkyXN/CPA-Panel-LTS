import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ConfigChoiceGroup, FieldShell, ToggleRow } from '@/components/config/ConfigFieldShells';
import { StringListEditor } from '@/components/config/VisualConfigEditorBlocks';
import type { ConfigFieldsProps } from '@/components/config/ConfigFieldControls';
import type { StandardConfigFieldId } from '@/components/config/configNavigation';
import type {
  CodexAbnormalReasoningRetryAction,
  CodexAbnormalReasoningRetryClientUsageAggregation,
  CodexAbnormalReasoningRetryDeliveryPolicy,
  CodexAbnormalReasoningRetryExhaustedBehavior,
  CodexAbnormalReasoningRetryFallbackPolicy,
  CodexAbnormalReasoningRetryHedgedRetryMode,
  VisualConfigValues,
  VisualConfigValidationErrorCode,
  PayloadParamValidationErrorCode,
} from '@/types/visualConfig';
function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

type ConfigHeaderI18nKey = `config_management.visual.sections.headers.${string}`;

const ABNORMAL_RETRY_ACTION_HINT_KEYS = {
  retry:
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_retry_desc',
  'observe-only':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_observe_only_desc',
  disabled:
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_disabled_desc',
} satisfies Record<CodexAbnormalReasoningRetryAction, ConfigHeaderI18nKey>;

const ABNORMAL_RETRY_EXHAUSTED_BEHAVIOR_HINT_KEYS = {
  error:
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_exhausted_behavior_error_desc',
  'pass-through':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_exhausted_behavior_pass_through_desc',
} satisfies Record<CodexAbnormalReasoningRetryExhaustedBehavior, ConfigHeaderI18nKey>;

const ABNORMAL_RETRY_USAGE_AGGREGATION_HINT_KEYS = {
  'delivered-only':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only_desc',
  sum: 'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_sum_desc',
  'sum-with-delivered-total':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total_desc',
} satisfies Record<CodexAbnormalReasoningRetryClientUsageAggregation, ConfigHeaderI18nKey>;

const ABNORMAL_RETRY_DELIVERY_POLICY_HINT_KEYS = {
  'best-non-special':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_best_non_special_desc',
  'first-non-special':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_first_non_special_desc',
  'max-output':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_max_output_desc',
  latest:
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_latest_desc',
} satisfies Record<CodexAbnormalReasoningRetryDeliveryPolicy, ConfigHeaderI18nKey>;

const ABNORMAL_RETRY_FALLBACK_POLICY_HINT_KEYS = {
  'best-special':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_best_special_desc',
  'max-output-special':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_max_output_special_desc',
  'latest-special':
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_latest_special_desc',
} satisfies Record<CodexAbnormalReasoningRetryFallbackPolicy, ConfigHeaderI18nKey>;

const ABNORMAL_RETRY_HEDGED_MODE_HINT_KEYS = {
  speed:
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_speed_desc',
  quality:
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_quality_desc',
} satisfies Record<CodexAbnormalReasoningRetryHedgedRetryMode, ConfigHeaderI18nKey>;

type CodexPolicyFieldId = Extract<StandardConfigFieldId, `codexAbnormalReasoningRetry${string}`>;
export function useCodexPolicyControls({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigFieldsProps): Record<CodexPolicyFieldId, ReactNode> {
  const { t } = useTranslation();
  const abnormalRetryExhaustedBehaviorLabelId = useId();
  const abnormalRetryExhaustedBehaviorHintId = `${abnormalRetryExhaustedBehaviorLabelId}-hint`;
  const abnormalRetryUsageAggregationLabelId = useId();
  const abnormalRetryUsageAggregationHintId = `${abnormalRetryUsageAggregationLabelId}-hint`;
  const abnormalRetryDeliveryPolicyLabelId = useId();
  const abnormalRetryDeliveryPolicyHintId = `${abnormalRetryDeliveryPolicyLabelId}-hint`;
  const abnormalRetryFallbackPolicyLabelId = useId();
  const abnormalRetryFallbackPolicyHintId = `${abnormalRetryFallbackPolicyLabelId}-hint`;
  const codexAbnormalReasoningRetryReasoningTokensError = getValidationMessage(
    t,
    validationErrors?.codexAbnormalReasoningRetryReasoningTokens
  );
  const codexAbnormalReasoningRetryMaxRetriesError = getValidationMessage(
    t,
    validationErrors?.codexAbnormalReasoningRetryMaxRetries
  );
  const codexAbnormalReasoningRetryStreamBufferMaxBytesError = getValidationMessage(
    t,
    validationErrors?.codexAbnormalReasoningRetryStreamBufferMaxBytes
  );
  const codexAbnormalReasoningRetryHedgeDelayMsError = getValidationMessage(
    t,
    validationErrors?.codexAbnormalReasoningRetryHedgeDelayMs
  );
  const abnormalRetryActionOptions = useMemo(
    () => [
      {
        value: 'retry',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_retry'
        ),
      },
      {
        value: 'observe-only',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_observe_only'
        ),
      },
      {
        value: 'disabled',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_disabled'
        ),
      },
    ],
    [t]
  );
  const abnormalRetryExhaustedBehaviorOptions = useMemo(
    () => [
      {
        value: 'error',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_exhausted_behavior_error'
        ),
      },
      {
        value: 'pass-through',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_exhausted_behavior_pass_through'
        ),
      },
    ],
    [t]
  );
  const abnormalRetryUsageAggregationOptions = useMemo(
    () => [
      {
        value: 'delivered-only',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_delivered_only'
        ),
      },
      {
        value: 'sum',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_sum'
        ),
      },
      {
        value: 'sum-with-delivered-total',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_sum_with_delivered_total'
        ),
      },
    ],
    [t]
  );
  const abnormalRetryDeliveryPolicyOptions = useMemo(
    () => [
      {
        value: 'best-non-special',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_best_non_special'
        ),
      },
      {
        value: 'first-non-special',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_first_non_special'
        ),
      },
      {
        value: 'max-output',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_max_output'
        ),
      },
      {
        value: 'latest',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_latest'
        ),
      },
    ],
    [t]
  );
  const abnormalRetryFallbackPolicyOptions = useMemo(
    () => [
      {
        value: 'best-special',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_best_special'
        ),
      },
      {
        value: 'max-output-special',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_max_output_special'
        ),
      },
      {
        value: 'latest-special',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_latest_special'
        ),
      },
    ],
    [t]
  );
  const abnormalRetryHedgedModeOptions = useMemo(
    () => [
      {
        value: 'quality',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_quality'
        ),
      },
      {
        value: 'speed',
        label: t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_speed'
        ),
      },
    ],
    [t]
  );
  const abnormalRetryExhaustedBehaviorHint = t(
    ABNORMAL_RETRY_EXHAUSTED_BEHAVIOR_HINT_KEYS[values.codexAbnormalReasoningRetryExhaustedBehavior]
  );
  const abnormalRetryUsageAggregationHint = t(
    ABNORMAL_RETRY_USAGE_AGGREGATION_HINT_KEYS[
      values.codexAbnormalReasoningRetryClientUsageAggregation
    ]
  );
  const abnormalRetryDeliveryPolicyHint = t(
    ABNORMAL_RETRY_DELIVERY_POLICY_HINT_KEYS[values.codexAbnormalReasoningRetryDeliveryPolicy]
  );
  const abnormalRetryFallbackPolicyHint = t(
    ABNORMAL_RETRY_FALLBACK_POLICY_HINT_KEYS[values.codexAbnormalReasoningRetryFallbackPolicy]
  );

  return {
    codexAbnormalReasoningRetryStreamBuffer: (
      <ToggleRow
        title={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer'
        )}
        description={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer_desc'
        )}
        checked={values.codexAbnormalReasoningRetryStreamBuffer}
        disabled={disabled}
        onChange={(codexAbnormalReasoningRetryStreamBuffer) =>
          onChange({ codexAbnormalReasoningRetryStreamBuffer })
        }
      />
    ),
    codexAbnormalReasoningRetryHedgedRetryEnabled: (
      <ToggleRow
        title={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_enabled'
        )}
        description={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_enabled_desc'
        )}
        checked={values.codexAbnormalReasoningRetryHedgedRetryEnabled}
        disabled={disabled}
        onChange={(codexAbnormalReasoningRetryHedgedRetryEnabled) =>
          onChange({ codexAbnormalReasoningRetryHedgedRetryEnabled })
        }
      />
    ),
    codexAbnormalReasoningRetryRequireDistinctAuth: (
      <ToggleRow
        title={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_require_distinct_auth'
        )}
        description={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_require_distinct_auth_desc'
        )}
        checked={values.codexAbnormalReasoningRetryRequireDistinctAuth}
        disabled={disabled}
        onChange={(codexAbnormalReasoningRetryRequireDistinctAuth) =>
          onChange({ codexAbnormalReasoningRetryRequireDistinctAuth })
        }
      />
    ),
    codexAbnormalReasoningRetryAction: (
      <ConfigChoiceGroup
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_label'
        )}
        value={values.codexAbnormalReasoningRetryAction}
        options={[...abnormalRetryActionOptions].reverse().map((option) => ({
          ...option,
          description: t(
            ABNORMAL_RETRY_ACTION_HINT_KEYS[option.value as CodexAbnormalReasoningRetryAction]
          ),
        }))}
        disabled={disabled}
        onChange={(nextValue) =>
          onChange({
            codexAbnormalReasoningRetryAction:
              nextValue as VisualConfigValues['codexAbnormalReasoningRetryAction'],
            codexAbnormalReasoningRetryEnabled: nextValue !== 'disabled',
          })
        }
      />
    ),
    codexAbnormalReasoningRetryStreamBufferMaxBytes: (
      <Input
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label'
        )}
        type="number"
        placeholder="16777216"
        value={values.codexAbnormalReasoningRetryStreamBufferMaxBytes}
        onChange={(e) =>
          onChange({
            codexAbnormalReasoningRetryStreamBufferMaxBytes: e.target.value,
          })
        }
        disabled={disabled}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer_max_bytes_hint'
        )}
        error={codexAbnormalReasoningRetryStreamBufferMaxBytesError}
      />
    ),
    codexAbnormalReasoningRetryHedgeDelayMs: (
      <Input
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedge_delay_ms_label'
        )}
        type="number"
        value={values.codexAbnormalReasoningRetryHedgeDelayMs}
        onChange={(e) =>
          onChange({
            codexAbnormalReasoningRetryHedgeDelayMs: e.target.value,
          })
        }
        disabled={disabled}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedge_delay_ms_hint'
        )}
        error={codexAbnormalReasoningRetryHedgeDelayMsError}
      />
    ),
    codexAbnormalReasoningRetryHedgedRetryMode: (
      <ConfigChoiceGroup
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_label'
        )}
        value={values.codexAbnormalReasoningRetryHedgedRetryMode}
        options={abnormalRetryHedgedModeOptions.map((option) => ({
          ...option,
          description: t(
            ABNORMAL_RETRY_HEDGED_MODE_HINT_KEYS[
              option.value as CodexAbnormalReasoningRetryHedgedRetryMode
            ]
          ),
        }))}
        disabled={disabled}
        onChange={(nextValue) =>
          onChange({
            codexAbnormalReasoningRetryHedgedRetryMode:
              nextValue as VisualConfigValues['codexAbnormalReasoningRetryHedgedRetryMode'],
          })
        }
      />
    ),
    codexAbnormalReasoningRetryModelContains: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_model_contains_label'
        )}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_model_contains_hint'
        )}
      >
        <StringListEditor
          value={values.codexAbnormalReasoningRetryModelContains}
          disabled={disabled}
          placeholder="gpt-5.5"
          inputAriaLabel={t(
            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_model_contains_label'
          )}
          onChange={(codexAbnormalReasoningRetryModelContains) =>
            onChange({ codexAbnormalReasoningRetryModelContains })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryReasoningEfforts: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_efforts_label'
        )}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_efforts_hint'
        )}
      >
        <StringListEditor
          value={values.codexAbnormalReasoningRetryReasoningEfforts}
          disabled={disabled}
          placeholder="xhigh"
          inputAriaLabel={t(
            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_efforts_label'
          )}
          onChange={(codexAbnormalReasoningRetryReasoningEfforts) =>
            onChange({ codexAbnormalReasoningRetryReasoningEfforts })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryReasoningTokens: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_tokens_label'
        )}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_tokens_hint'
        )}
        error={codexAbnormalReasoningRetryReasoningTokensError}
      >
        <StringListEditor
          value={values.codexAbnormalReasoningRetryReasoningTokens}
          disabled={disabled}
          placeholder="516"
          inputAriaLabel={t(
            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_reasoning_tokens_label'
          )}
          onChange={(codexAbnormalReasoningRetryReasoningTokens) =>
            onChange({ codexAbnormalReasoningRetryReasoningTokens })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryMaxRetries: (
      <Input
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_max_retries_label'
        )}
        type="number"
        placeholder="2"
        value={values.codexAbnormalReasoningRetryMaxRetries}
        onChange={(e) => onChange({ codexAbnormalReasoningRetryMaxRetries: e.target.value })}
        disabled={disabled}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_max_retries_hint'
        )}
        error={codexAbnormalReasoningRetryMaxRetriesError}
      />
    ),
    codexAbnormalReasoningRetryExhaustedBehavior: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_exhausted_behavior_label'
        )}
        labelId={abnormalRetryExhaustedBehaviorLabelId}
        hint={abnormalRetryExhaustedBehaviorHint}
        hintId={abnormalRetryExhaustedBehaviorHintId}
        hintVariant="selection"
      >
        <Select
          value={values.codexAbnormalReasoningRetryExhaustedBehavior}
          options={abnormalRetryExhaustedBehaviorOptions}
          id={`${abnormalRetryExhaustedBehaviorLabelId}-select`}
          disabled={disabled}
          ariaLabelledBy={abnormalRetryExhaustedBehaviorLabelId}
          ariaDescribedBy={abnormalRetryExhaustedBehaviorHintId}
          onChange={(nextValue) =>
            onChange({
              codexAbnormalReasoningRetryExhaustedBehavior:
                nextValue as VisualConfigValues['codexAbnormalReasoningRetryExhaustedBehavior'],
            })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryClientUsageAggregation: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_client_usage_aggregation_label'
        )}
        labelId={abnormalRetryUsageAggregationLabelId}
        hint={abnormalRetryUsageAggregationHint}
        hintId={abnormalRetryUsageAggregationHintId}
        hintVariant="selection"
      >
        <Select
          value={values.codexAbnormalReasoningRetryClientUsageAggregation}
          options={abnormalRetryUsageAggregationOptions}
          id={`${abnormalRetryUsageAggregationLabelId}-select`}
          disabled={disabled}
          ariaLabelledBy={abnormalRetryUsageAggregationLabelId}
          ariaDescribedBy={abnormalRetryUsageAggregationHintId}
          onChange={(nextValue) =>
            onChange({
              codexAbnormalReasoningRetryClientUsageAggregation:
                nextValue as VisualConfigValues['codexAbnormalReasoningRetryClientUsageAggregation'],
            })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryDeliveryPolicy: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_delivery_policy_label'
        )}
        labelId={abnormalRetryDeliveryPolicyLabelId}
        hint={abnormalRetryDeliveryPolicyHint}
        hintId={abnormalRetryDeliveryPolicyHintId}
        hintVariant="selection"
      >
        <Select
          value={values.codexAbnormalReasoningRetryDeliveryPolicy}
          options={abnormalRetryDeliveryPolicyOptions}
          id={`${abnormalRetryDeliveryPolicyLabelId}-select`}
          disabled={disabled}
          ariaLabelledBy={abnormalRetryDeliveryPolicyLabelId}
          ariaDescribedBy={abnormalRetryDeliveryPolicyHintId}
          onChange={(nextValue) =>
            onChange({
              codexAbnormalReasoningRetryDeliveryPolicy:
                nextValue as VisualConfigValues['codexAbnormalReasoningRetryDeliveryPolicy'],
            })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryFallbackPolicy: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_fallback_policy_label'
        )}
        labelId={abnormalRetryFallbackPolicyLabelId}
        hint={abnormalRetryFallbackPolicyHint}
        hintId={abnormalRetryFallbackPolicyHintId}
        hintVariant="selection"
      >
        <Select
          value={values.codexAbnormalReasoningRetryFallbackPolicy}
          options={abnormalRetryFallbackPolicyOptions}
          id={`${abnormalRetryFallbackPolicyLabelId}-select`}
          disabled={disabled}
          ariaLabelledBy={abnormalRetryFallbackPolicyLabelId}
          ariaDescribedBy={abnormalRetryFallbackPolicyHintId}
          onChange={(nextValue) =>
            onChange({
              codexAbnormalReasoningRetryFallbackPolicy:
                nextValue as VisualConfigValues['codexAbnormalReasoningRetryFallbackPolicy'],
            })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryAuthKinds: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_kinds_label'
        )}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_kinds_hint'
        )}
      >
        <StringListEditor
          value={values.codexAbnormalReasoningRetryAuthKinds}
          disabled={disabled}
          placeholder="oauth"
          inputAriaLabel={t(
            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_kinds_label'
          )}
          onChange={(codexAbnormalReasoningRetryAuthKinds) =>
            onChange({ codexAbnormalReasoningRetryAuthKinds })
          }
        />
      </FieldShell>
    ),
    codexAbnormalReasoningRetryAuthIds: (
      <FieldShell
        label={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_ids_label'
        )}
        hint={t(
          'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_ids_hint'
        )}
      >
        <StringListEditor
          value={values.codexAbnormalReasoningRetryAuthIds}
          disabled={disabled}
          placeholder="codex-oauth-primary"
          inputAriaLabel={t(
            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_auth_ids_label'
          )}
          onChange={(codexAbnormalReasoningRetryAuthIds) =>
            onChange({ codexAbnormalReasoningRetryAuthIds })
          }
        />
      </FieldShell>
    ),
  };
}
