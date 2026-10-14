import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconInfo } from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore, useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  buildOAuthProviderOptions,
  canWriteOAuthConfig,
  getTypeLabel,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import type { OAuthModelPolicyList } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
import styles from './AuthFilesOAuthExcludedEditPage.module.scss';

type LocationState = { fromAuthFiles?: boolean } | null;

type PolicyListDraft = { enabled: boolean; text: string };

const emptyListDraft = (): PolicyListDraft => ({ enabled: false, text: '' });

const draftFromList = (list: OAuthModelPolicyList | null | undefined): PolicyListDraft =>
  list ? { enabled: list.enabled, text: list.models.join('\n') } : emptyListDraft();

const parseListText = (text: string): string[] => {
  const seen = new Set<string>();
  const models: string[] = [];
  text
    .split(/[\n,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .forEach((entry) => {
      if (!entry || seen.has(entry)) return;
      seen.add(entry);
      models.push(entry);
    });
  return models;
};

const draftSignature = (draft: PolicyListDraft): string =>
  `${draft.enabled ? '1' : '0'}|${parseListText(draft.text).sort().join(',')}`;

export function AuthFilesModelPolicyEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showConfirmation, showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const [searchParams, setSearchParams] = useSearchParams();
  const providerFromParams = searchParams.get('provider') ?? '';

  const [provider, setProvider] = useState(providerFromParams);
  const [files, setFiles] = useState<
    { name: string; type?: string; provider?: string; disabled?: boolean }[]
  >([]);
  const [policies, setPolicies] = useState<
    Record<
      string,
      { allowlist?: OAuthModelPolicyList | null; denylist?: OAuthModelPolicyList | null }
    >
  >({});
  const [legacyExcluded, setLegacyExcluded] = useState<Record<string, string[]>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [baselineReady, setBaselineReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const loadRequestRef = useRef(0);

  const [allowDraft, setAllowDraft] = useState<PolicyListDraft>(emptyListDraft());
  const [denyDraft, setDenyDraft] = useState<PolicyListDraft>(emptyListDraft());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProvider(providerFromParams);
  }, [providerFromParams]);

  const resolvedProviderKey = useMemo(() => normalizeProviderKey(provider), [provider]);

  const providerOptions = useMemo(() => {
    const extra = new Set<string>();
    Object.keys(policies).forEach((value) => extra.add(value));
    Object.keys(legacyExcluded).forEach((value) => extra.add(value));
    files.forEach((file) => {
      if (typeof file.type === 'string') extra.add(file.type);
      if (typeof file.provider === 'string') extra.add(file.provider);
    });
    return buildOAuthProviderOptions(extra);
  }, [files, legacyExcluded, policies]);

  const loadInitialData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setInitialLoading(true);
    setInitialLoadError(null);
    setBaselineReady(false);
    setUnsupported(false);

    try {
      const [filesResult, policyResult, legacyResult] = await Promise.allSettled([
        authFilesApi.list(),
        authFilesApi.getOauthModelPolicy(),
        authFilesApi.getOauthExcludedModels(),
      ]);
      if (requestId !== loadRequestRef.current) return;

      if (filesResult.status === 'fulfilled') {
        setFiles(filesResult.value?.files ?? []);
      }
      if (legacyResult.status === 'fulfilled') {
        setLegacyExcluded(legacyResult.value ?? {});
      }
      if (policyResult.status === 'fulfilled') {
        setPolicies(policyResult.value ?? {});
        setBaselineReady(true);
        return;
      }
      const err = policyResult.reason;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;
      if (status === 404) {
        setUnsupported(true);
        return;
      }
      setInitialLoadError(getErrorMessage(err));
    } catch (err: unknown) {
      if (requestId === loadRequestRef.current) {
        setInitialLoadError(getErrorMessage(err));
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadInitialData();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadInitialData]);

  const entry = policies[resolvedProviderKey];
  const baselineSignature = useMemo(() => {
    return `${draftSignature(draftFromList(entry?.allowlist))}#${draftSignature(draftFromList(entry?.denylist))}`;
  }, [entry]);
  const currentSignature = useMemo(
    () => `${draftSignature(allowDraft)}#${draftSignature(denyDraft)}`,
    [allowDraft, denyDraft]
  );

  useEffect(() => {
    setAllowDraft(draftFromList(entry?.allowlist));
    setDenyDraft(draftFromList(entry?.denylist));
  }, [entry, resolvedProviderKey]);

  const isDirty = baselineReady && baselineSignature !== currentSignature;

  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
    }),
    [t]
  );
  const { allowNextNavigation } = useUnsavedChangesGuard({
    shouldBlock: isDirty,
    dialog: unsavedChangesDialog,
  });

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAuthFiles) {
      navigate(-1);
      return;
    }
    navigate('/auth-files', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

  const legacyRules = useMemo(
    () => legacyExcluded[resolvedProviderKey] ?? [],
    [legacyExcluded, resolvedProviderKey]
  );

  const applyProviderChange = useCallback(
    (value: string) => {
      const apply = () => {
        allowNextNavigation();
        setProvider(value);
        const next = new URLSearchParams(searchParams);
        const trimmed = value.trim();
        if (trimmed) {
          next.set('provider', trimmed);
        } else {
          next.delete('provider');
        }
        setSearchParams(next, { replace: true });
      };
      if (isDirty && normalizeProviderKey(value) !== resolvedProviderKey) {
        showConfirmation({ ...unsavedChangesDialog, onConfirm: apply });
        return;
      }
      apply();
    },
    [
      allowNextNavigation,
      isDirty,
      resolvedProviderKey,
      searchParams,
      setSearchParams,
      showConfirmation,
      unsavedChangesDialog,
    ]
  );

  const handleSave = useCallback(async () => {
    if (
      !canWriteOAuthConfig({
        baselineReady,
        loadError: initialLoadError,
        unsupported,
      })
    ) {
      showNotification(t('notification.refresh_failed'), 'error');
      return;
    }
    if (!resolvedProviderKey) {
      showNotification(t('model_policy.provider_required'), 'error');
      return;
    }
    const allowModels = parseListText(allowDraft.text);
    const denyModels = parseListText(denyDraft.text);
    const hasAllow = allowDraft.enabled || allowModels.length > 0;
    const hasDeny = denyDraft.enabled || denyModels.length > 0;

    setSaving(true);
    try {
      await authFilesApi.saveOauthModelPolicy(
        resolvedProviderKey,
        hasAllow || hasDeny
          ? {
              allowlist: hasAllow ? { enabled: allowDraft.enabled, models: allowModels } : null,
              denylist: hasDeny ? { enabled: denyDraft.enabled, models: denyModels } : null,
            }
          : null
      );
      showNotification(t('model_policy.save_success'), 'success');
      allowNextNavigation();
      handleBack();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('model_policy.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowDraft,
    allowNextNavigation,
    baselineReady,
    denyDraft,
    handleBack,
    initialLoadError,
    resolvedProviderKey,
    showNotification,
    t,
    unsupported,
  ]);

  // 两次写入按顺序执行：新 denylist 成功后再删旧键，第二步失败时旧限制仍保留。
  const handleMigrateLegacy = useCallback(() => {
    if (!resolvedProviderKey || legacyRules.length === 0) return;
    showConfirmation({
      title: t('model_policy.migrate_title'),
      message: t('model_policy.migrate_message', { count: legacyRules.length }),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setSaving(true);
        try {
          const merged = parseListText(`${denyDraft.text}\n${legacyRules.join('\n')}`);
          await authFilesApi.saveOauthModelPolicy(resolvedProviderKey, {
            allowlist:
              allowDraft.enabled || parseListText(allowDraft.text).length > 0
                ? { enabled: allowDraft.enabled, models: parseListText(allowDraft.text) }
                : null,
            denylist: { enabled: true, models: merged },
          });
          await authFilesApi.deleteOauthExcludedEntry(resolvedProviderKey);
          showNotification(t('model_policy.migrate_success'), 'success');
          await loadInitialData();
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : '';
          showNotification(`${t('model_policy.save_failed')}: ${errorMessage}`, 'error');
        } finally {
          setSaving(false);
        }
      },
    });
  }, [
    allowDraft,
    denyDraft.text,
    legacyRules,
    loadInitialData,
    resolvedProviderKey,
    showConfirmation,
    showNotification,
    t,
  ]);

  const canSave =
    !disableControls &&
    !saving &&
    isDirty &&
    Boolean(resolvedProviderKey) &&
    canWriteOAuthConfig({
      baselineReady,
      loadError: initialLoadError,
      unsupported,
    });

  const listSection = (
    label: string,
    hint: string,
    draft: PolicyListDraft,
    onChange: (next: PolicyListDraft) => void,
    textareaId: string
  ) => (
    <div className={styles.settingsSection}>
      <div className={styles.settingsRow}>
        <div className={styles.settingsInfo}>
          <label className={styles.settingsLabel}>{label}</label>
          <div className={styles.settingsDesc}>{hint}</div>
        </div>
        <div className={styles.settingsControl}>
          <ToggleSwitch
            checked={draft.enabled}
            onChange={(checked) => onChange({ ...draft, enabled: checked })}
            disabled={disableControls || saving}
            ariaLabel={label}
          />
        </div>
      </div>
      <textarea
        id={textareaId}
        aria-label={label}
        className={styles.customRuleTextarea}
        rows={4}
        value={draft.text}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
        placeholder={t('model_policy.models_placeholder')}
        disabled={disableControls || saving}
        spellCheck={false}
      />
      {textareaId === 'model-policy-allow' &&
        draft.enabled &&
        parseListText(draft.text).length === 0 && (
          <div className={styles.settingsDesc}>{t('model_policy.allow_empty_warning')}</div>
        )}
    </div>
  );

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      title={t('model_policy.edit_title')}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      contentClassName={styles.pageContent}
      rightAction={
        <Button size="sm" onClick={handleSave} loading={saving} disabled={!canSave}>
          {t('common.save')}
        </Button>
      }
      isLoading={initialLoading}
      loadingLabel={t('common.loading')}
    >
      {unsupported ? (
        <Card>
          <EmptyState
            title={t('oauth_excluded.upgrade_required_title')}
            description={t('model_policy.upgrade_required_desc')}
          />
        </Card>
      ) : initialLoadError !== null ? (
        <Card>
          <EmptyState
            title={t('notification.refresh_failed')}
            description={initialLoadError || t('notification.refresh_failed')}
            action={
              <Button variant="secondary" size="sm" onClick={() => void loadInitialData()}>
                {t('common.refresh')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className={styles.settingsCard}>
            <div className={styles.settingsHeader}>
              <div className={styles.settingsHeaderTitle}>
                <IconInfo size={16} />
                <span>{t('model_policy.title')}</span>
              </div>
              <div className={styles.settingsHeaderHint}>{t('model_policy.description')}</div>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsRow}>
                <div className={styles.settingsInfo}>
                  <label className={styles.settingsLabel} htmlFor="model-policy-provider">
                    {t('oauth_excluded.provider_label')}
                  </label>
                  <div className={styles.settingsDesc}>{t('oauth_excluded.provider_hint')}</div>
                </div>
                <div className={styles.settingsControl}>
                  <AutocompleteInput
                    id="model-policy-provider"
                    placeholder={t('oauth_excluded.provider_placeholder')}
                    value={provider}
                    onChange={applyProviderChange}
                    options={providerOptions}
                    disabled={disableControls || saving}
                    wrapperStyle={{ marginBottom: 0 }}
                  />
                </div>
              </div>

              {providerOptions.length > 0 && (
                <div className={styles.tagList}>
                  {providerOptions.map((option) => {
                    const isActive =
                      normalizeProviderKey(provider) === normalizeProviderKey(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`${styles.tag} ${isActive ? styles.tagActive : ''}`}
                        aria-pressed={isActive}
                        onClick={() => applyProviderChange(option)}
                        disabled={disableControls || saving}
                      >
                        {getTypeLabel(t, option)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card className={styles.settingsCard}>
            {listSection(
              t('model_policy.allowlist_label'),
              t('model_policy.allowlist_hint'),
              allowDraft,
              setAllowDraft,
              'model-policy-allow'
            )}
            {listSection(
              t('model_policy.denylist_label'),
              t('model_policy.denylist_hint'),
              denyDraft,
              setDenyDraft,
              'model-policy-deny'
            )}
          </Card>

          {resolvedProviderKey && legacyRules.length > 0 && (
            <Card className={styles.settingsCard}>
              <div className={styles.settingsHeader}>
                <div className={styles.settingsHeaderTitle}>{t('model_policy.legacy_title')}</div>
                <div className={styles.settingsHeaderHint}>
                  {t('model_policy.legacy_desc', { count: legacyRules.length })}
                </div>
              </div>
              <div className={styles.tagList}>
                {legacyRules.map((rule) => (
                  <span key={rule} className={styles.tag}>
                    {rule}
                  </span>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleMigrateLegacy}
                disabled={disableControls || saving}
              >
                {t('model_policy.migrate_button')}
              </Button>
            </Card>
          )}
        </>
      )}
    </SecondaryScreenShell>
  );
}
