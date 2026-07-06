import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCode,
  IconDiamond,
  IconKey,
  IconSatellite,
  IconSettings,
  IconShield,
  IconTimer,
  type IconProps,
} from '@/components/ui/icons';
import { ConfigSection } from '@/components/config/ConfigSection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type {
  CodexAbnormalReasoningRetryAction,
  CodexAbnormalReasoningRetryClientUsageAggregation,
  CodexAbnormalReasoningRetryDeliveryPolicy,
  CodexAbnormalReasoningRetryExhaustedBehavior,
  CodexAbnormalReasoningRetryFallbackPolicy,
  CodexAbnormalReasoningRetryHedgedRetryMode,
  PayloadFilterRule,
  PayloadParamValidationErrorCode,
  PayloadRule,
  VisualConfigFieldPath,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';
import {
  ApiKeysCardEditor,
  PayloadFilterRulesEditor,
  PayloadRulesEditor,
  StringListEditor,
} from './VisualConfigEditorBlocks';
import styles from './VisualConfigEditor.module.scss';

type VisualSectionId = 'server' | 'auth' | 'system' | 'quota' | 'streaming' | 'payload';

type VisualSection = {
  id: VisualSectionId;
  title: string;
  icon: ComponentType<IconProps>;
  errorCount: number;
};

interface VisualConfigEditorProps {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  hasPayloadValidationErrors?: boolean;
  disabled?: boolean;
  onChange: (values: Partial<VisualConfigValues>) => void;
}

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{title}</div>
        {description ? <div className={styles.toggleDescription}>{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className={styles.sectionGrid}>{children}</div>;
}

function SectionStack({ children }: { children: ReactNode }) {
  return <div className={styles.sectionStack}>{children}</div>;
}

function Divider() {
  return <div className={styles.divider} />;
}

type StrategyBadgeTone = 'active' | 'muted' | 'warning';

function StrategyBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StrategyBadgeTone;
}) {
  return (
    <div className={styles.strategyBadge} data-tone={tone}>
      <span className={styles.strategyBadgeLabel}>{label}</span>
      <span className={styles.strategyBadgeValue}>{value}</span>
    </div>
  );
}

function StrategyGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.strategyGroup}>
      <div className={styles.strategyGroupHeader}>
        <h4 className={styles.strategyGroupTitle}>{title}</h4>
        <p className={styles.strategyGroupDescription}>{description}</p>
      </div>
      {children}
    </div>
  );
}

