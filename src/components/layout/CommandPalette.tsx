import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconSearch } from '@/components/ui/icons';
import { lockScroll, unlockScroll } from '@/components/ui/scrollLock';

export interface CommandPalettePage {
  path: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  end?: boolean;
}

export interface CommandPaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
  pages: CommandPalettePage[];
  actions: CommandPaletteAction[];
}

type PaletteEntry = { kind: 'page'; index: number } | { kind: 'action'; index: number };

interface ScoredEntry {
  entry: PaletteEntry;
  score: number;
  label: string;
  meta?: string;
  hint?: string;
  icon: ReactNode;
  path?: string;
}

const scoreMatch = (query: string, target: string): number | null => {
  if (!query) return 0;
  const haystack = target.toLowerCase();
  const directIndex = haystack.indexOf(query);
  if (directIndex !== -1) {
    const wordStart = directIndex === 0 || /[\s/._-]/.test(haystack[directIndex - 1] ?? '');
    return 100 - directIndex * 2 + (wordStart ? 30 : 0);
  }

  let score = 0;
  let cursor = 0;
  let streak = 0;
  for (const char of query) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    streak = found === cursor ? streak + 1 : 0;
    score += 10 + streak * 4 - Math.min(found - cursor, 8);
    cursor = found + 1;
  }
  return score;
};

export function CommandPalette({ onClose, pages, actions }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      unlockScroll();
      if (previouslyFocusedRef.current?.isConnected) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, []);

  const scored = useMemo<ScoredEntry[]>(
    () => [
      ...pages.map((page, index) => ({
        entry: { kind: 'page', index } as PaletteEntry,
        score: 0,
        label: page.label,
        meta: page.meta,
        icon: page.icon,
        path: page.path,
      })),
      ...actions.map((action, index) => ({
        entry: { kind: 'action', index } as PaletteEntry,
        score: -10,
        label: action.label,
        meta: action.keywords,
        hint: action.hint,
        icon: action.icon,
      })),
    ],
    [pages, actions]
  );

  const results = useMemo<ScoredEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scored;
    return scored
      .map((item) => {
        const labelScore = scoreMatch(q, item.label);
        const metaScore = item.meta ? scoreMatch(q, item.meta) : null;
        const pathScore = item.path ? scoreMatch(q, item.path) : null;
        const best = Math.max(labelScore ?? -1, metaScore ?? -1, pathScore ?? -1);
        if (best < 0) return null;
        return { ...item, score: item.score + best };
      })
      .filter((item): item is ScoredEntry => item !== null)
      .sort((a, b) => b.score - a.score);
  }, [scored, query]);

  const orderedResults = useMemo(
    () => [
      ...results.filter((item) => item.entry.kind === 'page'),
      ...results.filter((item) => item.entry.kind === 'action'),
    ],
    [results]
  );
  const safeActiveIndex =
    orderedResults.length === 0 ? 0 : Math.min(activeIndex, orderedResults.length - 1);

  const runEntry = useCallback(
    (item: ScoredEntry) => {
      if (item.entry.kind === 'page' && item.path) {
        onClose();
        navigate(item.path);
        return;
      }
      if (item.entry.kind === 'action') {
        onClose();
        actions[item.entry.index]?.run();
      }
    },
    [actions, navigate, onClose]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) =>
          orderedResults.length === 0 ? 0 : (current + 1) % orderedResults.length
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) =>
          orderedResults.length === 0
            ? 0
            : (current - 1 + orderedResults.length) % orderedResults.length
        );
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(Math.max(0, orderedResults.length - 1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = orderedResults[safeActiveIndex];
        if (item) runEntry(item);
      }
    },
    [onClose, orderedResults, runEntry, safeActiveIndex]
  );

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>(`[data-index="${safeActiveIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [orderedResults.length, safeActiveIndex]);

  const pageEntries = orderedResults.filter((item) => item.entry.kind === 'page');
  const actionEntries = orderedResults.filter((item) => item.entry.kind === 'action');
  const globalIndex = new Map<ScoredEntry, number>();
  orderedResults.forEach((item, index) => globalIndex.set(item, index));

  const renderRow = (item: ScoredEntry) => {
    const index = globalIndex.get(item) ?? 0;
    const isActive = index === safeActiveIndex;
    return (
      <button
        key={`${item.entry.kind}-${item.entry.index}`}
        type="button"
        className={`command-palette-option ${isActive ? 'active' : ''}`}
        id={`command-palette-option-${index}`}
        data-index={index}
        role="option"
        aria-selected={isActive}
        tabIndex={-1}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => runEntry(item)}
      >
        <span className="command-palette-option-icon">{item.icon}</span>
        <span className="command-palette-option-body">
          <span className="command-palette-option-label">{item.label}</span>
          {item.meta ? <span className="command-palette-option-meta">{item.meta}</span> : null}
        </span>
        {item.hint ? <span className="command-palette-option-hint">{item.hint}</span> : null}
        {item.path ? <span className="command-palette-option-path">{item.path}</span> : null}
      </button>
    );
  };

  return (
    <div
      className="command-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('command_palette.title')}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-input-row">
          <span className="command-palette-search-icon">
            <IconSearch size={16} />
          </span>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={
              orderedResults[safeActiveIndex]
                ? `command-palette-option-${safeActiveIndex}`
                : undefined
            }
            placeholder={t('command_palette.placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="command-palette-kbd">Esc</kbd>
        </div>

        <div
          className="command-palette-list"
          id="command-palette-list"
          role="listbox"
          ref={listRef}
        >
          {results.length === 0 ? (
            <div className="command-palette-empty">{t('command_palette.no_results')}</div>
          ) : (
            <>
              {pageEntries.length > 0 && (
                <div className="command-palette-group">
                  <div className="command-palette-group-label">
                    {t('command_palette.group_pages')}
                  </div>
                  {pageEntries.map(renderRow)}
                </div>
              )}
              {actionEntries.length > 0 && (
                <div className="command-palette-group">
                  <div className="command-palette-group-label">
                    {t('command_palette.group_actions')}
                  </div>
                  {actionEntries.map(renderRow)}
                </div>
              )}
            </>
          )}
        </div>

        <div className="command-palette-footer">
          <span>
            <kbd className="command-palette-kbd">↑↓</kbd>
            {t('command_palette.hint_navigate')}
          </span>
          <span>
            <kbd className="command-palette-kbd">↵</kbd>
            {t('command_palette.hint_select')}
          </span>
        </div>
      </div>
    </div>
  );
}
