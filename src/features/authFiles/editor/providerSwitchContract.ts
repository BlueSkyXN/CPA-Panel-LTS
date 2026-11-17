import { normalizeProviderKey } from '@/features/authFiles/constants';

export type ProviderSwitchEvent =
  /** Typing/filtering in the autocomplete: must never re-target the editor. */
  | { kind: 'change'; value: string }
  /** A settled value: option selected, Enter, blur, or a quick button. */
  | { kind: 'commit'; value: string }
  /** The unsaved-changes confirmation was declined (Stay). */
  | { kind: 'stay' }
  /** The unsaved-changes confirmation was accepted. */
  | { kind: 'confirm' };

export interface ProviderSwitchState {
  /** Provider actually being edited; drives drafts, baselines, URL. */
  provider: string;
  /** Autocomplete text; purely presentational while typing. */
  providerInput: string;
  /** Pending target awaiting the unsaved-changes confirmation, if any. */
  pending: string | null;
}

/**
 * Decision core for draft-safe provider switching on the auth-files edit
 * pages. Kept free of React/DOM so the full event chain runs in node:test:
 *
 * - `change` only moves the input text. Feeding it into `provider` (the
 *   dba6c341 regression) resets another provider's drafts without asking.
 * - `commit` with a clean page, or re-committing the same provider, applies
 *   directly and never resets drafts.
 * - `commit` with unsaved drafts and a different provider arms a
 *   confirmation; `stay` restores the input to the provider being edited,
 *   `confirm` applies the switch.
 */
export function reduceProviderSwitch(
  state: ProviderSwitchState,
  event: ProviderSwitchEvent,
  isDirty: boolean
): ProviderSwitchState {
  switch (event.kind) {
    case 'change':
      return { ...state, providerInput: event.value };
    case 'commit': {
      const trimmed = event.value.trim();
      if (state.pending !== null) return state;
      const sameProvider =
        normalizeProviderKey(trimmed) === normalizeProviderKey(state.provider);
      if (!isDirty || sameProvider) {
        return { provider: trimmed, providerInput: trimmed, pending: null };
      }
      return { ...state, pending: trimmed };
    }
    case 'stay':
      return { ...state, providerInput: state.provider, pending: null };
    case 'confirm': {
      if (state.pending === null) return state;
      return { provider: state.pending, providerInput: state.pending, pending: null };
    }
    default:
      return state;
  }
}

/**
 * Whether a commit needs the unsaved-changes confirmation before switching.
 * Mirrors the reducer's arming condition for pages that keep their own state.
 */
export function needsSwitchConfirmation(
  nextValue: string,
  currentProvider: string,
  isDirty: boolean
): boolean {
  if (!isDirty) return false;
  return (
    normalizeProviderKey(nextValue.trim()) !== normalizeProviderKey(currentProvider)
  );
}
