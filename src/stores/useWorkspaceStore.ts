import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkspaceLayout } from '@/types';
import { STORAGE_KEY_WORKSPACE_LAYOUT } from '@/utils/constants';

interface WorkspaceState {
  layout: WorkspaceLayout;
  setLayout: (layout: WorkspaceLayout) => void;
  initializeLayout: () => () => void;
}

const normalizeLayout = (value: unknown): WorkspaceLayout => {
  if (value === 'studio' || value === 'console') return value;
  return 'tower';
};

const applyLayout = (layout: WorkspaceLayout) => {
  document.documentElement.setAttribute('data-layout', layout);
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      layout: 'tower',
      setLayout: (layout) => {
        const normalized = normalizeLayout(layout);
        applyLayout(normalized);
        set({ layout: normalized });
      },
      initializeLayout: () => {
        get().setLayout(normalizeLayout(get().layout));
        return () => {};
      },
    }),
    {
      name: STORAGE_KEY_WORKSPACE_LAYOUT,
      version: 1,
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<WorkspaceState> & { layout?: unknown };
        return { ...state, layout: normalizeLayout(state.layout) };
      },
    }
  )
);
