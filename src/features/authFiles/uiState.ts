export const AUTH_FILES_SORT_MODES = ['default', 'name', 'az', 'modified', 'priority'] as const;

export type AuthFilesSortMode = (typeof AUTH_FILES_SORT_MODES)[number];
export type AuthFilesSortDirection = 'asc' | 'desc';
export type AuthFilesStatusFilter = 'all' | 'problem' | 'disabled';

export const defaultAuthFilesSortDirection = (mode: AuthFilesSortMode): AuthFilesSortDirection =>
  mode === 'priority' || mode === 'modified' ? 'desc' : 'asc';

export const resolveAuthFilesStatusFilter = (state: AuthFilesUiState): AuthFilesStatusFilter => {
  if (
    state.statusFilter === 'all' ||
    state.statusFilter === 'problem' ||
    state.statusFilter === 'disabled'
  ) {
    return state.statusFilter;
  }
  // Legacy overlapping flags could never match; retain the explicit disabled filter.
  return state.disabledOnly ? 'disabled' : state.problemOnly ? 'problem' : 'all';
};

export const resolveAuthFilesSort = (state: AuthFilesUiState) => {
  const mode = isAuthFilesSortMode(state.sortMode) ? state.sortMode : 'default';
  const direction =
    state.sortDirection === 'asc' || state.sortDirection === 'desc'
      ? state.sortDirection
      : defaultAuthFilesSortDirection(mode);
  return { mode, direction };
};

export type AuthFilesUiState = {
  filter?: string;
  problemOnly?: boolean;
  disabledOnly?: boolean;
  compactMode?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  regularPageSize?: number;
  compactPageSize?: number;
  sortMode?: AuthFilesSortMode;
  sortDirection?: AuthFilesSortDirection;
  statusFilter?: AuthFilesStatusFilter;
};

const AUTH_FILES_UI_STATE_KEY = 'authFilesPage.uiState';
const AUTH_FILES_COMPACT_MODE_KEY = 'authFilesPage.compactMode';
const AUTH_FILES_SORT_MODE_SET = new Set<AuthFilesSortMode>(AUTH_FILES_SORT_MODES);

export const isAuthFilesSortMode = (value: unknown): value is AuthFilesSortMode =>
  typeof value === 'string' && AUTH_FILES_SORT_MODE_SET.has(value as AuthFilesSortMode);

const readAuthFilesUiStateFromStorage = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): AuthFilesUiState | null => {
  if (!storage) return null;
  const raw = storage.getItem(AUTH_FILES_UI_STATE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as AuthFilesUiState;
  return parsed && typeof parsed === 'object' ? parsed : null;
};

export const readAuthFilesUiState = (): AuthFilesUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    return (
      readAuthFilesUiStateFromStorage(window.localStorage) ??
      readAuthFilesUiStateFromStorage(window.sessionStorage)
    );
  } catch {
    return null;
  }
};

export const writeAuthFilesUiState = (state: AuthFilesUiState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_FILES_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(AUTH_FILES_UI_STATE_KEY);
  } catch {
    // ignore
  }
};

export const readPersistedAuthFilesCompactMode = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_FILES_COMPACT_MODE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) === true;
  } catch {
    return null;
  }
};

export const writePersistedAuthFilesCompactMode = (compactMode: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_FILES_COMPACT_MODE_KEY, JSON.stringify(compactMode));
  } catch {
    // ignore
  }
};
