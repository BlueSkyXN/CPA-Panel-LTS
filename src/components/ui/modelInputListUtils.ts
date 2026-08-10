import type { ModelAlias } from '@/types';

export interface ModelEntry {
  name: string;
  alias: string;
  /** Fields hidden by the legacy two-column editor and restored on save. */
  preserved?: Omit<ModelAlias, 'name' | 'alias'>;
}

export const modelsToEntries = (models?: ModelAlias[]): ModelEntry[] => {
  if (!Array.isArray(models) || models.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return models.map((model) => {
    const { name, alias, ...preserved } = model;
    return {
      name: name || '',
      alias: alias || '',
      preserved: Object.keys(preserved).length ? preserved : undefined,
    };
  });
};

export const entriesToModels = (entries: ModelEntry[]): ModelAlias[] => {
  return entries
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const model: ModelAlias = {
        ...(entry.preserved ?? {}),
        name: entry.name.trim(),
      };
      const alias = entry.alias.trim();
      if (alias && alias !== model.name) {
        model.alias = alias;
      } else {
        delete model.alias;
      }
      return model;
    });
};
