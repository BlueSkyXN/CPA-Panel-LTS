import type { ModelAlias } from '@/types';
import type { ModelEntryInput } from './types';

/**
 * Advanced per-model capabilities (upstream 5be3afe9). LTS keeps its own thinking editor
 * (`thinkingJson` + level/budget helpers in thinkingLevels.ts), so thinking is not modelled here.
 * Round-tripping these fields through the form is what keeps metadata such as force-mapping
 * when a model row is renamed (F23).
 */
export interface ModelOptionsInput {
  maxContextLength?: string;
  forceMapping?: boolean;
  isCompat?: boolean;
  supportConfigurationUpdate?: boolean;
  inputModalitiesText?: string;
  outputModalitiesText?: string;
  originalInputModalities?: string[];
  originalOutputModalities?: string[];
  inputModalitiesTouched?: boolean;
  outputModalitiesTouched?: boolean;
  useMaxCompletionTokens?: boolean;
}

export function readModelOptions(model: ModelAlias): ModelOptionsInput {
  return {
    maxContextLength: model.maxContextLength?.toString(),
    forceMapping: model.forceMapping,
    isCompat: model.isCompat,
    supportConfigurationUpdate: model.supportConfigurationUpdate,
    inputModalitiesText: model.inputModalities?.join(', '),
    outputModalitiesText: model.outputModalities?.join(', '),
    originalInputModalities: model.inputModalities,
    originalOutputModalities: model.outputModalities,
    useMaxCompletionTokens: model.useMaxCompletionTokens,
  };
}

const numberValue = (value: string | undefined) =>
  value?.trim() ? Number(value.trim()) : undefined;
const modalities = (value: string | undefined) => {
  const parts = value
    ?.trim()
    .split(/[,\s]+/)
    .filter(Boolean);
  return parts?.length ? parts : undefined;
};

export function buildModelOptions(entry: ModelEntryInput): Partial<ModelAlias> {
  return {
    maxContextLength: numberValue(entry.maxContextLength),
    forceMapping: entry.forceMapping,
    isCompat: entry.isCompat,
    supportConfigurationUpdate: entry.supportConfigurationUpdate,
    inputModalities:
      !entry.inputModalitiesTouched && entry.originalInputModalities !== undefined
        ? entry.originalInputModalities
        : modalities(entry.inputModalitiesText),
    outputModalities:
      !entry.outputModalitiesTouched && entry.originalOutputModalities !== undefined
        ? entry.originalOutputModalities
        : modalities(entry.outputModalitiesText),
    useMaxCompletionTokens: entry.useMaxCompletionTokens,
  };
}

const validInteger = (value: string | undefined) => {
  if (!value?.trim()) return true;
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value));
};

export function validateModelOptions(entries: ModelEntryInput[]): string | null {
  for (const entry of entries) {
    if (!entry.name.trim()) continue;
    if (!validInteger(entry.maxContextLength)) return 'providersPage.modelOptions.invalidContext';
  }
  return null;
}
