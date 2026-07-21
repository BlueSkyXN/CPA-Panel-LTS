import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconRefreshCw,
  IconSearch,
  IconSettings,
} from '@/components/ui/icons';
import { PresetPricingCatalog, useUsageData } from '@/components/usage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNotificationStore } from '@/stores';
import { downloadBlob } from '@/utils/download';
import {
  CHATGPT_FAST_SOURCE_URL,
  OPENAI_CATALOG_VERSION,
  OPENAI_PRICING_SOURCE_URL,
  analyzeUsagePricing,
  createDefaultPriceProfileV3,
  findCatalogEntry,
  findChatGptCreditPolicy,
  formatCompactNumber,
  formatUsd,
  getApiFastPolicyDisplay,
  getLocalEstimateCoverageDisplay,
  hasPricingAnomaly,
  importPriceProfileV3,
  preflightPriceProfileImportV3,
  restorePresetEquivalentOverrides,
  serializePriceProfileV3,
  type FastOverride,
  type PriceOverride,
  type PriceProfileV3,
  type PricingModelSummary,
  type StandardPricing,
  type TokenRates,
} from '@/utils/usage';
import { parseNonNegativePrice } from '@/utils/usage/modelPrices';
import styles from './UsagePricingPage.module.scss';

type PricingFilter = 'all' | 'preset' | 'custom' | 'unmatched' | 'anomaly';
type FastEditorMode = 'none' | 'rates' | 'multiplier';
type PricingStatus = 'preset' | 'custom' | 'unmatched';

interface PricingEditorDraft {
  aliasTarget: string;
  standardInput: string;
  standardCachedInput: string;
  standardCacheWrite: string;
  standardOutput: string;
  longEnabled: boolean;
  longThreshold: string;
  longInput: string;
  longCachedInput: string;
  longCacheWrite: string;
  longOutput: string;
  fastMode: FastEditorMode;
  fastMultiplier: string;
  fastInput: string;
  fastCachedInput: string;
  fastCacheWrite: string;
  fastOutput: string;
  fastLongSupported: boolean;
}

interface DraftProfileResult {
  profile: PriceProfileV3 | null;
  error: 'rates' | 'threshold' | 'multiplier' | 'profile' | null;
}

interface PricingDraftState {
  modelName: string;
  sourceProfile: PriceProfileV3;
  draft: PricingEditorDraft;
}

const normalizeModelKey = (value: string): string => value.trim().toLowerCase();

const rateToInput = (value: number | undefined): string =>
  value === undefined ? '' : String(value);

const draftFromSummary = (
  summary: PricingModelSummary,
  profile: PriceProfileV3
): PricingEditorDraft => {
  const key = normalizeModelKey(summary.modelName);
  const aliasTarget = profile.aliases[key] ?? '';
  const standard = summary.resolvedPrice.standard ?? {
    short: { input: 0, cachedInput: 0, output: 0 },
  };
  const fast = summary.resolvedPrice.fast;
  const fastMode: FastEditorMode =
    fast === null ? 'none' : 'multiplier' in fast ? 'multiplier' : 'rates';
  const fastRates = fast && 'short' in fast ? fast.short : null;

  return {
    aliasTarget,
    standardInput: rateToInput(standard.short.input),
    standardCachedInput: rateToInput(standard.short.cachedInput),
    standardCacheWrite: rateToInput(standard.short.cacheWrite),
    standardOutput: rateToInput(standard.short.output),
    longEnabled: standard.long !== undefined,
    longThreshold: standard.long ? String(standard.long.thresholdTokens) : '272000',
    longInput: rateToInput(standard.long?.rates.input),
    longCachedInput: rateToInput(standard.long?.rates.cachedInput),
    longCacheWrite: rateToInput(standard.long?.rates.cacheWrite),
    longOutput: rateToInput(standard.long?.rates.output),
    fastMode,
    fastMultiplier: fast && 'multiplier' in fast ? String(fast.multiplier) : '2',
    fastInput: rateToInput(fastRates?.input),
    fastCachedInput: rateToInput(fastRates?.cachedInput),
    fastCacheWrite: rateToInput(fastRates?.cacheWrite),
    fastOutput: rateToInput(fastRates?.output),
    fastLongSupported: fast?.longSupported ?? false,
  };
};

const parseRequiredRate = (value: string): number | null => {
  if (!value.trim()) return null;
  return parseNonNegativePrice(value) ?? null;
};

const parseOptionalRate = (value: string): number | undefined | null => {
  if (!value.trim()) return undefined;
  return parseNonNegativePrice(value) ?? null;
};

