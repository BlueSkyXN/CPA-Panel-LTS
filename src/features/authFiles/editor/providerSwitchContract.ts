import { normalizeProviderKey } from '@/features/authFiles/constants';

/**
 * Whether committing `nextValue` on the provider field needs the
 * unsaved-changes confirmation before the editor switches providers.
 * Shared by the three auth-files edit pages (model policy, model alias,
 * excluded models) so the guard condition lives in exactly one place.
 *
 * Contract: a clean page, or a commit that resolves to the provider being
 * edited, applies directly and never resets drafts. Only unsaved drafts
 * plus a different target provider ask first.
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
