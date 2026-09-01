import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';
import { STORAGE_KEY_THEME } from '@/utils/constants';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  initializeTheme: () => () => void;
}

const normalizeTheme = (value: unknown): Theme => {
  if (value === 'mist') return value;
  return 'white';
};

const applyTheme = (theme: Theme) => {
  if (theme === 'white') {
    document.documentElement.removeAttribute('data-theme');
    return;
  }
  document.documentElement.setAttribute('data-theme', theme);
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'white',
      setTheme: (theme) => {
        const normalized = normalizeTheme(theme);
        applyTheme(normalized);
        set({ theme: normalized });
      },
      initializeTheme: () => {
        const normalized = normalizeTheme(get().theme);
        get().setTheme(normalized);
        return () => {};
      },
    }),
    {
      name: STORAGE_KEY_THEME,
      version: 3,
      partialize: (state) => ({ theme: state.theme }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as { theme?: unknown };
        return { theme: normalizeTheme(state.theme) };
      },
    }
  )
);
