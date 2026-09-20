import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Navigate, useSearchParams } from 'react-router-dom';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { parse as parseYaml, parseDocument } from 'yaml';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
} from '@/components/ui/icons';
import { VisualConfigEditor } from '@/components/config/VisualConfigEditor';
import {
  isConfigNavigationChange,
  type ConfigLocation,
} from '@/components/config/configNavigation';
import { DiffModal } from '@/components/config/DiffModal';
import {
  ConfigDraftActionBar,
  type ConfigDraftStatus,
} from '@/components/config/ConfigDraftActionBar';
import { useConfigDraftReload, useConfigSaveFailureNotifier } from '@/hooks/useConfigDraftSave';
import { normalizeYamlForVisualDiff } from '@/components/config/configDraftYaml';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { registerSessionBusyCheck } from '@/services/connectionSession';
import { getManagedConnection } from '@/services/connectionRuntime';
import { readProfiles } from '@/services/storage/connectionProfiles';
import { useVisualConfig } from '@/hooks/useVisualConfig';
import { useNotificationStore, useAuthStore, useConfigStore } from '@/stores';
import { configFileApi } from '@/services/api/configFile';
import styles from './ConfigPage.module.scss';

type ConfigEditorTab = 'visual' | 'source';

const LazyConfigSourceEditor = lazy(() => import('@/components/config/ConfigSourceEditor'));

