import type { AuthFileItem } from '@/types';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  OAUTH_PROVIDER_PRESETS,
  isProblemAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
} from './constants';
import type { AuthFilesSortMode, AuthFilesSortDirection, AuthFilesStatusFilter } from './uiState';

const nameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const providerRanks = new Map(
  OAUTH_PROVIDER_PRESETS.map((provider, index) => [normalizeProviderKey(provider), index])
);

const compareNames = (left: string, right: string) =>
  nameCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);

export const authFileDisplayName = (file: AuthFileItem): string =>
  (typeof file.label === 'string' ? file.label.trim() : '') || file.name;

export const authFileProvider = (file: AuthFileItem): string =>
  normalizeProviderKey(String(file.type ?? file.provider ?? '')) || 'unknown';

export const compareAuthFileProviders = (left: string, right: string): number =>
  (providerRanks.get(left) ?? providerRanks.size) -
    (providerRanks.get(right) ?? providerRanks.size) || compareNames(left, right);

export const authFileProviderOptions = (
  files: AuthFileItem[],
  requestedProvider = ''
): string[] => {
  const providers = new Set(files.map(authFileProvider));
  const requested = normalizeProviderKey(requestedProvider);
  if (requested && requested !== 'all') providers.add(requested);
  providers.delete('all');
  return ['all', ...Array.from(providers).sort(compareAuthFileProviders)];
};

export const matchesAuthFileStatus = (
  file: AuthFileItem,
  status: AuthFilesStatusFilter
): boolean =>
  status === 'problem'
    ? isProblemAuthFile(file)
    : status === 'disabled'
      ? file.disabled === true
      : true;

export const matchesAuthFileSearch = (file: AuthFileItem, search: string): boolean => {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  const pattern = term.includes('*')
    ? new RegExp(
        term
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*'),
        'i'
      )
    : null;
  return [authFileDisplayName(file), file.name, file.type, file.provider].some((value) => {
    const text = typeof value === 'string' ? value : '';
    return pattern ? pattern.test(text) : text.toLowerCase().includes(term);
  });
};

// Only modification fields participate; token refresh time is not file modification time.
export const authFileModifiedTime = (file: AuthFileItem): number | undefined => {
  for (const value of [file.modtime, file.updated_at, file.modified]) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    if (typeof value === 'string' && !value.trim()) continue;
    const number = Number(value);
    const timestamp = Number.isFinite(number)
      ? number < 1e12
        ? number * 1000
        : number
      : parseTimestampMs(value);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return undefined;
};

export const sortAuthFiles = (
  files: AuthFileItem[],
  mode: AuthFilesSortMode,
  direction: AuthFilesSortDirection
): AuthFileItem[] => {
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...files].sort((left, right) => {
    let compared = 0;
    switch (mode) {
      case 'default':
        return (
          compareAuthFileProviders(authFileProvider(left), authFileProvider(right)) ||
          compareNames(authFileDisplayName(left), authFileDisplayName(right)) ||
          compareNames(left.name, right.name)
        );
      case 'name':
        compared = nameCollator.compare(authFileDisplayName(left), authFileDisplayName(right));
        break;
      case 'az':
        compared = nameCollator.compare(left.name, right.name);
        break;
      case 'modified': {
        const leftTime = authFileModifiedTime(left);
        const rightTime = authFileModifiedTime(right);
        if (leftTime === undefined || rightTime === undefined) {
          if (leftTime !== rightTime) return leftTime === undefined ? 1 : -1;
        } else compared = leftTime - rightTime;
        break;
      }
      case 'priority':
        compared =
          (parsePriorityValue(left.priority) ?? 0) - (parsePriorityValue(right.priority) ?? 0);
        break;
    }
    return compared * multiplier || compareNames(left.name, right.name);
  });
};
