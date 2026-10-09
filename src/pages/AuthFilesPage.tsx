import {
  useCallback,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { IconChevronDown, IconChevronUp, IconFilterAll, IconSearch } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { copyToClipboard } from '@/utils/clipboard';
import {
  MAX_CARD_PAGE_SIZE,
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type QuotaProviderType,
} from '@/features/authFiles/constants';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileActionsMenu } from '@/features/authFiles/components/AuthFileActionsMenu';
import {
  authFileProvider,
  authFileProviderOptions,
  matchesAuthFileSearch,
  matchesAuthFileStatus,
  sortAuthFiles,
} from '@/features/authFiles/listView';
import { isAccountFormProvider } from '@/features/authFiles/patProviders';
import { PatAccountModal } from '@/features/authFiles/components/PatAccountModal';
import type { AuthFileItem } from '@/types';
import { ProviderIcon } from '@/features/authFiles/components/ProviderIcon';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { invalidateAuthFileDerivedCaches } from '@/features/authFiles/cacheInvalidation';
import {
  CodexRemoteCloudConnectEnvironmentsModal,
  areCodexRemoteCloudConnectEnvironmentSummariesEqual,
  useCodexRemoteCloudConnectEnvironments,
  type CodexRemoteCloudConnectEnvironmentSummary,
} from '@/lts/codexRemoteCloudConnect';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  defaultAuthFilesSortDirection,
  isAuthFilesSortMode,
  resolveAuthFilesSort,
  resolveAuthFilesStatusFilter,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesSortMode,
  type AuthFilesSortDirection,
  type AuthFilesStatusFilter,
} from '@/features/authFiles/uiState';
import { useAuthStore, useNotificationStore } from '@/stores';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const DEFAULT_REGULAR_PAGE_SIZE = 9;
const DEFAULT_COMPACT_PAGE_SIZE = 12;

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProvider = normalizeProviderKey(searchParams.get('provider') || '');

  const [filter, setFilter] = useState<'all' | string>('all');
  const [patTarget, setPatTarget] = useState<AuthFileItem | null | undefined>(undefined);
  const supportsPat = useAuthStore((s) => s.pluginSupportKnown && s.supportsPlugin);
  const [statusFilter, setStatusFilter] = useState<AuthFilesStatusFilter>('all');
  const problemOnly = statusFilter === 'problem';
  const disabledOnly = statusFilter === 'disabled';
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeByMode, setPageSizeByMode] = useState({
    regular: DEFAULT_REGULAR_PAGE_SIZE,
    compact: DEFAULT_COMPACT_PAGE_SIZE,
  });
  const [pageSizeInput, setPageSizeInput] = useState('9');
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [sortDirection, setSortDirection] = useState<AuthFilesSortDirection>('asc');
  const [codexRemoteCloudConnectSummaryCache, setCodexRemoteCloudConnectSummaryCache] = useState<
    Map<string, CodexRemoteCloudConnectEnvironmentSummary>
  >(() => new Map());
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const filterTagsRef = useRef<HTMLDivElement>(null);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
    invalidateModels,
  } = useAuthFilesModels();

  const invalidateDerivedCaches = useCallback(
    (names?: string[]) => invalidateAuthFileDerivedCaches(invalidateModels, names),
    [invalidateModels]
  );

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    refreshing,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData({ onFilesMutated: invalidateDerivedCaches });

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
    onFileMutated: (name) => invalidateDerivedCaches([name]),
  });

  const {
    codexRemoteCloudConnectEnvironments,
    openCodexRemoteCloudConnectEnvironments,
    refreshCodexRemoteCloudConnectEnvironments,
    closeCodexRemoteCloudConnectEnvironments,
    deleteCodexRemoteCloudConnectEnvironment,
  } = useCodexRemoteCloudConnectEnvironments();

  useEffect(() => {
    const { fileName, summary } = codexRemoteCloudConnectEnvironments;
    if (!fileName || !summary) return;

    setCodexRemoteCloudConnectSummaryCache((current) => {
      const existing = current.get(fileName);
      if (areCodexRemoteCloudConnectEnvironmentSummariesEqual(existing ?? null, summary)) {
        return current;
      }
      const next = new Map(current);
      next.set(fileName, summary);
      return next;
    });
  }, [codexRemoteCloudConnectEnvironments]);

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const patDetailActive = isAccountFormProvider(normalizedFilter);
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const pageSize = compactMode ? pageSizeByMode.compact : pageSizeByMode.regular;

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(normalizeProviderKey(persisted.filter));
      }
      setStatusFilter(resolveAuthFilesStatusFilter(persisted));
      if (typeof persistedCompactMode !== 'boolean' && typeof persisted.compactMode === 'boolean') {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      const legacyPageSize =
        typeof persisted.pageSize === 'number' && Number.isFinite(persisted.pageSize)
          ? clampCardPageSize(persisted.pageSize)
          : null;
      const regularPageSize =
        typeof persisted.regularPageSize === 'number' && Number.isFinite(persisted.regularPageSize)
          ? clampCardPageSize(persisted.regularPageSize)
          : (legacyPageSize ?? DEFAULT_REGULAR_PAGE_SIZE);
      const compactPageSize =
        typeof persisted.compactPageSize === 'number' && Number.isFinite(persisted.compactPageSize)
          ? clampCardPageSize(persisted.compactPageSize)
          : (legacyPageSize ?? DEFAULT_COMPACT_PAGE_SIZE);
      setPageSizeByMode({
        regular: regularPageSize,
        compact: compactPageSize,
      });
      const sorting = resolveAuthFilesSort(persisted);
      setSortMode(sorting.mode);
      setSortDirection(sorting.direction);
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!requestedProvider) return;
    setFilter(requestedProvider);
    setPage(1);
  }, [requestedProvider]);

  const handleProviderFilterChange = useCallback(
    (type: string) => {
      const nextType = normalizeProviderKey(type) || 'all';
      setFilter(nextType);
      setPage(1);
      const nextParams = new URLSearchParams(searchParams);
      if (nextType === 'all') nextParams.delete('provider');
      else nextParams.set('provider', nextType);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      problemOnly,
      disabledOnly,
      compactMode,
      search,
      page,
      pageSize,
      regularPageSize: pageSizeByMode.regular,
      compactPageSize: pageSizeByMode.compact,
      sortMode,
      sortDirection,
      statusFilter,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    disabledOnly,
    filter,
    page,
    pageSize,
    pageSizeByMode,
    problemOnly,
    search,
    sortMode,
    sortDirection,
    statusFilter,
    uiStateHydrated,
  ]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const setCurrentModePageSize = useCallback(
    (next: number) => {
      setPageSizeByMode((current) =>
        compactMode ? { ...current, compact: next } : { ...current, regular: next }
      );
    },
    [compactMode]
  );

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setCurrentModePageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE || rounded > MAX_CARD_PAGE_SIZE) return;

    setCurrentModePageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setSortDirection(defaultAuthFilesSortDirection(value));
      setPage(1);
    },
    [sortMode]
  );

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void loadFiles({ background: true }).catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  const existingTypes = useMemo(
    () => authFileProviderOptions(files, requestedProvider),
    [files, requestedProvider]
  );

  useEffect(() => {
    const rail = filterTagsRef.current;
    const active = rail?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!rail || !active || rail.scrollWidth <= rail.clientWidth) return;
    rail.scrollLeft = Math.max(0, active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2);
  }, [normalizedFilter, existingTypes]);

  const filesMatchingStatusFilters = useMemo(
    () => files.filter((file) => matchesAuthFileStatus(file, statusFilter)),
    [files, statusFilter]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'name', label: t('auth_files.sort_name') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'modified', label: t('auth_files.sort_modified') },
      { value: 'priority', label: t('auth_files.sort_priority') },
    ],
    [t]
  );
  const sortDirectionLabel = t(
    `auth_files.sort_${sortMode === 'modified' ? 'time' : sortMode === 'priority' ? 'priority' : 'name'}_${sortDirection}`
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingStatusFilters.length };
    filesMatchingStatusFilters.forEach((file) => {
      const type = authFileProvider(file);
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingStatusFilters]);

  const filtered = useMemo(
    () =>
      filesMatchingStatusFilters.filter((item) => {
        const type = authFileProvider(item);
        return (
          (normalizedFilter === 'all' || type === normalizedFilter) &&
          matchesAuthFileSearch(item, search)
        );
      }),
    [filesMatchingStatusFilters, normalizedFilter, search]
  );

  const sorted = useMemo(
    () => sortAuthFiles(filtered, sortMode, sortDirection),
    [filtered, sortMode, sortDirection]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = sorted.slice(start, start + pageSize);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const copyFileName = useCallback(
    async (name: string) => {
      const copied = await copyToClipboard(name);
      showNotification(
        t(copied ? 'auth_files.filename_copied' : 'notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  useActionBarHeightVar(
    floatingBatchActionsRef,
    '--auth-files-action-bar-height',
    batchActionBarVisible
  );

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const renderFilterTags = () => (
    <div className={styles.filterRail}>
      <div ref={filterTagsRef} className={styles.filterTags}>
        {existingTypes.map((type) => {
          const isActive = normalizedFilter === type;
          const color =
            type === 'all'
              ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
              : getTypeColor(type);
          const buttonStyle = {
            '--filter-color': color.text,
            '--filter-surface': color.bg,
            '--filter-active-text': '#ffffff',
          } as CSSProperties;

          return (
            <button
              key={type}
              className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
              style={buttonStyle}
              aria-pressed={isActive}
              onClick={() => handleProviderFilterChange(type)}
            >
              <span className={styles.filterTagLabel}>
                {type === 'all' ? (
                  <span className={`${styles.filterTagIconWrap} ${styles.filterAllIconWrap}`}>
                    <IconFilterAll className={styles.filterAllIcon} size={16} />
                  </span>
                ) : (
                  <ProviderIcon provider={type} size="nav" className={styles.filterTagIconWrap} />
                )}
                <span className={styles.filterTagText}>{getTypeLabel(t, type)}</span>
              </span>
              <span className={styles.filterTagCount}>{typeCounts[type] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('auth_files.title_section')}</span>
      {files.length > 0 && <span className={styles.countBadge}>{files.length}</span>}
    </div>
  );

  const deleteAllButtonLabel = (() => {
    if (disabledOnly) {
      return t('auth_files.delete_filtered_result_button');
    }
    if (problemOnly) {
      return normalizedFilter === 'all'
        ? t('auth_files.delete_problem_button')
        : t('auth_files.delete_problem_button_with_type', {
            type: getTypeLabel(t, normalizedFilter),
          });
    }
    return normalizedFilter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, normalizedFilter)}`;
  })();

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={disableControls || !supportsPat}
              title={!supportsPat ? t('pat_accounts.plugin_unavailable') : undefined}
              onClick={() => setPatTarget(null)}
            >
              {t('pat_accounts.add')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleHeaderRefresh}
              disabled={loading || refreshing}
              loading={loading || refreshing}
            >
              {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || uploading}
              loading={uploading}
            >
              {t('auth_files.upload_button')}
            </Button>
            <AuthFileActionsMenu
              label={t('auth_files.more_actions')}
              actions={[
                {
                  label: deleteAllButtonLabel,
                  danger: true,
                  disabled: disableControls || loading || deletingAll || Boolean(search.trim()),
                  onClick: () =>
                    handleDeleteAll({
                      filter,
                      problemOnly,
                      disabledOnly,
                      onResetFilterToAll: () => handleProviderFilterChange('all'),
                      onResetProblemOnly: () => setStatusFilter('all'),
                      onResetDisabledOnly: () => setStatusFilter('all'),
                    }),
                },
              ]}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterContent}>
            <div className={styles.filterControlsPanel}>
              <div className={styles.filterControls}>
                <div className={`${styles.filterItem} ${styles.filterSearchItem}`}>
                  <label htmlFor="auth-files-search">{t('auth_files.search_label')}</label>
                  <Input
                    id="auth-files-search"
                    className={styles.searchInput}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('auth_files.search_placeholder')}
                    rightElement={<IconSearch className={styles.searchIcon} size={18} />}
                  />
                </div>
                <div className={styles.filterItem}>
                  <label id="auth-files-status-label">{t('auth_files.status_filter_label')}</label>
                  <Select
                    value={statusFilter}
                    options={[
                      { value: 'all', label: t('auth_files.status_filter_all') },
                      { value: 'problem', label: t('auth_files.problem_filter_only') },
                      { value: 'disabled', label: t('auth_files.disabled_filter_only') },
                    ]}
                    onChange={(value) => {
                      if (value !== 'all' && value !== 'problem' && value !== 'disabled') return;
                      setStatusFilter(value);
                      setPage(1);
                    }}
                    ariaLabelledBy="auth-files-status-label"
                  />
                </div>
                <div className={styles.filterItem}>
                  <label id="auth-files-sort-label">{t('auth_files.sort_label')}</label>
                  <div className={styles.sortControls}>
                    <Select
                      className={styles.sortSelect}
                      value={sortMode}
                      options={sortOptions}
                      onChange={handleSortModeChange}
                      ariaLabelledBy="auth-files-sort-label"
                      ariaDescribedBy="auth-files-sort-hint"
                    />
                    {sortMode !== 'default' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className={styles.sortDirectionButton}
                        aria-label={t('auth_files.sort_direction', {
                          direction: sortDirectionLabel,
                        })}
                        onClick={() => {
                          setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
                          setPage(1);
                        }}
                      >
                        {sortDirection === 'asc' ? (
                          <IconChevronUp size={14} />
                        ) : (
                          <IconChevronDown size={14} />
                        )}
                        {sortDirectionLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className={styles.viewControls}>
                <div className={styles.resultsSummary}>
                  <span role="status">
                    {t('auth_files.results_summary', { shown: sorted.length, total: files.length })}
                  </span>
                  <span id="auth-files-sort-hint" className={styles.sortHint}>
                    {t('auth_files.sort_display_only')}
                  </span>
                </div>
                <div className={styles.displayControls}>
                  <ToggleSwitch
                    checked={compactMode}
                    onChange={(value) => {
                      setCompactMode(value);
                      setPage(1);
                    }}
                    ariaLabel={t('auth_files.compact_mode_label')}
                    label={
                      <span className={styles.filterToggleLabel}>
                        {t('auth_files.compact_mode_label')}
                      </span>
                    }
                  />
                  <label className={styles.pageSizeControl}>
                    {t('auth_files.page_size_label')}
                    <input
                      className={styles.pageSizeSelect}
                      type="number"
                      min={MIN_CARD_PAGE_SIZE}
                      max={MAX_CARD_PAGE_SIZE}
                      step={1}
                      value={pageSizeInput}
                      onChange={handlePageSizeChange}
                      onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </label>
                </div>
              </div>
              {search.trim() && (
                <span className={styles.sortHint}>{t('auth_files.search_delete_hint')}</span>
              )}
            </div>

            {loading ? (
              <div className={styles.hint}>{t('common.loading')}</div>
            ) : pageItems.length === 0 ? (
              <EmptyState
                title={t('auth_files.search_empty_title')}
                description={t('auth_files.search_empty_desc')}
              />
            ) : (
              <div
                className={`${styles.fileGrid} ${quotaFilterType ? styles.fileGridQuotaManaged : ''} ${compactMode ? styles.fileGridCompact : ''}`}
              >
                {pageItems.map((file) => (
                  <AuthFileCard
                    key={file.name}
                    file={file}
                    compact={compactMode}
                    selected={selectedFiles.has(file.name)}
                    disableControls={disableControls}
                    deleting={deleting}
                    statusUpdating={statusUpdating}
                    quotaFilterType={quotaFilterType}
                    patDetailActive={patDetailActive}
                    statusBarCache={statusBarCache}
                    codexRemoteCloudConnectSummary={codexRemoteCloudConnectSummaryCache.get(
                      file.name
                    )}
                    onShowModels={showModels}
                    onUpdatePat={supportsPat ? setPatTarget : undefined}
                    onShowCodexRemoteCloudConnectEnvironments={
                      openCodexRemoteCloudConnectEnvironments
                    }
                    onCopyName={copyFileName}
                    onDownload={handleDownload}
                    onOpenPrefixProxyEditor={openPrefixProxyEditor}
                    onDelete={handleDelete}
                    onToggleStatus={handleStatusToggle}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}

            {!loading && sorted.length > pageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: currentPage,
                    total: totalPages,
                    count: sorted.length,
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <OAuthExcludedCard
        disableControls={disableControls}
        excludedError={excludedError}
        excluded={excluded}
        onRetry={loadExcluded}
        onAdd={() => openExcludedEditor()}
        onEdit={openExcludedEditor}
        onDelete={deleteExcluded}
      />

      <OAuthModelAliasCard
        disableControls={disableControls}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRetry={loadModelAlias}
        onAdd={() => openModelAliasEditor()}
        onEditProvider={openModelAliasEditor}
        onDeleteProvider={deleteModelAlias}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
      />

      {patTarget !== undefined && (
        <PatAccountModal
          file={patTarget ?? undefined}
          onClose={() => setPatTarget(undefined)}
          onSaved={(name) => {
            invalidateDerivedCaches([name]);
            setPatTarget(undefined);
            showNotification(t('pat_accounts.saved'), 'success');
            void loadFiles({ background: true });
          }}
        />
      )}

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <CodexRemoteCloudConnectEnvironmentsModal
        open={codexRemoteCloudConnectEnvironments.open}
        fileName={codexRemoteCloudConnectEnvironments.fileName}
        loading={codexRemoteCloudConnectEnvironments.loading}
        error={codexRemoteCloudConnectEnvironments.error}
        environments={codexRemoteCloudConnectEnvironments.environments}
        truncated={codexRemoteCloudConnectEnvironments.truncated}
        deletingId={codexRemoteCloudConnectEnvironments.deletingId}
        lastAction={codexRemoteCloudConnectEnvironments.lastAction}
        onClose={closeCodexRemoteCloudConnectEnvironments}
        onRefresh={refreshCodexRemoteCloudConnectEnvironments}
        onCopyText={copyTextWithNotification}
        onDelete={deleteCodexRemoteCloudConnectEnvironment}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