function readCommercialModeFromYaml(yamlContent: string): boolean {
  try {
    const parsed = parseYaml(yamlContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return Boolean((parsed as Record<string, unknown>)['commercial-mode']);
  } catch {
    return false;
  }
}

export function ConfigPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const requestedSubsection = searchParams.get('subsection');
  const requestedField = searchParams.get('field');
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const notifyConfigFailure = useConfigSaveFailureNotifier();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const profileId = useAuthStore((state) => state.profileId);
  const apiBase = useAuthStore((state) => state.apiBase);
  const profile =
    getManagedConnection()?.bootstrap.profile ??
    readProfiles().find((entry) => entry.id === profileId);
  const connectionName = profile?.name || apiBase || t('connections.disconnected');

  const {
    visualValues,
    visualDirty,
    visualDirtyFields,
    visualParseError,
    visualValidationErrors,
    visualHasPayloadValidationErrors,
    loadVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  } = useVisualConfig();

  const [activeTab, setActiveTab] = useState<ConfigEditorTab>(() => {
    const saved = localStorage.getItem('config-management:tab');
    if (saved === 'visual' || saved === 'source') return saved;
    return 'visual';
  });

  const effectiveTab: ConfigEditorTab = requestedSection ? 'visual' : activeTab;

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => registerSessionBusyCheck(() => saving), [saving]);
  const [error, setError] = useState('');
  // 仅记录用户源码编辑；可视化草稿物化不改变并发合并策略。
  const [dirty, setDirty] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [serverYaml, setServerYaml] = useState('');
  const [mergedYaml, setMergedYaml] = useState('');
  const [previewServerYaml, setPreviewServerYaml] = useState('');
  const [previewTab, setPreviewTab] = useState<ConfigEditorTab>('visual');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);

  const disableControls = connectionStatus !== 'connected';
  const isDirty = dirty || visualDirty;
  const shouldRenderActionBar = isCurrentLayer;
  const hasVisualModeError = !!visualParseError;
  const hasVisualValidationErrors =
    effectiveTab === 'visual' &&
    (Object.values(visualValidationErrors).some(Boolean) || visualHasPayloadValidationErrors);
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );

  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: ({ currentLocation, nextLocation }) =>
      isDirty && !isConfigNavigationChange(currentLocation, nextLocation),
    dialog: unsavedChangesDialog,
  });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setSaved(false);
    setError('');
    try {
      const data = await configFileApi.fetchConfigYaml();
      setContent(data);
      setDirty(false);
      setDiffModalOpen(false);
      setServerYaml(data);
      setMergedYaml(data);
      setPreviewServerYaml(data);
      loadVisualValuesFromYaml(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loadVisualValuesFromYaml, t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (effectiveTab !== 'visual' || !visualParseError) return;

    setActiveTab('source');
    localStorage.setItem('config-management:tab', 'source');
    showNotification(
      t('config_management.visual_mode_unavailable_detail', { message: visualParseError }),
      'error'
    );
  }, [effectiveTab, showNotification, t, visualParseError]);

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      const latestServerYaml = await configFileApi.fetchConfigYaml();
      if (latestServerYaml !== previewServerYaml) {
        const nextMergedYaml =
          previewTab === 'visual' && !dirty
            ? applyVisualChangesToYaml(latestServerYaml)
            : mergedYaml;
        const nextServerYaml =
          previewTab === 'visual' ? normalizeYamlForVisualDiff(latestServerYaml) : latestServerYaml;

        setPreviewServerYaml(latestServerYaml);
        setServerYaml(nextServerYaml);
        setMergedYaml(nextMergedYaml);

        if (nextServerYaml === nextMergedYaml) {
          setDirty(false);
          setDiffModalOpen(false);
          setContent(latestServerYaml);
          loadVisualValuesFromYaml(latestServerYaml);
          showNotification(t('config_management.diff.no_changes'), 'info');
        }
        return;
      }

      const previousCommercialMode = readCommercialModeFromYaml(latestServerYaml);
      const nextCommercialMode = readCommercialModeFromYaml(mergedYaml);
      const commercialModeChanged = previousCommercialMode !== nextCommercialMode;

      await configFileApi.saveConfigYaml(mergedYaml);
      const latestContent = await configFileApi.fetchConfigYaml();
      setSaved(true);
      setDirty(false);
      setDiffModalOpen(false);
      setContent(latestContent);
      setServerYaml(latestContent);
      setMergedYaml(latestContent);
      setPreviewServerYaml(latestContent);
      loadVisualValuesFromYaml(latestContent);

      // Keep the global config store in sync so sidebar / other pages reflect YAML changes immediately.
      try {
        useConfigStore.getState().clearCache();
        await useConfigStore.getState().fetchConfig(undefined, true);
      } catch (refreshError: unknown) {
        const message =
          refreshError instanceof Error
            ? refreshError.message
            : typeof refreshError === 'string'
              ? refreshError
              : '';
        showNotification(
          `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      }

      showNotification(t('config_management.save_success'), 'success');
      if (commercialModeChanged) {
        showNotification(t('notification.commercial_mode_restart_required'), 'warning');
      }
    } catch (err: unknown) {
      notifyConfigFailure(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (effectiveTab === 'visual' && visualParseError) {
      showNotification(t('config_management.visual_mode_save_blocked'), 'error');
      return;
    }

    setSaving(true);
    try {
      const latestServerYaml = await configFileApi.fetchConfigYaml();

      const visualBaseYaml = dirty ? content : latestServerYaml;

      if (effectiveTab === 'visual' || !dirty) {
        const latestDocument = parseDocument(latestServerYaml);
        if (latestDocument.errors.length > 0) {
          showNotification(
            t('config_management.visual_mode_latest_yaml_invalid', {
              message:
                latestDocument.errors[0]?.message ??
                t('config_management.visual_mode_save_blocked'),
            }),
            'error'
          );
          return;
        }

        if (visualBaseYaml !== latestServerYaml) {
          const visualBaseDocument = parseDocument(visualBaseYaml);
          if (visualBaseDocument.errors.length > 0) {
            showNotification(
              t('config_management.visual_mode_latest_yaml_invalid', {
                message:
                  visualBaseDocument.errors[0]?.message ??
                  t('config_management.visual_mode_save_blocked'),
              }),
              'error'
            );
            return;
          }
        }
      }

      // 只有真正编辑过源码才保存完整草稿；查看生成的源码仍按字段合并最新服务端配置。
      const nextMergedYaml =
        effectiveTab === 'source' && dirty ? content : applyVisualChangesToYaml(visualBaseYaml);

      // In visual mode, applyVisualChangesToYaml re-serializes YAML via parseDocument → toString,
      // which may reformat comments/whitespace. Normalize the server YAML through the same pipeline
      // so the diff only shows actual value changes, not cosmetic reformatting.
      let diffOriginal = latestServerYaml;
      if (!dirty) {
        diffOriginal = normalizeYamlForVisualDiff(latestServerYaml);
      }

      if (diffOriginal === nextMergedYaml) {
        setDirty(false);
        setContent(latestServerYaml);
        setServerYaml(latestServerYaml);
        setMergedYaml(nextMergedYaml);
        setPreviewServerYaml(latestServerYaml);
        loadVisualValuesFromYaml(latestServerYaml);
        showNotification(t('config_management.diff.no_changes'), 'info');
        return;
      }

      setServerYaml(diffOriginal);
      setMergedYaml(nextMergedYaml);
      setPreviewServerYaml(latestServerYaml);
      setPreviewTab(dirty ? 'source' : 'visual');
      setDiffModalOpen(true);
    } catch (err: unknown) {
      notifyConfigFailure(err);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setDirty(true);
  }, []);

  const handleTabChange = useCallback(
    (tab: ConfigEditorTab) => {
      if (tab === effectiveTab) return;

      if (tab === 'source') {
        // Only rewrite YAML when there are pending visual changes; otherwise preserve raw YAML + comments.
        if (visualDirty) {
          try {
            const nextContent = applyVisualChangesToYaml(dirty ? content : previewServerYaml);
            if (nextContent !== content) {
              setContent(nextContent);
            }
          } catch (error: unknown) {
            notifyConfigFailure(error);
            return;
          }
        }
      } else if (dirty || visualParseError !== null) {
        const result = loadVisualValuesFromYaml(content);
        if (!result.ok) {
          showNotification(
            t('config_management.visual_mode_unavailable_detail', { message: result.error }),
            'error'
          );
          return;
        }
      }

      setActiveTab(tab);
      localStorage.setItem('config-management:tab', tab);
      if (tab === 'source' && requestedSection) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('section');
        nextParams.delete('subsection');
        nextParams.delete('field');
        setSearchParams(nextParams, { replace: true });
      }
    },
    [
      effectiveTab,
      applyVisualChangesToYaml,
      content,
      dirty,
      loadVisualValuesFromYaml,
      notifyConfigFailure,
      previewServerYaml,
      requestedSection,
      searchParams,
      setSearchParams,
      showNotification,
      t,
      visualDirty,
      visualParseError,
    ]
  );

  // Search functionality
  const performSearch = useCallback((query: string, direction: 'next' | 'prev' = 'next') => {
    if (!query || !editorRef.current?.view) return;

    const view = editorRef.current.view;
    const doc = view.state.doc.toString();
    const matches: number[] = [];
    const lowerQuery = query.toLowerCase();
    const lowerDoc = doc.toLowerCase();

    let pos = 0;
    while (pos < lowerDoc.length) {
      const index = lowerDoc.indexOf(lowerQuery, pos);
      if (index === -1) break;
      matches.push(index);
      pos = index + 1;
    }

    if (matches.length === 0) {
      setSearchResults({ current: 0, total: 0 });
      return;
    }

    // Find current match based on cursor position
    const selection = view.state.selection.main;
    const cursorPos = direction === 'prev' ? selection.from : selection.to;
    let currentIndex = 0;

    if (direction === 'next') {
      // Find next match after cursor
      for (let i = 0; i < matches.length; i++) {
        if (matches[i] > cursorPos) {
          currentIndex = i;
          break;
        }
        // If no match after cursor, wrap to first
        if (i === matches.length - 1) {
          currentIndex = 0;
        }
      }
    } else {
      // Find previous match before cursor
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i] < cursorPos) {
          currentIndex = i;
          break;
        }
        // If no match before cursor, wrap to last
        if (i === 0) {
          currentIndex = matches.length - 1;
        }
      }
    }

    const matchPos = matches[currentIndex];
    setSearchResults({ current: currentIndex + 1, total: matches.length });

    // Scroll to and select the match
    view.dispatch({
      selection: { anchor: matchPos, head: matchPos + query.length },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    // Do not auto-search on each keystroke. Clear previous results when query changes.
    if (!value) {
      setSearchResults({ current: 0, total: 0 });
      setLastSearchedQuery('');
    } else {
      setSearchResults({ current: 0, total: 0 });
    }
  }, []);

  const executeSearch = useCallback(
    (direction: 'next' | 'prev' = 'next') => {
      if (!searchQuery) return;
      setLastSearchedQuery(searchQuery);
      performSearch(searchQuery, direction);
    },
    [searchQuery, performSearch]
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch(e.shiftKey ? 'prev' : 'next');
      }
    },
    [executeSearch]
  );

  const handlePrevMatch = useCallback(() => {
    if (!lastSearchedQuery) return;
    performSearch(lastSearchedQuery, 'prev');
  }, [lastSearchedQuery, performSearch]);

  const handleNextMatch = useCallback(() => {
    if (!lastSearchedQuery) return;
    performSearch(lastSearchedQuery, 'next');
  }, [lastSearchedQuery, performSearch]);

  useActionBarHeightVar(actionBarRef, '--config-action-bar-height', shouldRenderActionBar);

  const draftStatus: ConfigDraftStatus = {
    disconnected: disableControls,
    loading,
    saving,
    loadFailed: !!error,
    yamlUnavailable: hasVisualModeError,
    validationBlocked: hasVisualValidationErrors,
    dirty: isDirty,
    saved,
  };
  const handleReload = useConfigDraftReload(loadConfig, isDirty);
  const saveDisabled =
    disableControls ||
    loading ||
    saving ||
    !isDirty ||
    diffModalOpen ||
    hasVisualModeError ||
    hasVisualValidationErrors;

  const actionBar = (
    <ConfigDraftActionBar
      barRef={actionBarRef}
      connectionName={connectionName}
      status={draftStatus}
      saveDisabled={saveDisabled}
      onReload={handleReload}
      onSave={handleSave}
    />
  );

  // Flow control moved to its own /flow-control page; keep bookmarked
  // #/config?section=flow-control deep links working.
  if (requestedSection === 'flow-control') {
    return <Navigate to="/flow-control" replace />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('config_management.title')}</h1>
        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tabItem} ${effectiveTab === 'visual' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('visual')}
            disabled={saving || loading}
          >
            {t('config_management.tabs.visual', { defaultValue: '可视化编辑' })}
          </button>
          <button
            type="button"
            className={`${styles.tabItem} ${effectiveTab === 'source' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('source')}
            disabled={saving || loading}
          >
            {t('config_management.tabs.source', { defaultValue: '源代码编辑' })}
          </button>
        </div>
      </div>

      <div className={styles.workspaceShell}>
        <div className={styles.content}>
          {error && <div className="error-box">{error}</div>}
          {!error && visualParseError && (
            <div className="error-box">
              {t('config_management.visual_mode_unavailable_detail', { message: visualParseError })}
            </div>
          )}

          {effectiveTab === 'visual' ? (
            <VisualConfigEditor
              values={visualValues}
              initialSection={requestedSection}
              initialSubsection={requestedSubsection}
              initialField={requestedField}
              dirtyFields={visualDirtyFields}
              sourceDirty={dirty}
              onNavigate={(location: ConfigLocation) => {
                const next = new URLSearchParams(searchParams);
                next.set('section', location.section);
                next.set('subsection', location.subsection);
                if (location.field) next.set('field', location.field);
                else next.delete('field');
                setSearchParams(next, { replace: true });
              }}
              validationErrors={visualValidationErrors}
              hasPayloadValidationErrors={visualHasPayloadValidationErrors}
              disabled={disableControls || loading}
              onChange={setVisualValues}
            />
          ) : (
            <div className={styles.sourceWorkspace}>
              <div className={styles.sourceToolbar}>
                <div className={styles.searchInputWrapper}>
                  <Input
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={t('config_management.search_placeholder', {
                      defaultValue: '搜索配置内容...',
                    })}
                    disabled={disableControls || loading}
                    className={styles.searchInput}
                    rightElement={
                      <div className={styles.searchRight}>
                        {searchQuery && lastSearchedQuery === searchQuery && (
                          <span className={styles.searchCount}>
                            {searchResults.total > 0
                              ? `${searchResults.current} / ${searchResults.total}`
                              : t('config_management.search_no_results', {
                                  defaultValue: '无结果',
                                })}
                          </span>
                        )}
                        <button
                          type="button"
                          className={styles.searchButton}
                          onClick={() => executeSearch('next')}
                          disabled={!searchQuery || disableControls || loading}
                          title={t('config_management.search_button', { defaultValue: '搜索' })}
                        >
                          <IconSearch size={16} />
                        </button>
                      </div>
                    }
                  />
                </div>

                <div className={styles.searchActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handlePrevMatch}
                    disabled={
                      !searchQuery || lastSearchedQuery !== searchQuery || searchResults.total === 0
                    }
                    title={t('config_management.search_prev', { defaultValue: '上一个' })}
                  >
                    <IconChevronUp size={16} />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleNextMatch}
                    disabled={
                      !searchQuery || lastSearchedQuery !== searchQuery || searchResults.total === 0
                    }
                    title={t('config_management.search_next', { defaultValue: '下一个' })}
                  >
                    <IconChevronDown size={16} />
                  </Button>
                </div>
              </div>

              <div className={styles.editorWrapper}>
                <Suspense fallback={null}>
                  <LazyConfigSourceEditor
                    editorRef={editorRef}
                    value={content}
                    onChange={handleChange}
                    theme="light"
                    editable={!disableControls && !loading}
                    placeholder={t('config_management.editor_placeholder')}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </div>

      {shouldRenderActionBar && typeof document !== 'undefined'
        ? createPortal(actionBar, document.body)
        : null}
      <DiffModal
        open={diffModalOpen}
        original={serverYaml}
        modified={mergedYaml}
        onConfirm={handleConfirmSave}
        onCancel={() => setDiffModalOpen(false)}
        loading={saving}
        targetName={connectionName}
      />
    </div>
  );
}