function SectionSubsection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.subsection}>
      <div className={styles.subsectionHeader}>
        <h3 className={styles.subsectionTitle}>{title}</h3>
        {description ? <p className={styles.subsectionDescription}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

type ConfigHeaderI18nKey = `config_management.visual.sections.headers.${string}`;

const ABNORMAL_RETRY_ACTION_HINT_KEYS = {
  retry: 'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_retry_desc',
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

const findOptionLabel = (options: ReadonlyArray<{ value: string; label: string }>, value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  hintVariant = 'plain',
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  hintVariant?: 'plain' | 'selection';
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div
          id={hintId}
          className={hintVariant === 'selection' ? styles.fieldSelectionHint : styles.fieldHint}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function VisualConfigEditor({
  values,
  validationErrors,
  hasPayloadValidationErrors = false,
  disabled = false,
  onChange,
}: VisualConfigEditorProps) {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const disableImageGenerationLabelId = useId();
  const disableImageGenerationHintId = `${disableImageGenerationLabelId}-hint`;
  const abnormalRetryExhaustedBehaviorLabelId = useId();
  const abnormalRetryExhaustedBehaviorHintId = `${abnormalRetryExhaustedBehaviorLabelId}-hint`;
  const abnormalRetryActionLabelId = useId();
  const abnormalRetryActionHintId = `${abnormalRetryActionLabelId}-hint`;
  const abnormalRetryUsageAggregationLabelId = useId();
  const abnormalRetryUsageAggregationHintId = `${abnormalRetryUsageAggregationLabelId}-hint`;
  const abnormalRetryDeliveryPolicyLabelId = useId();
  const abnormalRetryDeliveryPolicyHintId = `${abnormalRetryDeliveryPolicyLabelId}-hint`;
  const abnormalRetryFallbackPolicyLabelId = useId();
  const abnormalRetryFallbackPolicyHintId = `${abnormalRetryFallbackPolicyLabelId}-hint`;
  const abnormalRetryHedgedModeLabelId = useId();
  const abnormalRetryHedgedModeHintId = `${abnormalRetryHedgedModeLabelId}-hint`;
  const keepaliveInputId = useId();
  const keepaliveHintId = `${keepaliveInputId}-hint`;
  const keepaliveErrorId = `${keepaliveInputId}-error`;
  const nonstreamKeepaliveInputId = useId();
  const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`;
  const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`;
  const [activeSectionId, setActiveSectionId] = useState<VisualSectionId>('server');
  const sectionRefs = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({});
  const mobileNavScrollerRef = useRef<HTMLDivElement | null>(null);
  const mobileNavButtonRefs = useRef<Partial<Record<VisualSectionId, HTMLButtonElement | null>>>(
    {}
  );

  const isKeepaliveDisabled =
    values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' ||
    values.streaming.nonstreamKeepaliveInterval === '0';

  const portError = getValidationMessage(t, validationErrors?.port);
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const errorLogsMaxFilesError = getValidationMessage(t, validationErrors?.errorLogsMaxFiles);
  const redisUsageQueueRetentionError = getValidationMessage(
    t,
    validationErrors?.redisUsageQueueRetentionSeconds
  );
  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const transientErrorCooldownSecondsError = getValidationMessage(
    t,
    validationErrors?.transientErrorCooldownSeconds
  );
  const authAutoRefreshWorkersError = getValidationMessage(
    t,
    validationErrors?.authAutoRefreshWorkers
  );
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
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );

  const handleApiKeysTextChange = useCallback(
    (apiKeysText: string) => onChange({ apiKeysText }),
    [onChange]
  );
  const handlePluginStoreSourcesChange = useCallback(
    (pluginStoreSources: string[]) => onChange({ pluginStoreSources }),
    [onChange]
  );
  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );
  const disableImageGenerationOptions = useMemo(
    () => [
      {
        value: 'false',
        label: t('config_management.visual.sections.network.disable_image_generation_false'),
      },
      {
        value: 'true',
        label: t('config_management.visual.sections.network.disable_image_generation_true'),
      },
      {
        value: 'chat',
        label: t('config_management.visual.sections.network.disable_image_generation_chat'),
      },
    ],
    [t]
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
  const abnormalRetryActionHint = t(
    ABNORMAL_RETRY_ACTION_HINT_KEYS[values.codexAbnormalReasoningRetryAction]
  );
  const abnormalRetryExhaustedBehaviorHint = t(
    ABNORMAL_RETRY_EXHAUSTED_BEHAVIOR_HINT_KEYS[
      values.codexAbnormalReasoningRetryExhaustedBehavior
    ]
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
  const abnormalRetryHedgedModeHint = t(
    ABNORMAL_RETRY_HEDGED_MODE_HINT_KEYS[values.codexAbnormalReasoningRetryHedgedRetryMode]
  );
  const abnormalRetryEnabled = values.codexAbnormalReasoningRetryAction !== 'disabled';
  const abnormalRetryRetryActive = values.codexAbnormalReasoningRetryAction === 'retry';
  const abnormalRetryActionLabel = findOptionLabel(
    abnormalRetryActionOptions,
    values.codexAbnormalReasoningRetryAction
  );
  const abnormalRetryHedgedModeLabel = findOptionLabel(
    abnormalRetryHedgedModeOptions,
    values.codexAbnormalReasoningRetryHedgedRetryMode
  );
  const abnormalRetryToggleOnLabel = t(
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_on'
  );
  const abnormalRetryToggleOffLabel = t(
    'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_off'
  );
  const abnormalRetryStreamBufferStatus =
    abnormalRetryRetryActive && values.codexAbnormalReasoningRetryStreamBuffer
      ? abnormalRetryToggleOnLabel
      : abnormalRetryToggleOffLabel;
  const abnormalRetryHedgedStatus =
    abnormalRetryRetryActive && values.codexAbnormalReasoningRetryHedgedRetryEnabled
      ? abnormalRetryHedgedModeLabel
      : abnormalRetryToggleOffLabel;
  const abnormalRetryDistinctAuthStatus =
    abnormalRetryRetryActive && values.codexAbnormalReasoningRetryRequireDistinctAuth
      ? abnormalRetryToggleOnLabel
      : abnormalRetryToggleOffLabel;
  const abnormalRetryActionTone: StrategyBadgeTone =
    values.codexAbnormalReasoningRetryAction === 'retry'
      ? 'active'
      : values.codexAbnormalReasoningRetryAction === 'observe-only'
        ? 'warning'
        : 'muted';
  const abnormalRetryStreamBufferTone: StrategyBadgeTone =
    abnormalRetryRetryActive && values.codexAbnormalReasoningRetryStreamBuffer ? 'active' : 'muted';
  const abnormalRetryHedgedTone: StrategyBadgeTone =
    abnormalRetryRetryActive && values.codexAbnormalReasoningRetryHedgedRetryEnabled
      ? 'active'
      : 'muted';
  const abnormalRetryDistinctAuthTone: StrategyBadgeTone =
    abnormalRetryRetryActive && values.codexAbnormalReasoningRetryRequireDistinctAuth
      ? 'active'
      : 'muted';

  const countErrors = useCallback(
    (fields: VisualConfigFieldPath[]) =>
      fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
    [validationErrors]
  );

  const sections = useMemo<VisualSection[]>(
    () => [
      {
        id: 'server',
        title: t('config_management.visual.sections.server.title'),
        icon: IconSettings,
        errorCount: countErrors(['port']),
      },
      {
        id: 'auth',
        title: t('config_management.visual.sections.auth.title'),
        icon: IconKey,
        errorCount: 0,
      },
      {
        id: 'system',
        title: t('config_management.visual.sections.system.title'),
        icon: IconDiamond,
        errorCount: countErrors([
          'errorLogsMaxFiles',
          'logsMaxTotalSizeMb',
          'redisUsageQueueRetentionSeconds',
          'requestRetry',
          'maxRetryCredentials',
          'maxRetryInterval',
          'transientErrorCooldownSeconds',
          'authAutoRefreshWorkers',
          'codexAbnormalReasoningRetryStreamBufferMaxBytes',
          'codexAbnormalReasoningRetryMaxRetries',
          'codexAbnormalReasoningRetryHedgeDelayMs',
          'codexAbnormalReasoningRetryReasoningTokens',
        ]),
      },
      {
        id: 'quota',
        title: t('config_management.visual.sections.quota.title'),
        icon: IconTimer,
        errorCount: 0,
      },
      {
        id: 'streaming',
        title: t('config_management.visual.sections.streaming.title'),
        icon: IconSatellite,
        errorCount: countErrors([
          'streaming.keepaliveSeconds',
          'streaming.bootstrapRetries',
          'streaming.nonstreamKeepaliveInterval',
        ]),
      },
      {
        id: 'payload',
        title: t('config_management.visual.sections.payload.title'),
        icon: IconCode,
        errorCount: hasPayloadValidationErrors ? 1 : 0,
      },
    ],
    [countErrors, hasPayloadValidationErrors, t]
  );

  const hasValidationIssues =
    sections.some((section) => section.errorCount > 0) || hasPayloadValidationErrors;
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];

  useEffect(() => {
    if (!isCurrentLayer) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        if (visibleEntries.length === 0) return;
        setActiveSectionId(visibleEntries[0].target.id as VisualSectionId);
      },
      {
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0.12, 0.3, 0.55],
      }
    );

    for (const section of sections) {
      const element = sectionRefs.current[section.id];
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, [isCurrentLayer, sections]);

  useEffect(() => {
    if (!isCurrentLayer || !isMobile) return;
    const scroller = mobileNavScrollerRef.current;
    const button = mobileNavButtonRefs.current[activeSectionId];
    if (!scroller || !button) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centeredLeft =
      scroller.scrollLeft +
      (buttonRect.left - scrollerRect.left) -
      (scroller.clientWidth - buttonRect.width) / 2;
    const maxScrollLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    const targetLeft = Math.min(Math.max(centeredLeft, 0), maxScrollLeft);

    scroller.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });
  }, [activeSectionId, isCurrentLayer, isMobile]);

  const handleSectionJump = useCallback((sectionId: VisualSectionId) => {
    setActiveSectionId(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  }, []);

  const navContent = (
    <div className={styles.navList}>
      {sections.map((section, index) => {
        const Icon = section.icon;

        return (
          <button
            key={section.id}
            type="button"
            className={`${styles.navButton} ${
              activeSectionId === section.id ? styles.navButtonActive : ''
            }`}
            onClick={() => handleSectionJump(section.id)}
          >
            <span className={styles.navIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.navMain}>
              <span className={styles.navHeadingRow}>
                <span className={styles.navLabelWrap}>
                  <span className={styles.navIcon}>
                    <Icon size={14} />
                  </span>
                  <span className={styles.navLabel}>{section.title}</span>
                </span>
                {section.errorCount > 0 ? (
                  <span className={styles.navBadge} aria-hidden="true">
                    {section.errorCount}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={styles.visualEditor}>
      <div className={styles.overview}>
        <div className={styles.overviewHeader}>
          <div className={styles.overviewMeta}>
            <span className={styles.overviewPill}>
              {t('config_management.visual.quick_jump', { defaultValue: '快速跳转' })}
            </span>
            <span className={styles.overviewPill}>{activeSection?.title}</span>
            {hasValidationIssues ? (
              <span className={`${styles.overviewPill} ${styles.overviewPillWarning}`}>
                {t('config_management.visual.validation.validation_blocked')}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.workspace}>
        {isMobile ? (
          <div className={styles.mobileSectionNav}>
            <div
              ref={mobileNavScrollerRef}
              className={styles.mobileSectionNavScroller}
              aria-label={t('config_management.visual.quick_jump', { defaultValue: '快速跳转' })}
            >
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  ref={(node) => {
                    mobileNavButtonRefs.current[section.id] = node;
                  }}
                  type="button"
                  className={`${styles.mobileSectionNavButton} ${
                    activeSectionId === section.id ? styles.mobileSectionNavButtonActive : ''
                  }`}
                  onClick={() => handleSectionJump(section.id)}
                >
                  <span className={styles.mobileSectionNavIndex}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.mobileSectionNavLabel}>{section.title}</span>
                  {section.errorCount > 0 ? (
                    <span className={styles.mobileSectionNavBadge} aria-hidden="true">
                      {section.errorCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <aside className={styles.sidebar}>
          <div className={styles.sidebarRail}>{navContent}</div>
        </aside>

        <div className={styles.sections}>
          <ConfigSection
            id="server"
            ref={(node) => {
              sectionRefs.current.server = node;
            }}
            indexLabel="01"
            icon={<IconSettings size={16} />}
            title={t('config_management.visual.sections.server.title')}
            description={t('config_management.visual.sections.server.description')}
          >
            <SectionStack>
              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.server.host')}
                  placeholder="0.0.0.0"
                  value={values.host}
                  onChange={(e) => onChange({ host: e.target.value })}
                  disabled={disabled}
                />
                <Input
                  label={t('config_management.visual.sections.server.port')}
                  type="number"
                  placeholder="8317"
                  value={values.port}
                  onChange={(e) => onChange({ port: e.target.value })}
                  disabled={disabled}
                  error={portError}
                />
              </SectionGrid>

              <SectionSubsection
                title={t('config_management.visual.sections.tls.title')}
                description={t('config_management.visual.sections.tls.description')}
              >
                <SectionStack>
                  <ToggleRow
                    title={t('config_management.visual.sections.tls.enable')}
                    description={t('config_management.visual.sections.tls.enable_desc')}
                    checked={values.tlsEnable}
                    disabled={disabled}
                    onChange={(tlsEnable) => onChange({ tlsEnable })}
                  />

                  {values.tlsEnable ? (
                    <>
                      <Divider />
                      <SectionGrid>
                        <Input
                          label={t('config_management.visual.sections.tls.cert')}
                          placeholder="/path/to/cert.pem"
                          value={values.tlsCert}
                          onChange={(e) => onChange({ tlsCert: e.target.value })}
                          disabled={disabled}
                        />
                        <Input
                          label={t('config_management.visual.sections.tls.key')}
                          placeholder="/path/to/key.pem"
                          value={values.tlsKey}
                          onChange={(e) => onChange({ tlsKey: e.target.value })}
                          disabled={disabled}
                        />
                      </SectionGrid>
                    </>
                  ) : null}
                </SectionStack>
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.remote.title')}
                description={t('config_management.visual.sections.remote.description')}
              >
                <SectionStack>
                  <SectionGrid>
                    <ToggleRow
                      title={t('config_management.visual.sections.remote.allow_remote')}
                      description={t('config_management.visual.sections.remote.allow_remote_desc')}
                      checked={values.rmAllowRemote}
                      disabled={disabled}
                      onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
                    />
                    <ToggleRow
                      title={t('config_management.visual.sections.remote.disable_panel')}
                      description={t('config_management.visual.sections.remote.disable_panel_desc')}
                      checked={values.rmDisableControlPanel}
                      disabled={disabled}
                      onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
                    />
                    <ToggleRow
                      title={t(
                        'config_management.visual.sections.remote.disable_auto_update_panel'
                      )}
                      description={t(
                        'config_management.visual.sections.remote.disable_auto_update_panel_desc'
                      )}
                      checked={values.rmDisableAutoUpdatePanel}
                      disabled={disabled}
                      onChange={(rmDisableAutoUpdatePanel) =>
                        onChange({ rmDisableAutoUpdatePanel })
                      }
                    />
                  </SectionGrid>
                  <SectionGrid>
                    <Input
                      label={t('config_management.visual.sections.remote.secret_key')}
                      type="password"
                      placeholder={t(
                        'config_management.visual.sections.remote.secret_key_placeholder'
                      )}
                      value={values.rmSecretKey}
                      onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.remote.panel_repo')}
                      placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                      value={values.rmPanelRepo}
                      onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                      disabled={disabled}
                    />
                  </SectionGrid>
                </SectionStack>
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="auth"
            ref={(node) => {
              sectionRefs.current.auth = node;
            }}
            indexLabel="02"
            icon={<IconKey size={16} />}
            title={t('config_management.visual.sections.auth.title')}
            description={t('config_management.visual.sections.auth.description')}
          >
            <SectionStack>
              <Input
                label={t('config_management.visual.sections.auth.auth_dir')}
                placeholder="~/.cli-proxy-api"
                value={values.authDir}
                onChange={(e) => onChange({ authDir: e.target.value })}
                disabled={disabled}
                hint={t('config_management.visual.sections.auth.auth_dir_hint')}
              />
              <div className={styles.subsection}>
                <ApiKeysCardEditor
                  value={values.apiKeysText}
                  disabled={disabled}
                  onChange={handleApiKeysTextChange}
                />
              </div>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="system"
            ref={(node) => {
              sectionRefs.current.system = node;
            }}
            indexLabel="03"
            icon={<IconDiamond size={16} />}
            title={t('config_management.visual.sections.system.title')}
            description={t('config_management.visual.sections.system.description')}
          >
            <SectionStack>
              <SectionGrid>
                <ToggleRow
                  title={t('config_management.visual.sections.system.debug')}
                  description={t('config_management.visual.sections.system.debug_desc')}
                  checked={values.debug}
                  disabled={disabled}
                  onChange={(debug) => onChange({ debug })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.commercial_mode')}
                  description={t('config_management.visual.sections.system.commercial_mode_desc')}
                  checked={values.commercialMode}
                  disabled={disabled}
                  onChange={(commercialMode) => onChange({ commercialMode })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.logging_to_file')}
                  description={t('config_management.visual.sections.system.logging_to_file_desc')}
                  checked={values.loggingToFile}
                  disabled={disabled}
                  onChange={(loggingToFile) => onChange({ loggingToFile })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.plugins_enabled')}
                  description={t('config_management.visual.sections.system.plugins_enabled_desc')}
                  checked={values.pluginsEnabled}
                  disabled={disabled}
                  onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
                />
              </SectionGrid>

              <SectionSubsection
                title={t('config_management.visual.sections.system.plugin_store_sources')}
                description={t(
                  'config_management.visual.sections.system.plugin_store_sources_desc'
                )}
              >
                <div className={styles.fieldShell}>
                  <label className={styles.fieldLabel}>
                    {t('config_management.visual.sections.system.plugin_store_sources_label')}
                  </label>
                  <StringListEditor
                    value={values.pluginStoreSources}
                    disabled={disabled}
                    placeholder={t(
                      'config_management.visual.sections.system.plugin_store_sources_placeholder'
                    )}
                    inputAriaLabel={t(
                      'config_management.visual.sections.system.plugin_store_sources_label'
                    )}
                    onChange={handlePluginStoreSourcesChange}
                  />
                  <div className={styles.fieldHint}>
                    {t('config_management.visual.sections.system.plugin_store_sources_hint')}
                  </div>
                </div>
              </SectionSubsection>

              <SectionGrid>
                <Input
                  label={t('config_management.visual.sections.system.logs_max_size')}
                  type="number"
                  placeholder="0"
                  value={values.logsMaxTotalSizeMb}
                  onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                  disabled={disabled}
                  error={logsMaxSizeError}
                />
                <Input
                  label={t('config_management.visual.sections.system.error_logs_max_files')}
                  type="number"
                  placeholder="10"
                  value={values.errorLogsMaxFiles}
                  onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
                  disabled={disabled}
                  error={errorLogsMaxFilesError}
                />
                <Input
                  label={t('config_management.visual.sections.system.redis_usage_retention')}
                  type="number"
                  placeholder="60"
                  value={values.redisUsageQueueRetentionSeconds}
                  onChange={(e) => onChange({ redisUsageQueueRetentionSeconds: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.system.redis_usage_retention_hint')}
                  error={redisUsageQueueRetentionError}
                />
              </SectionGrid>
              <SectionGrid>
                <ToggleRow
                  title={t('config_management.visual.sections.system.usage_statistics_enabled')}
                  description={t(
                    'config_management.visual.sections.system.usage_statistics_enabled_desc'
                  )}
                  checked={values.usageStatisticsEnabled}
                  disabled={disabled}
                  onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.antigravity_signature_cache')}
                  description={t(
                    'config_management.visual.sections.system.antigravity_signature_cache_desc'
                  )}
                  checked={values.antigravitySignatureCacheEnabled}
                  disabled={disabled}
                  onChange={(antigravitySignatureCacheEnabled) =>
                    onChange({ antigravitySignatureCacheEnabled })
                  }
                />
                <ToggleRow
                  title={t('config_management.visual.sections.system.antigravity_signature_strict')}
                  description={t(
                    'config_management.visual.sections.system.antigravity_signature_strict_desc'
                  )}
                  checked={values.antigravitySignatureBypassStrict}
                  disabled={disabled}
                  onChange={(antigravitySignatureBypassStrict) =>
                    onChange({ antigravitySignatureBypassStrict })
                  }
                />
              </SectionGrid>

              <SectionSubsection
                title={t('config_management.visual.sections.headers.title')}
                description={t('config_management.visual.sections.headers.description')}
              >
                <SectionStack>
                  <div className={styles.subsectionHeader}>
                    <h3 className={styles.subsectionTitle}>
                      {t('config_management.visual.sections.headers.claude_title')}
                    </h3>
                  </div>
                  <SectionGrid>
                    <Input
                      label={t('config_management.visual.sections.headers.user_agent')}
                      placeholder="claude-cli/2.1.44 (external, sdk-cli)"
                      value={values.claudeHeaderUserAgent}
                      onChange={(e) => onChange({ claudeHeaderUserAgent: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.headers.package_version')}
                      placeholder="0.74.0"
                      value={values.claudeHeaderPackageVersion}
                      onChange={(e) => onChange({ claudeHeaderPackageVersion: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.headers.runtime_version')}
                      placeholder="v24.3.0"
                      value={values.claudeHeaderRuntimeVersion}
                      onChange={(e) => onChange({ claudeHeaderRuntimeVersion: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.headers.os')}
                      placeholder="MacOS"
                      value={values.claudeHeaderOs}
                      onChange={(e) => onChange({ claudeHeaderOs: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.headers.arch')}
                      placeholder="arm64"
                      value={values.claudeHeaderArch}
                      onChange={(e) => onChange({ claudeHeaderArch: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.headers.timeout')}
                      placeholder="600"
                      value={values.claudeHeaderTimeout}
                      onChange={(e) => onChange({ claudeHeaderTimeout: e.target.value })}
                      disabled={disabled}
                    />
                  </SectionGrid>
                  <SectionGrid>
                    <ToggleRow
                      title={t('config_management.visual.sections.headers.stabilize_device')}
                      description={t(
                        'config_management.visual.sections.headers.stabilize_device_desc'
                      )}
                      checked={values.claudeHeaderStabilizeDeviceProfile}
                      disabled={disabled}
                      onChange={(claudeHeaderStabilizeDeviceProfile) =>
                        onChange({ claudeHeaderStabilizeDeviceProfile })
                      }
                    />
                  </SectionGrid>
                  <Divider />
                  <div className={styles.subsectionHeader}>
                    <h3 className={styles.subsectionTitle}>
                      {t('config_management.visual.sections.headers.codex_title')}
                    </h3>
                  </div>
                  <SectionGrid>
                    <Input
                      label={t('config_management.visual.sections.headers.user_agent')}
                      placeholder="codex_cli_rs/0.114.0 (Mac OS 14.2.0; x86_64) vscode/1.111.0"
                      value={values.codexHeaderUserAgent}
                      onChange={(e) => onChange({ codexHeaderUserAgent: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.headers.beta_features')}
                      placeholder="multi_agent"
                      value={values.codexHeaderBetaFeatures}
                      onChange={(e) => onChange({ codexHeaderBetaFeatures: e.target.value })}
                      disabled={disabled}
                    />
                  </SectionGrid>
                  <SectionGrid>
                    <ToggleRow
                      title={t('config_management.visual.sections.headers.codex_identity_confuse')}
                      description={t(
                        'config_management.visual.sections.headers.codex_identity_confuse_desc'
                      )}
                      checked={values.codexIdentityConfuse}
                      disabled={disabled}
                      onChange={(codexIdentityConfuse) => onChange({ codexIdentityConfuse })}
                    />
                  </SectionGrid>
                  <Divider />
                  <div className={styles.subsectionHeader}>
                    <h3 className={styles.subsectionTitle}>
                      {t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_title'
                      )}
                    </h3>
                    <p className={styles.subsectionDescription}>
                      {t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_desc'
                      )}
                    </p>
                  </div>
                  <div className={styles.strategyPanel}>
                    <div className={styles.strategySummary}>
                      <div className={styles.strategySummaryMain}>
                        <span className={styles.strategySummaryIcon} aria-hidden="true">
                          <IconShield size={18} />
                        </span>
                        <div className={styles.strategySummaryCopy}>
                          <div className={styles.strategySummaryTitle}>
                            {t(
                              'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_title'
                            )}
                          </div>
                          <p className={styles.strategySummaryDescription}>
                            {t(
                              'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_desc'
                            )}
                          </p>
                        </div>
                      </div>
                      <div className={styles.strategyBadgeGrid}>
                        <StrategyBadge
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_action'
                          )}
                          value={abnormalRetryActionLabel}
                          tone={abnormalRetryActionTone}
                        />
                        <StrategyBadge
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_stream_buffer'
                          )}
                          value={abnormalRetryStreamBufferStatus}
                          tone={abnormalRetryStreamBufferTone}
                        />
                        <StrategyBadge
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_hedged'
                          )}
                          value={abnormalRetryHedgedStatus}
                          tone={abnormalRetryHedgedTone}
                        />
                        <StrategyBadge
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_summary_distinct_auth'
                          )}
                          value={abnormalRetryDistinctAuthStatus}
                          tone={abnormalRetryDistinctAuthTone}
                        />
                      </div>
                    </div>

                    <StrategyGroup
                      title={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_switches_title'
                      )}
                      description={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_switches_desc'
                      )}
                    >
                      <SectionGrid>
                        <ToggleRow
                          title={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_enabled'
                          )}
                          description={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_enabled_desc'
                          )}
                          checked={abnormalRetryEnabled}
                          disabled={disabled}
                          onChange={(codexAbnormalReasoningRetryEnabled) =>
                            onChange({
                              codexAbnormalReasoningRetryEnabled,
                              codexAbnormalReasoningRetryAction: codexAbnormalReasoningRetryEnabled
                                ? 'retry'
                                : 'disabled',
                            })
                          }
                        />
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
                      </SectionGrid>
                    </StrategyGroup>

                    <StrategyGroup
                      title={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_retry_title'
                      )}
                      description={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_retry_desc'
                      )}
                    >
                      <SectionGrid>
                        <FieldShell
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_action_label'
                          )}
                          labelId={abnormalRetryActionLabelId}
                          hint={abnormalRetryActionHint}
                          hintId={abnormalRetryActionHintId}
                          hintVariant="selection"
                        >
                          <Select
                            value={values.codexAbnormalReasoningRetryAction}
                            options={abnormalRetryActionOptions}
                            id={`${abnormalRetryActionLabelId}-select`}
                            disabled={disabled}
                            ariaLabelledBy={abnormalRetryActionLabelId}
                            ariaDescribedBy={abnormalRetryActionHintId}
                            onChange={(nextValue) =>
                              onChange({
                                codexAbnormalReasoningRetryAction:
                                  nextValue as VisualConfigValues['codexAbnormalReasoningRetryAction'],
                                codexAbnormalReasoningRetryEnabled: nextValue !== 'disabled',
                              })
                            }
                          />
                        </FieldShell>
                        <Input
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_stream_buffer_max_bytes_label'
                          )}
                          type="number"
                          placeholder="0"
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
                        <Input
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedge_delay_ms_label'
                          )}
                          type="number"
                          placeholder="1000"
                          value={values.codexAbnormalReasoningRetryHedgeDelayMs}
                          onChange={(e) =>
                            onChange({ codexAbnormalReasoningRetryHedgeDelayMs: e.target.value })
                          }
                          disabled={disabled}
                          hint={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedge_delay_ms_hint'
                          )}
                          error={codexAbnormalReasoningRetryHedgeDelayMsError}
                        />
                        <FieldShell
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_hedged_retry_mode_label'
                          )}
                          labelId={abnormalRetryHedgedModeLabelId}
                          hint={abnormalRetryHedgedModeHint}
                          hintId={abnormalRetryHedgedModeHintId}
                          hintVariant="selection"
                        >
                          <Select
                            value={values.codexAbnormalReasoningRetryHedgedRetryMode}
                            options={abnormalRetryHedgedModeOptions}
                            id={`${abnormalRetryHedgedModeLabelId}-select`}
                            disabled={disabled}
                            ariaLabelledBy={abnormalRetryHedgedModeLabelId}
                            ariaDescribedBy={abnormalRetryHedgedModeHintId}
                            onChange={(nextValue) =>
                              onChange({
                                codexAbnormalReasoningRetryHedgedRetryMode:
                                  nextValue as VisualConfigValues['codexAbnormalReasoningRetryHedgedRetryMode'],
                              })
                            }
                          />
                        </FieldShell>
                      </SectionGrid>
                    </StrategyGroup>

                    <StrategyGroup
                      title={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_match_title'
                      )}
                      description={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_match_desc'
                      )}
                    >
                      <SectionGrid>
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
                        <Input
                          label={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_max_retries_label'
                          )}
                          type="number"
                          placeholder="2"
                          value={values.codexAbnormalReasoningRetryMaxRetries}
                          onChange={(e) =>
                            onChange({ codexAbnormalReasoningRetryMaxRetries: e.target.value })
                          }
                          disabled={disabled}
                          hint={t(
                            'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_max_retries_hint'
                          )}
                          error={codexAbnormalReasoningRetryMaxRetriesError}
                        />
                      </SectionGrid>
                    </StrategyGroup>

                    <StrategyGroup
                      title={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_delivery_title'
                      )}
                      description={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_delivery_desc'
                      )}
                    >
                      <SectionGrid>
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
                      </SectionGrid>
                    </StrategyGroup>

                    <StrategyGroup
                      title={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_scope_title'
                      )}
                      description={t(
                        'config_management.visual.sections.headers.codex_abnormal_reasoning_retry_group_scope_desc'
                      )}
                    >
                      <SectionGrid>
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
                      </SectionGrid>
                    </StrategyGroup>
                  </div>
                </SectionStack>
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.network.title')}
                description={t('config_management.visual.sections.network.description')}
              >
                <SectionStack>
                  <SectionGrid>
                    <Input
                      label={t('config_management.visual.sections.network.proxy_url')}
                      placeholder="socks5://user:pass@127.0.0.1:1080/"
                      value={values.proxyUrl}
                      onChange={(e) => onChange({ proxyUrl: e.target.value })}
                      disabled={disabled}
                    />
                    <Input
                      label={t('config_management.visual.sections.network.request_retry')}
                      type="number"
                      placeholder="3"
                      value={values.requestRetry}
                      onChange={(e) => onChange({ requestRetry: e.target.value })}
                      disabled={disabled}
                      error={requestRetryError}
                    />
                    <Input
                      label={t('config_management.visual.sections.network.max_retry_credentials')}
                      type="number"
                      placeholder="0"
                      value={values.maxRetryCredentials}
                      onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.max_retry_credentials_hint'
                      )}
                      error={maxRetryCredentialsError}
                    />
                    <Input
                      label={t('config_management.visual.sections.network.max_retry_interval')}
                      type="number"
                      placeholder="30"
                      value={values.maxRetryInterval}
                      onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                      disabled={disabled}
                      error={maxRetryIntervalError}
                    />
                    <Input
                      label={t(
                        'config_management.visual.sections.network.transient_error_cooldown_seconds'
                      )}
                      type="number"
                      placeholder="30"
                      value={values.transientErrorCooldownSeconds}
                      onChange={(e) => onChange({ transientErrorCooldownSeconds: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.transient_error_cooldown_seconds_hint'
                      )}
                      error={transientErrorCooldownSecondsError}
                    />
                    <Input
                      label={t(
                        'config_management.visual.sections.network.auth_auto_refresh_workers'
                      )}
                      type="number"
                      placeholder="16"
                      value={values.authAutoRefreshWorkers}
                      onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.auth_auto_refresh_workers_hint'
                      )}
                      error={authAutoRefreshWorkersError}
                    />
                    <FieldShell
                      label={t('config_management.visual.sections.network.routing_strategy')}
                      labelId={routingStrategyLabelId}
                      hint={t('config_management.visual.sections.network.routing_strategy_hint')}
                      hintId={routingStrategyHintId}
                    >
                      <Select
                        value={values.routingStrategy}
                        options={[
                          {
                            value: 'round-robin',
                            label: t(
                              'config_management.visual.sections.network.strategy_round_robin'
                            ),
                          },
                          {
                            value: 'fill-first',
                            label: t(
                              'config_management.visual.sections.network.strategy_fill_first'
                            ),
                          },
                        ]}
                        id={`${routingStrategyLabelId}-select`}
                        disabled={disabled}
                        ariaLabelledBy={routingStrategyLabelId}
                        ariaDescribedBy={routingStrategyHintId}
                        onChange={(nextValue) =>
                          onChange({
                            routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                          })
                        }
                      />
                    </FieldShell>
                    <FieldShell
                      label={t(
                        'config_management.visual.sections.network.disable_image_generation'
                      )}
                      labelId={disableImageGenerationLabelId}
                      hint={t(
                        'config_management.visual.sections.network.disable_image_generation_hint'
                      )}
                      hintId={disableImageGenerationHintId}
                    >
                      <Select
                        value={values.disableImageGeneration}
                        options={disableImageGenerationOptions}
                        id={`${disableImageGenerationLabelId}-select`}
                        disabled={disabled}
                        ariaLabelledBy={disableImageGenerationLabelId}
                        ariaDescribedBy={disableImageGenerationHintId}
                        onChange={(nextValue) =>
                          onChange({
                            disableImageGeneration:
                              nextValue as VisualConfigValues['disableImageGeneration'],
                          })
                        }
                      />
                    </FieldShell>
                    <Input
                      label={t('config_management.visual.sections.network.gpt_image_2_base_model')}
                      placeholder="gpt-5.4-mini"
                      value={values.gptImage2BaseModel}
                      onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.gpt_image_2_base_model_hint'
                      )}
                    />
                    <Input
                      label={t('config_management.visual.sections.network.session_affinity_ttl')}
                      placeholder="1h"
                      value={values.routingSessionAffinityTTL}
                      onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                      disabled={disabled}
                    />
                  </SectionGrid>

                  <SectionGrid>
                    <ToggleRow
                      title={t('config_management.visual.sections.network.force_model_prefix')}
                      description={t(
                        'config_management.visual.sections.network.force_model_prefix_desc'
                      )}
                      checked={values.forceModelPrefix}
                      disabled={disabled}
                      onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
                    />
                    <ToggleRow
                      title={t('config_management.visual.sections.network.passthrough_headers')}
                      description={t(
                        'config_management.visual.sections.network.passthrough_headers_desc'
                      )}
                      checked={values.passthroughHeaders}
                      disabled={disabled}
                      onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
                    />
                    <ToggleRow
                      title={t('config_management.visual.sections.network.disable_cooling')}
                      description={t(
                        'config_management.visual.sections.network.disable_cooling_desc'
                      )}
                      checked={values.disableCooling}
                      disabled={disabled}
                      onChange={(disableCooling) => onChange({ disableCooling })}
                    />
                    <ToggleRow
                      title={t('config_management.visual.sections.network.session_affinity')}
                      checked={values.routingSessionAffinity}
                      disabled={disabled}
                      onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
                    />
                    <ToggleRow
                      title={t('config_management.visual.sections.network.ws_auth')}
                      description={t('config_management.visual.sections.network.ws_auth_desc')}
                      checked={values.wsAuth}
                      disabled={disabled}
                      onChange={(wsAuth) => onChange({ wsAuth })}
                    />
                    <ToggleRow
                      title={t(
                        'config_management.visual.sections.network.enable_gemini_cli_endpoint'
                      )}
                      description={t(
                        'config_management.visual.sections.network.enable_gemini_cli_endpoint_desc'
                      )}
                      checked={values.enableGeminiCliEndpoint}
                      disabled={disabled}
                      onChange={(enableGeminiCliEndpoint) => onChange({ enableGeminiCliEndpoint })}
                    />
                  </SectionGrid>
                </SectionStack>
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="quota"
            ref={(node) => {
              sectionRefs.current.quota = node;
            }}
            indexLabel="04"
            icon={<IconTimer size={16} />}
            title={t('config_management.visual.sections.quota.title')}
            description={t('config_management.visual.sections.quota.description')}
          >
            <SectionGrid>
              <ToggleRow
                title={t('config_management.visual.sections.quota.switch_project')}
                description={t('config_management.visual.sections.quota.switch_project_desc')}
                checked={values.quotaSwitchProject}
                disabled={disabled}
                onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.quota.switch_preview_model')}
                description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
                checked={values.quotaSwitchPreviewModel}
                disabled={disabled}
                onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
              />
              <ToggleRow
                title={t('config_management.visual.sections.quota.antigravity_credits')}
                checked={values.quotaAntigravityCredits}
                disabled={disabled}
                onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
              />
            </SectionGrid>
          </ConfigSection>

          <ConfigSection
            id="streaming"
            ref={(node) => {
              sectionRefs.current.streaming = node;
            }}
            indexLabel="05"
            icon={<IconSatellite size={16} />}
            title={t('config_management.visual.sections.streaming.title')}
            description={t('config_management.visual.sections.streaming.description')}
          >
            <SectionStack>
              <SectionGrid>
                <FieldShell
                  label={t('config_management.visual.sections.streaming.keepalive_seconds')}
                  htmlFor={keepaliveInputId}
                  hint={t('config_management.visual.sections.streaming.keepalive_hint')}
                  hintId={keepaliveHintId}
                  error={keepaliveError}
                  errorId={keepaliveErrorId}
                >
                  <div className={styles.fieldControl}>
                    <input
                      id={keepaliveInputId}
                      className="input"
                      type="number"
                      placeholder="0"
                      value={values.streaming.keepaliveSeconds}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            keepaliveSeconds: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                    />
                    {isKeepaliveDisabled ? (
                      <span className={styles.inlinePill}>
                        {t('config_management.visual.sections.streaming.disabled')}
                      </span>
                    ) : null}
                  </div>
                </FieldShell>

                <Input
                  label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                  type="number"
                  placeholder="1"
                  value={values.streaming.bootstrapRetries}
                  onChange={(e) =>
                    onChange({
                      streaming: {
                        ...values.streaming,
                        bootstrapRetries: e.target.value,
                      },
                    })
                  }
                  disabled={disabled}
                  hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                  error={bootstrapRetriesError}
                />
              </SectionGrid>

              <SectionGrid>
                <FieldShell
                  label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                  htmlFor={nonstreamKeepaliveInputId}
                  hint={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
                  hintId={nonstreamKeepaliveHintId}
                  error={nonstreamKeepaliveError}
                  errorId={nonstreamKeepaliveErrorId}
                >
                  <div className={styles.fieldControl}>
                    <input
                      id={nonstreamKeepaliveInputId}
                      className="input"
                      type="number"
                      placeholder="0"
                      value={values.streaming.nonstreamKeepaliveInterval}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            nonstreamKeepaliveInterval: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                    />
                    {isNonstreamKeepaliveDisabled ? (
                      <span className={styles.inlinePill}>
                        {t('config_management.visual.sections.streaming.disabled')}
                      </span>
                    ) : null}
                  </div>
                </FieldShell>
              </SectionGrid>
            </SectionStack>
          </ConfigSection>

          <ConfigSection
            id="payload"
            ref={(node) => {
              sectionRefs.current.payload = node;
            }}
            indexLabel="06"
            icon={<IconCode size={16} />}
            title={t('config_management.visual.sections.payload.title')}
            description={t('config_management.visual.sections.payload.description')}
          >
            <SectionStack>
              <SectionSubsection
                title={t('config_management.visual.sections.payload.default_rules')}
                description={t('config_management.visual.sections.payload.default_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadDefaultRules}
                  disabled={disabled}
                  onChange={handlePayloadDefaultRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.default_raw_rules')}
                description={t('config_management.visual.sections.payload.default_raw_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadDefaultRawRules}
                  disabled={disabled}
                  rawJsonValues
                  onChange={handlePayloadDefaultRawRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.override_rules')}
                description={t('config_management.visual.sections.payload.override_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadOverrideRules}
                  disabled={disabled}
                  protocolFirst
                  onChange={handlePayloadOverrideRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.override_raw_rules')}
                description={t('config_management.visual.sections.payload.override_raw_rules_desc')}
              >
                <PayloadRulesEditor
                  value={values.payloadOverrideRawRules}
                  disabled={disabled}
                  protocolFirst
                  rawJsonValues
                  onChange={handlePayloadOverrideRawRulesChange}
                />
              </SectionSubsection>

              <SectionSubsection
                title={t('config_management.visual.sections.payload.filter_rules')}
                description={t('config_management.visual.sections.payload.filter_rules_desc')}
              >
                <PayloadFilterRulesEditor
                  value={values.payloadFilterRules}
                  disabled={disabled}
                  onChange={handlePayloadFilterRulesChange}
                />
              </SectionSubsection>
            </SectionStack>
          </ConfigSection>
        </div>
      </div>
    </div>
  );
}