const parseRates = (
  input: string,
  cachedInput: string,
  cacheWrite: string,
  output: string
): TokenRates | null => {
  const parsedInput = parseRequiredRate(input);
  const parsedCachedInput = parseRequiredRate(cachedInput);
  const parsedCacheWrite = parseOptionalRate(cacheWrite);
  const parsedOutput = parseRequiredRate(output);
  if (
    parsedInput === null ||
    parsedCachedInput === null ||
    parsedCacheWrite === null ||
    parsedOutput === null
  ) {
    return null;
  }
  return {
    input: parsedInput,
    cachedInput: parsedCachedInput,
    ...(parsedCacheWrite === undefined ? {} : { cacheWrite: parsedCacheWrite }),
    output: parsedOutput,
  };
};

const buildDraftProfile = (
  modelName: string,
  profile: PriceProfileV3,
  draft: PricingEditorDraft
): DraftProfileResult => {
  const key = normalizeModelKey(modelName);
  const next: PriceProfileV3 = {
    ...profile,
    aliases: { ...profile.aliases },
    overrides: { ...profile.overrides },
  };
  delete next.aliases[key];
  delete next.overrides[key];

  const aliasTarget = draft.aliasTarget.trim();
  if (aliasTarget) {
    next.aliases[key] = aliasTarget;
    const preflight = preflightPriceProfileImportV3(next);
    return preflight.valid
      ? { profile: preflight.profile, error: null }
      : { profile: null, error: 'profile' };
  }

  const short = parseRates(
    draft.standardInput,
    draft.standardCachedInput,
    draft.standardCacheWrite,
    draft.standardOutput
  );
  if (!short) return { profile: null, error: 'rates' };

  const standard: StandardPricing = { short };
  if (draft.longEnabled) {
    const threshold = Number(draft.longThreshold);
    const longRates = parseRates(
      draft.longInput,
      draft.longCachedInput,
      draft.longCacheWrite,
      draft.longOutput
    );
    if (!Number.isSafeInteger(threshold) || threshold <= 0) {
      return { profile: null, error: 'threshold' };
    }
    if (!longRates) return { profile: null, error: 'rates' };
    standard.long = {
      thresholdTokens: threshold,
      basis: 'inputTokens',
      appliesTo: 'entireRequest',
      rates: longRates,
    };
  }

  let fast: FastOverride | undefined;
  if (draft.fastMode === 'rates') {
    const fastRates = parseRates(
      draft.fastInput,
      draft.fastCachedInput,
      draft.fastCacheWrite,
      draft.fastOutput
    );
    if (!fastRates) return { profile: null, error: 'rates' };
    fast = { short: fastRates, longSupported: draft.fastLongSupported };
  } else if (draft.fastMode === 'multiplier') {
    const multiplier = Number(draft.fastMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return { profile: null, error: 'multiplier' };
    }
    fast = { multiplier, longSupported: draft.fastLongSupported };
  }

  const override: PriceOverride = { standard, ...(fast ? { fast } : {}) };
  next.overrides[key] = override;
  const preflight = preflightPriceProfileImportV3(next);
  return preflight.valid
    ? { profile: preflight.profile, error: null }
    : { profile: null, error: 'profile' };
};

const getPricingStatus = (summary: PricingModelSummary, profile: PriceProfileV3): PricingStatus => {
  const key = normalizeModelKey(summary.modelName);
  if (profile.overrides[key] !== undefined || profile.aliases[key] !== undefined) return 'custom';
  return summary.resolvedPrice.modelMatch === 'none' ? 'unmatched' : 'preset';
};

