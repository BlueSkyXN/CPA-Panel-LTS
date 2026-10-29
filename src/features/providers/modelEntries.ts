import type { ModelInfo } from '@/utils/models';
import type { ModelEntryInput } from './types';

export function mergeDiscoveredModels(
  current: ModelEntryInput[],
  incoming: ModelInfo[]
): ModelEntryInput[] {
  if (!incoming.length) return current;
  const seen = new Set(current.map((entry) => entry.name.trim()).filter(Boolean));
  const next = current.filter((entry) =>
    Object.entries(entry).some(
      ([key, value]) =>
        key !== 'sourceIndex' &&
        value !== undefined &&
        value !== null &&
        value !== false &&
        value !== ''
    )
  );
  for (const model of incoming) {
    const name = model.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    next.push({ sourceIndex: null, name, alias: model.alias?.trim() ?? '' });
  }
  return next.length ? next : [{ sourceIndex: null, name: '', alias: '' }];
}