const formatRate = (value: number | undefined): string =>
  value === undefined
    ? 'Auto'
    : `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

const todayStamp = (): string => new Date().toISOString().slice(0, 10);

export function UsagePricingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isEditorModal = useMediaQuery('(max-width: 1279px)');
  const { showNotification, showConfirmation } = useNotificationStore();
  const {
    usage,
    loading,
    priceProfile,
    priceProfileSource,
    priceProfileWarnings,
    setPriceProfile,
  } = useUsageData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PricingFilter>('all');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<PricingDraftState | null>(null);
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const pricingAnalysis = useMemo(
    () => analyzeUsagePricing(usage, priceProfile),
    [priceProfile, usage]
  );
  const { coverage, modelSummaries } = pricingAnalysis;
  const localCoverageDisplay = getLocalEstimateCoverageDisplay(coverage);
  const presetOverrideRecovery = useMemo(
    () => restorePresetEquivalentOverrides(priceProfile),
    [priceProfile]
  );

  const filteredSummaries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return modelSummaries.filter((summary) => {
      if (
        normalizedQuery &&
        !summary.modelName.toLowerCase().includes(normalizedQuery) &&
        !summary.resolvedPrice.resolvedModel?.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      const status = getPricingStatus(summary, priceProfile);
      if (filter === 'preset') return status === 'preset';
      if (filter === 'custom') return status === 'custom';
      if (filter === 'unmatched') return status === 'unmatched';
      if (filter === 'anomaly') {
        return hasPricingAnomaly(summary.pricingCoverage, summary.warnings);
      }
      return true;
    });
  }, [filter, modelSummaries, priceProfile, query]);

  const activeModelName =
    selectedModel && filteredSummaries.some((item) => item.modelName === selectedModel)
      ? selectedModel
      : (filteredSummaries[0]?.modelName ?? null);

  const selectedSummary = useMemo(
    () => modelSummaries.find((item) => item.modelName === activeModelName) ?? null,
    [activeModelName, modelSummaries]
  );

  const draft = useMemo(() => {
    if (!selectedSummary) return null;
    if (
      draftState?.modelName === selectedSummary.modelName &&
      draftState.sourceProfile === priceProfile
    ) {
      return draftState.draft;
    }
    return draftFromSummary(selectedSummary, priceProfile);
  }, [draftState, priceProfile, selectedSummary]);

  const draftResult = useMemo(
    () =>
      selectedSummary && draft
        ? buildDraftProfile(selectedSummary.modelName, priceProfile, draft)
        : { profile: null, error: null },
    [draft, priceProfile, selectedSummary]
  );
  const draftAnalysis = useMemo(
    () => (draftResult.profile ? analyzeUsagePricing(usage, draftResult.profile) : null),
    [draftResult.profile, usage]
  );
  const draftCoverage = draftAnalysis?.coverage ?? null;
  const draftSummary =
    draftAnalysis && selectedSummary
      ? (draftAnalysis.modelSummaries.find(
          (item) => item.modelName === selectedSummary.modelName
        ) ?? null)
      : null;

  const filterOptions = useMemo(
    () =>
      (['all', 'preset', 'custom', 'unmatched', 'anomaly'] as PricingFilter[]).map((value) => ({
        value,
        label: t(`usage_stats.pricing_filter_${value}`),
      })),
    [t]
  );

  const fastModeOptions = useMemo(
    () =>
      (['none', 'rates', 'multiplier'] as FastEditorMode[]).map((value) => ({
        value,
        label: t(`usage_stats.pricing_fast_mode_${value}`),
      })),
    [t]
  );

  const selectModel = (modelName: string) => {
    setSelectedModel(modelName);
    setDraftState(null);
    if (isEditorModal) setMobileEditorOpen(true);
  };

  const updateDraft = <K extends keyof PricingEditorDraft>(
    key: K,
    value: PricingEditorDraft[K]
  ) => {
    if (!selectedSummary || !draft) return;
    setDraftState({
      modelName: selectedSummary.modelName,
      sourceProfile: priceProfile,
      draft: { ...draft, [key]: value },
    });
  };

  const saveSelected = () => {
    if (!draftResult.profile) {
      showNotification(
        t(`usage_stats.pricing_editor_error_${draftResult.error ?? 'profile'}`),
        'error'
      );
      return;
    }
    if (setPriceProfile(draftResult.profile)) {
      showNotification(t('usage_stats.pricing_profile_saved'), 'success');
      setMobileEditorOpen(false);
    }
  };

  const clearSelected = () => {
    if (!selectedSummary) return;
    const key = normalizeModelKey(selectedSummary.modelName);
    const next: PriceProfileV3 = {
      ...priceProfile,
      aliases: { ...priceProfile.aliases },
      overrides: { ...priceProfile.overrides },
    };
    delete next.aliases[key];
    delete next.overrides[key];
    if (setPriceProfile(next)) {
      showNotification(
        t(
          findCatalogEntry(selectedSummary.modelName)
            ? 'usage_stats.pricing_preset_restored'
            : 'usage_stats.pricing_custom_deleted'
        ),
        'success'
      );
      setMobileEditorOpen(false);
    }
  };

  const exportProfile = () => {
    downloadBlob({
      filename: `usage-pricing-profile-${todayStamp()}.json`,
      blob: new Blob([JSON.stringify(JSON.parse(serializePriceProfileV3(priceProfile)), null, 2)], {
        type: 'application/json',
      }),
    });
    showNotification(t('usage_stats.pricing_export_success'), 'success');
  };

  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let imported;
    try {
      imported = importPriceProfileV3(await file.text());
    } catch {
      showNotification(t('usage_stats.pricing_import_invalid'), 'error');
      return;
    }
    if (!imported.valid) {
      showNotification(
        `${t('usage_stats.pricing_import_invalid')}: ${imported.errors.slice(0, 3).join(', ')}`,
        'error'
      );
      return;
    }
    showConfirmation({
      title: t('usage_stats.pricing_import_title'),
      message: t('usage_stats.pricing_import_confirm'),
      confirmText: t('usage_stats.pricing_import_action'),
      variant: 'primary',
      onConfirm: () => {
        if (setPriceProfile(imported.profile)) {
          showNotification(t('usage_stats.pricing_import_success'), 'success');
        }
      },
    });
  };

  const resetAll = () => {
    showConfirmation({
      title: t('usage_stats.pricing_reset_title'),
      message: t('usage_stats.pricing_reset_confirm'),
      confirmText: t('usage_stats.pricing_reset_action'),
      variant: 'danger',
      onConfirm: () => {
        if (setPriceProfile(createDefaultPriceProfileV3())) {
          showNotification(t('usage_stats.pricing_reset_success'), 'success');
        }
      },
    });
  };

  const restoreMatchingPresets = () => {
    const count = presetOverrideRecovery.restoredModels.length;
    if (count === 0) return;
    showConfirmation({
      title: t('usage_stats.pricing_matching_presets_title'),
      message: t('usage_stats.pricing_matching_presets_confirm', { count }),
      confirmText: t('usage_stats.pricing_matching_presets_action'),
      variant: 'primary',
      onConfirm: () => {
        if (setPriceProfile(presetOverrideRecovery.profile)) {
          showNotification(t('usage_stats.pricing_matching_presets_success', { count }), 'success');
        }
      },
    });
  };

  const renderEditor = () => {
    if (!selectedSummary || !draft) return null;
    const modelIsCanonicalPreset =
      normalizeModelKey(findCatalogEntry(selectedSummary.modelName)?.canonicalModel ?? '') ===
      normalizeModelKey(selectedSummary.modelName);
    const aliasMode = Boolean(draft.aliasTarget.trim());
    const currentCost = selectedSummary.estimatedAmount;
    const nextCost = draftSummary?.estimatedAmount ?? currentCost;
    const costDelta = nextCost - currentCost;
    const currentCoverage = getLocalEstimateCoverageDisplay(coverage).requestPercent;
    const nextCoverage = draftCoverage
      ? getLocalEstimateCoverageDisplay(draftCoverage).requestPercent
      : currentCoverage;
    const clearLabel = modelIsCanonicalPreset
      ? t('usage_stats.pricing_restore_preset')
      : t('usage_stats.pricing_delete_config');
    const configured =
      priceProfile.overrides[normalizeModelKey(selectedSummary.modelName)] !== undefined ||
      priceProfile.aliases[normalizeModelKey(selectedSummary.modelName)] !== undefined;

    return (
      <div className={styles.editor} data-testid="pricing-editor">
        <div className={styles.editorHeading}>
          <div>
            <span className={styles.editorEyebrow}>{t('usage_stats.pricing_editor_title')}</span>
            <h2>{selectedSummary.modelName}</h2>
          </div>
          <span className={styles.matchBadge} data-kind={selectedSummary.resolvedPrice.modelMatch}>
            {t(`usage_stats.pricing_match_${selectedSummary.resolvedPrice.modelMatch}`)}
          </span>
        </div>

        <div className={styles.editorDomainNotice}>
          {t('usage_stats.pricing_editor_domain_notice')}
        </div>

        <div className={`${styles.editorSection} ${styles.aliasSection}`}>
          <div className={styles.editorSectionTitle}>{t('usage_stats.pricing_alias')}</div>
          <Input
            value={draft.aliasTarget}
            onChange={(event) => updateDraft('aliasTarget', event.target.value)}
            placeholder="gpt-5.6-sol"
            aria-label={t('usage_stats.pricing_alias')}
            disabled={modelIsCanonicalPreset}
            hint={
              modelIsCanonicalPreset
                ? t('usage_stats.pricing_alias_canonical_hint')
                : t('usage_stats.pricing_alias_hint')
            }
          />
        </div>

        <fieldset
          className={`${styles.editorSection} ${styles.standardSection}`}
          disabled={aliasMode}
        >
          <legend className={styles.editorSectionTitle}>
            {t('usage_stats.pricing_standard_rates')}
          </legend>
          <div className={styles.rateGrid}>
            <Input
              label={t('usage_stats.pricing_rate_input')}
              type="number"
              min="0"
              step="0.0001"
              value={draft.standardInput}
              onChange={(event) => updateDraft('standardInput', event.target.value)}
            />
            <Input
              label={t('usage_stats.pricing_rate_cached_input')}
              type="number"
              min="0"
              step="0.0001"
              value={draft.standardCachedInput}
              onChange={(event) => updateDraft('standardCachedInput', event.target.value)}
            />
            <Input
              label={t('usage_stats.pricing_rate_cache_write')}
              type="number"
              min="0"
              step="0.0001"
              value={draft.standardCacheWrite}
              placeholder={t('usage_stats.pricing_auto')}
              onChange={(event) => updateDraft('standardCacheWrite', event.target.value)}
            />
            <Input
              label={t('usage_stats.pricing_rate_output')}
              type="number"
              min="0"
              step="0.0001"
              value={draft.standardOutput}
              onChange={(event) => updateDraft('standardOutput', event.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className={`${styles.editorSection} ${styles.fastSection}`} disabled={aliasMode}>
          <legend className={styles.editorSectionTitle}>
            {t('usage_stats.pricing_fast_rates')}
          </legend>
          <Select
            value={draft.fastMode}
            options={fastModeOptions}
            onChange={(value) => updateDraft('fastMode', value as FastEditorMode)}
            ariaLabel={t('usage_stats.pricing_fast_rates')}
            size="sm"
          />
          {draft.fastMode === 'multiplier' && (
            <Input
              label={t('usage_stats.pricing_fast_multiplier')}
              type="number"
              min="0.0001"
              step="0.01"
              value={draft.fastMultiplier}
              onChange={(event) => updateDraft('fastMultiplier', event.target.value)}
            />
          )}
          {draft.fastMode === 'rates' && (
            <div className={styles.rateGrid}>
              <Input
                label={t('usage_stats.pricing_rate_input')}
                type="number"
                min="0"
                step="0.0001"
                value={draft.fastInput}
                onChange={(event) => updateDraft('fastInput', event.target.value)}
              />
              <Input
                label={t('usage_stats.pricing_rate_cached_input')}
                type="number"
                min="0"
                step="0.0001"
                value={draft.fastCachedInput}
                onChange={(event) => updateDraft('fastCachedInput', event.target.value)}
              />
              <Input
                label={t('usage_stats.pricing_rate_cache_write')}
                type="number"
                min="0"
                step="0.0001"
                value={draft.fastCacheWrite}
                placeholder={t('usage_stats.pricing_auto')}
                onChange={(event) => updateDraft('fastCacheWrite', event.target.value)}
              />
              <Input
                label={t('usage_stats.pricing_rate_output')}
                type="number"
                min="0"
                step="0.0001"
                value={draft.fastOutput}
                onChange={(event) => updateDraft('fastOutput', event.target.value)}
              />
            </div>
          )}
          {draft.fastMode !== 'none' && (
            <ToggleSwitch
              checked={draft.fastLongSupported}
              onChange={(value) => updateDraft('fastLongSupported', value)}
              label={t('usage_stats.pricing_fast_long_supported')}
            />
          )}
        </fieldset>

        <fieldset className={`${styles.editorSection} ${styles.longSection}`} disabled={aliasMode}>
          <legend className={styles.editorSectionTitle}>
            {t('usage_stats.pricing_long_context')}
          </legend>
          <ToggleSwitch
            checked={draft.longEnabled}
            onChange={(value) => updateDraft('longEnabled', value)}
            label={t('usage_stats.pricing_long_enable')}
          />
          {draft.longEnabled && (
            <>
              <Input
                label={t('usage_stats.pricing_long_threshold')}
                type="number"
                min="1"
                step="1"
                value={draft.longThreshold}
                onChange={(event) => updateDraft('longThreshold', event.target.value)}
              />
              <div className={styles.rateGrid}>
                <Input
                  label={t('usage_stats.pricing_rate_input')}
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.longInput}
                  onChange={(event) => updateDraft('longInput', event.target.value)}
                />
                <Input
                  label={t('usage_stats.pricing_rate_cached_input')}
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.longCachedInput}
                  onChange={(event) => updateDraft('longCachedInput', event.target.value)}
                />
                <Input
                  label={t('usage_stats.pricing_rate_cache_write')}
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.longCacheWrite}
                  placeholder={t('usage_stats.pricing_auto')}
                  onChange={(event) => updateDraft('longCacheWrite', event.target.value)}
                />
                <Input
                  label={t('usage_stats.pricing_rate_output')}
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.longOutput}
                  onChange={(event) => updateDraft('longOutput', event.target.value)}
                />
              </div>
            </>
          )}
        </fieldset>

        <div className={styles.previewPanel}>
          <div>
            <span>{t('usage_stats.pricing_preview_affected')}</span>
            <strong>{selectedSummary.pricingCoverage.totalRequests.toLocaleString()}</strong>
          </div>
          <div>
            <span>{t('usage_stats.pricing_preview_coverage')}</span>
            <strong>
              {currentCoverage === null ? '--' : `${currentCoverage.toFixed(1)}%`} →{' '}
              {nextCoverage === null ? '--' : `${nextCoverage.toFixed(1)}%`}
            </strong>
          </div>
          <div>
            <span>{t('usage_stats.pricing_preview_cost')}</span>
            <strong>{formatUsd(nextCost)}</strong>
            <small
              className={
                costDelta === 0
                  ? styles.deltaNeutral
                  : costDelta > 0
                    ? styles.deltaUp
                    : styles.deltaDown
              }
            >
              {costDelta >= 0 ? '+' : ''}
              {formatUsd(costDelta)}
            </small>
          </div>
        </div>

        {draftResult.error && (
          <div className={styles.editorError} role="alert">
            <IconAlertTriangle size={16} />
            {t(`usage_stats.pricing_editor_error_${draftResult.error}`)}
          </div>
        )}

        <div className={styles.editorActions}>
          <Button variant="secondary" onClick={clearSelected} disabled={!configured}>
            {clearLabel}
          </Button>
          <Button onClick={saveSelected} disabled={!draftResult.profile}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container} data-testid="usage-pricing-page">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <Button
            className={styles.backButton}
            variant="ghost"
            size="sm"
            onClick={() => navigate('/usage')}
          >
            <IconChevronLeft size={16} />
            {t('usage_stats.pricing_back')}
          </Button>
          <div className={styles.titleRow}>
            <div className={styles.titleMark} aria-hidden="true">
              <IconSettings size={20} />
            </div>
            <div>
              <h1>{t('usage_stats.pricing_title')}</h1>
              <p>{t('usage_stats.pricing_subtitle')}</p>
            </div>
          </div>
        </div>
        <div className={styles.catalogStamp}>
          <span>{t('usage_stats.pricing_catalog_version')}</span>
          <strong>{OPENAI_CATALOG_VERSION}</strong>
          <a href={OPENAI_PRICING_SOURCE_URL} target="_blank" rel="noreferrer">
            {t('usage_stats.pricing_api_source')} <IconExternalLink size={13} />
          </a>
          <a href={CHATGPT_FAST_SOURCE_URL} target="_blank" rel="noreferrer">
            {t('usage_stats.pricing_chatgpt_source')} <IconExternalLink size={13} />
          </a>
        </div>
      </header>

      <div className={styles.notice}>
        <IconAlertTriangle size={17} />
        <div className={styles.noticeCopy}>
          <strong>{t('usage_stats.pricing_estimate_notice')}</strong>
          <span>{t('usage_stats.pricing_browser_notice')}</span>
          <span>{t('usage_stats.pricing_history_notice')}</span>
          <span>{t('usage_stats.pricing_credit_notice')}</span>
        </div>
      </div>

      {(priceProfileSource === 'v2' || priceProfileWarnings.length > 0) && (
        <div className={styles.migrationNotice}>
          {priceProfileSource === 'v2' && priceProfileWarnings.length === 0
            ? t('usage_stats.pricing_migrated_v2')
            : t('usage_stats.pricing_profile_warning')}
        </div>
      )}

      {presetOverrideRecovery.restoredModels.length > 0 && (
        <div
          className={`${styles.migrationNotice} ${styles.presetRecoveryNotice}`}
          data-testid="pricing-preset-recovery"
        >
          <span>
            {t('usage_stats.pricing_matching_presets_notice', {
              count: presetOverrideRecovery.restoredModels.length,
            })}
          </span>
          <Button variant="secondary" size="sm" onClick={restoreMatchingPresets}>
            {t('usage_stats.pricing_matching_presets_action')}
          </Button>
        </div>
      )}

      <PresetPricingCatalog />

      <section className={styles.summaryGrid} aria-label={t('usage_stats.pricing_summary')}>
        <div className={styles.summaryCard}>
          <span>{t('usage_stats.pricing_api_usd_estimate')}</span>
          <strong>
            {coverage.pricedRequests > 0 ? formatUsd(coverage.estimatedAmount) : '--'}
          </strong>
          <small>
            {coverage.pricedRequests} / {coverage.totalRequests}{' '}
            {t('usage_stats.pricing_requests_unit')}
          </small>
        </div>
        <div className={styles.summaryCard}>
          <span>{t('usage_stats.pricing_api_request_coverage')}</span>
          <strong>
            {localCoverageDisplay.requestPercent === null
              ? '--'
              : `${localCoverageDisplay.requestPercent.toFixed(1)}%`}
          </strong>
          <small>
            {localCoverageDisplay.tokenPercent === null
              ? t(
                  coverage.totalRequests === 0
                    ? 'usage_stats.pricing_no_api_requests'
                    : 'usage_stats.pricing_no_api_tokens'
                )
              : t('usage_stats.pricing_api_token_coverage', {
                  percent: localCoverageDisplay.tokenPercent.toFixed(1),
                })}
          </small>
        </div>
        <div className={styles.summaryCard}>
          <span>{t('usage_stats.pricing_credit_rated')}</span>
          <strong>
            {coverage.creditRatedRequests} / {coverage.chatGptCreditRequests}
          </strong>
          <small>
            {t('usage_stats.pricing_credit_fast_count', {
              count: coverage.creditFastRequests,
            })}
          </small>
        </div>
        <div className={styles.summaryCard}>
          <span>{t('usage_stats.pricing_unknown_billing')}</span>
          <strong>{coverage.unknownBillingRequests.toLocaleString()}</strong>
          <small>
            {t('usage_stats.pricing_unknown_billing_hint', {
              tokens: formatCompactNumber(coverage.unknownBillingTokens),
            })}
          </small>
        </div>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <IconSearch size={16} aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('usage_stats.pricing_search')}
            aria-label={t('usage_stats.pricing_search')}
          />
        </div>
        <Select
          value={filter}
          options={filterOptions}
          onChange={(value) => setFilter(value as PricingFilter)}
          fullWidth={false}
          size="sm"
          className={styles.filterSelect}
          ariaLabel={t('usage_stats.pricing_filter')}
        />
        <div className={styles.toolbarActions}>
          <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()}>
            <IconFileText size={15} />
            {t('usage_stats.pricing_import_action')}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportProfile}>
            <IconDownload size={15} />
            {t('usage_stats.pricing_export_action')}
          </Button>
          <Button variant="danger" size="sm" onClick={resetAll}>
            <IconRefreshCw size={15} />
            {t('usage_stats.pricing_reset_action')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={importProfile}
          />
        </div>
      </section>

      {loading && !usage ? (
        <div className={styles.loadingState} role="status">
          {t('common.loading')}
        </div>
      ) : modelSummaries.length === 0 ? (
        <EmptyState
          title={t('usage_stats.pricing_empty_title')}
          description={t('usage_stats.pricing_empty_description')}
          action={
            <Button onClick={() => navigate('/usage')}>{t('usage_stats.pricing_back')}</Button>
          }
        />
      ) : (
        <div className={styles.workspace}>
          <div className={styles.modelPanel}>
            <div className={styles.modelHeader} aria-hidden="true">
              <span>{t('usage_stats.model_name')}</span>
              <span>{t('usage_stats.pricing_standard_api')}</span>
              <span>{t('usage_stats.pricing_fast_policies')}</span>
              <span>{t('usage_stats.pricing_long_context')}</span>
              <span>{t('usage_stats.pricing_usage_by_basis')}</span>
              <span>{t('usage_stats.pricing_api_usd')}</span>
            </div>
            <div className={styles.modelList}>
              {filteredSummaries.map((summary) => {
                const standard = summary.resolvedPrice.standard?.short;
                const fastPolicy = getApiFastPolicyDisplay(summary.resolvedPrice);
                const creditPolicy = findChatGptCreditPolicy(summary.modelName);
                const active = summary.modelName === activeModelName;
                const anomaly = hasPricingAnomaly(summary.pricingCoverage, summary.warnings);
                const pricingStatus = getPricingStatus(summary, priceProfile);
                return (
                  <button
                    key={summary.modelName}
                    type="button"
                    className={`${styles.modelRow} ${active ? styles.modelRowActive : ''}`}
                    onClick={() => selectModel(summary.modelName)}
                    aria-pressed={active}
                    data-testid="pricing-model-row"
                    data-model={summary.modelName}
                  >
                    <span className={styles.modelIdentity}>
                      <strong title={summary.modelName}>{summary.modelName}</strong>
                      <small
                        title={
                          summary.resolvedPrice.resolvedModel ?? t('usage_stats.pricing_unmatched')
                        }
                      >
                        {summary.resolvedPrice.resolvedModel ?? t('usage_stats.pricing_unmatched')}
                      </small>
                      <span className={styles.rowBadges}>
                        <span
                          className={styles.matchBadge}
                          data-kind={pricingStatus === 'unmatched' ? 'none' : pricingStatus}
                        >
                          {t(
                            `usage_stats.pricing_match_${pricingStatus === 'unmatched' ? 'none' : pricingStatus}`
                          )}
                        </span>
                        {summary.resolvedPrice.modelMatch === 'alias' && (
                          <span className={styles.matchBadge} data-kind="alias">
                            {t('usage_stats.pricing_match_alias')}
                          </span>
                        )}
                        {anomaly && (
                          <span className={styles.anomalyBadge}>
                            {t('usage_stats.pricing_anomaly')}
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className={styles.rateCell}
                      data-label={t('usage_stats.pricing_standard_api')}
                    >
                      <strong>{standard ? formatRate(standard.input) : '--'}</strong>
                      <small>
                        {standard
                          ? `${t('usage_stats.pricing_rate_output')}: ${formatRate(standard.output)}`
                          : '--'}
                      </small>
                    </span>
                    <span
                      className={styles.rateCell}
                      data-label={t('usage_stats.pricing_fast_policies')}
                    >
                      <strong>
                        {fastPolicy.kind === 'none'
                          ? '--'
                          : fastPolicy.kind === 'explicit-rates'
                            ? t('usage_stats.pricing_api_priority_explicit_rates')
                            : t(
                                fastPolicy.kind === 'custom-multiplier'
                                  ? 'usage_stats.pricing_api_priority_multiplier_custom'
                                  : 'usage_stats.pricing_api_priority_multiplier_official',
                                { multiplier: fastPolicy.multiplier.toFixed(2) }
                              )}
                      </strong>
                      <small>
                        {creditPolicy === null
                          ? t('usage_stats.pricing_chatgpt_credit_unavailable')
                          : t('usage_stats.pricing_chatgpt_credit_multipliers', {
                              standard: creditPolicy.standardMultiplier.toFixed(2),
                              fast: creditPolicy.fastMultiplier.toFixed(2),
                            })}
                      </small>
                    </span>
                    <span
                      className={styles.rateCell}
                      data-label={t('usage_stats.pricing_long_context')}
                    >
                      <strong>
                        {summary.resolvedPrice.standard?.long
                          ? formatCompactNumber(summary.resolvedPrice.standard.long.thresholdTokens)
                          : '--'}
                      </strong>
                      <small>
                        {summary.pricingCoverage.unsupportedRequests > 0
                          ? t('usage_stats.pricing_long_unsupported')
                          : summary.longContextRequestCount > 0
                            ? t('usage_stats.pricing_long_requests', {
                                count: summary.longContextRequestCount,
                              })
                            : summary.resolvedPrice.standard?.long
                              ? t('usage_stats.pricing_short_only')
                              : t('usage_stats.pricing_single_rate_card')}
                      </small>
                    </span>
                    <span
                      className={styles.usageCell}
                      data-label={t('usage_stats.pricing_usage_by_basis')}
                      title={t('usage_stats.pricing_usage_breakdown', {
                        api: summary.pricingCoverage.apiTokenUsdRequests,
                        credits: summary.pricingCoverage.chatGptCreditRequests,
                        unknown: summary.pricingCoverage.unknownBillingRequests,
                      })}
                    >
                      <strong>{summary.requestCount.toLocaleString()}</strong>
                      <small>
                        {t('usage_stats.pricing_usage_breakdown', {
                          api: summary.pricingCoverage.apiTokenUsdRequests,
                          credits: summary.pricingCoverage.chatGptCreditRequests,
                          unknown: summary.pricingCoverage.unknownBillingRequests,
                        })}
                      </small>
                    </span>
                    <span className={styles.costCell} data-label={t('usage_stats.pricing_api_usd')}>
                      <strong>
                        {summary.pricingCoverage.pricedRequests > 0
                          ? formatUsd(summary.estimatedAmount)
                          : '--'}
                      </strong>
                      <small>
                        {summary.pricingCoverage.totalRequests > 0
                          ? `${(summary.pricingCoverage.pricedRequestRatio * 100).toFixed(1)}%`
                          : t('usage_stats.pricing_no_api_requests')}
                      </small>
                    </span>
                  </button>
                );
              })}
              {filteredSummaries.length === 0 && (
                <div className={styles.noMatches} role="status">
                  {t('usage_stats.pricing_no_matches')}
                </div>
              )}
            </div>
          </div>
          {!isEditorModal && (
            <aside
              className={styles.editorPanel}
              aria-label={t('usage_stats.pricing_editor_title')}
            >
              {renderEditor()}
            </aside>
          )}
        </div>
      )}

      <Modal
        open={isEditorModal && mobileEditorOpen}
        title={selectedSummary?.modelName ?? t('usage_stats.pricing_editor_title')}
        onClose={() => setMobileEditorOpen(false)}
        width={isMobile ? '100%' : '760px'}
        className={styles.mobileEditorModal}
      >
        {renderEditor()}
      </Modal>
    </div>
  );
}
