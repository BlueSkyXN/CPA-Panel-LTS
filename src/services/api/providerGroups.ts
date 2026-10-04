import { apiClient } from './client';
import { configRevision } from './configRevision';
import { isRecord } from '@/utils/helpers';
import { parseConfigDocument, usesV8ConfigLayout } from '@/utils/configLayout';

export const MODEL_SOURCE_INDEX = Symbol('model-source-index');
export type ModelPayload = Record<string, unknown> & { [MODEL_SOURCE_INDEX]?: number | null };

const families: Record<string, string> = {
  'gemini-api-key': 'gemini',
  'interactions-api-key': 'interactions',
  'codex-api-key': 'codex',
  'xai-api-key': 'xai',
  'claude-api-key': 'claude',
  'vertex-api-key': 'vertex',
  'openai-compatibility': 'openai-compatibility',
};
const conflict = () =>
  new Error('Provider configuration changed or is ambiguous; refresh and try again.');
export const providerValuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]))
  );
};
const equal = providerValuesEqual;
const identity = (record: Record<string, unknown>, openai: boolean): string =>
  openai
    ? String(record.name ?? '')
    : `${String(record['api-key'] ?? '')}\u0000${String(record['base-url'] ?? '')}`;
const emptyOverride = (key: string): unknown => {
  if (['models', 'excluded-models', 'request-scoped-errors'].includes(key)) return [];
  if (['headers', 'cloak'].includes(key)) return {};
  if (['disable-cooling', 'websockets', 'disabled'].includes(key)) return false;
  if (['priority', 'weight'].includes(key)) return 0;
  if (key === 'request-retry') return -1;
  return '';
};
const cleanMetadata = (record: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !['auth-index', 'auth_index', 'authIndex'].includes(key)
    )
  );

function applyChanges(
  raw: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  inherited: Record<string, unknown> = {}
): Record<string, unknown> {
  let next = { ...raw };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[field], after[field])) continue;
    if (after[field] !== undefined) {
      const original = raw[field] ?? inherited[field];
      let value: unknown;
      if (
        field === 'models' &&
        Array.isArray(original) &&
        Array.isArray(before[field]) &&
        Array.isArray(after[field])
      ) {
        const baseline = before[field] as unknown[];
        value = (after[field] as ModelPayload[]).map((model) => {
          const index = model[MODEL_SOURCE_INDEX];
          if (typeof index !== 'number') return model;
          const rawModel = original[index],
            oldModel = baseline[index];
          if (!isRecord(rawModel) || !isRecord(oldModel)) throw conflict();
          return applyChanges(rawModel, oldModel, model);
        });
      } else if (
        field === 'api-key-entries' &&
        Array.isArray(original) &&
        Array.isArray(before[field]) &&
        Array.isArray(after[field])
      ) {
        const baseline = before[field] as unknown[];
        const desired = after[field] as unknown[];
        if (!original.every(isRecord) || !baseline.every(isRecord) || !desired.every(isRecord))
          throw conflict();
        const ids = (rows: Record<string, unknown>[]) =>
          rows.map((row) => String(row['api-key'] ?? ''));
        const rawIds = ids(original),
          oldIds = ids(baseline),
          newIds = ids(desired);
        if (
          [rawIds, oldIds, newIds].some((list) => new Set(list).size !== list.length) ||
          !equal(rawIds, oldIds)
        )
          throw conflict();
        const removed = oldIds.filter((id) => !newIds.includes(id));
        const added = newIds.filter((id) => !oldIds.includes(id));
        const rename =
          oldIds.length === newIds.length && removed.length === 1 && added.length === 1;
        if (oldIds.length === newIds.length && removed.length && !rename) throw conflict();
        value = desired.map((row, index) => {
          let source = oldIds.indexOf(newIds[index]);
          if (source < 0 && rename) source = oldIds.indexOf(removed[0]);
          return source < 0 ? row : applyChanges(original[source], baseline[source], row);
        });
      } else {
        value =
          isRecord(original) && isRecord(before[field]) && isRecord(after[field])
            ? applyChanges(original, before[field], after[field])
            : after[field];
      }
      next = { ...next, [field]: value };
    } else if (inherited[field] !== undefined && inherited[field] !== null) {
      next = { ...next, [field]: emptyOverride(field) };
    } else delete next[field];
  }
  return next;
}

export function reconcileProviderGroups(
  family: string,
  groups: Record<string, unknown>[],
  before: Record<string, unknown>[],
  after: Record<string, unknown>[]
): Record<string, unknown>[] {
  const openai = family === 'openai-compatibility';
  const sources = new Map<string, { group: number; key?: number }>();
  groups.forEach((group, groupIndex) => {
    if (!Array.isArray(group.keys) || !group.keys.every(isRecord)) throw conflict();
    const rows = openai
      ? [group]
      : group.keys.map((key) => ({ ...key, 'base-url': group['base-url'] }));
    rows.forEach((row, keyIndex) => {
      const id = identity(row, openai);
      if (sources.has(id)) throw conflict();
      sources.set(id, { group: groupIndex, key: openai ? undefined : keyIndex });
    });
  });
  const beforeIds = before.map((row) => identity(row, openai));
  if (
    new Set(beforeIds).size !== before.length ||
    before.some((row) => !sources.has(identity(row, openai))) ||
    sources.size !== before.length
  )
    throw conflict();
  const afterIds = after.map((row) => identity(row, openai));
  if (new Set(afterIds).size !== after.length) throw conflict();
  const removed = before
    .map((_, index) => index)
    .filter((index) => !afterIds.includes(beforeIds[index]));
  const added = after
    .map((_, index) => index)
    .filter((index) => !beforeIds.includes(afterIds[index]));
  const rename = before.length === after.length && removed.length === 1 && added.length === 1;
  if (before.length === after.length && removed.length && !rename) throw conflict();
  const next: (Record<string, unknown> & { keys: Record<string, unknown>[] })[] = groups.map(
    (group) => ({
      ...cleanMetadata(group),
      keys: (group.keys as Record<string, unknown>[]).map(cleanMetadata),
    })
  );
  const retained = new Map<number, Set<number>>();
  const retainedGroups = new Set<number>();
  const names = new Set(groups.map((group) => group.name));
  const append = (record: Record<string, unknown>) => {
    if (openai) {
      const group = cleanMetadata(record);
      group.keys = Array.isArray(group['api-key-entries'])
        ? group['api-key-entries'].map((key) => (isRecord(key) ? cleanMetadata(key) : key))
        : [];
      delete group['api-key-entries'];
      next.push(group as (typeof next)[number]);
      return;
    }
    let number = next.length + 1;
    while (names.has(`${family}-${number}`)) number++;
    const name = `${family}-${number}`;
    names.add(name);
    const key = cleanMetadata(record);
    delete key['base-url'];
    next.push({
      name,
      ...(record['base-url'] ? { 'base-url': record['base-url'] } : {}),
      keys: [key],
    });
  };
  after.forEach((row, afterIndex) => {
    let beforeIndex = beforeIds.indexOf(afterIds[afterIndex]);
    if (beforeIndex < 0 && rename) beforeIndex = removed[0];
    if (beforeIndex < 0) {
      append(row);
      return;
    }
    const source = sources.get(beforeIds[beforeIndex]);
    if (!source) throw conflict();
    const group = next[source.group];
    if (openai) {
      const original: Record<string, unknown> = {
        ...groups[source.group],
        'api-key-entries': groups[source.group].keys,
      };
      delete original.keys;
      const updated = cleanMetadata(applyChanges(original, before[beforeIndex], row));
      if (!equal(before[beforeIndex]['base-url'], row['base-url'])) {
        if (row['base-url'] === undefined) delete updated['base-url'];
        else updated['base-url'] = row['base-url'];
      }
      updated.keys = Array.isArray(updated['api-key-entries'])
        ? updated['api-key-entries'].map((key) => (isRecord(key) ? cleanMetadata(key) : key))
        : [];
      delete updated['api-key-entries'];
      next[source.group] = updated as (typeof next)[number];
      retainedGroups.add(source.group);
      return;
    }
    const keyIndex = source.key;
    if (keyIndex === undefined) throw conflict();
    const previous = cleanMetadata(before[beforeIndex]);
    const desired = cleanMetadata(row);
    delete previous['base-url'];
    delete desired['base-url'];
    const key = cleanMetadata(
      applyChanges(group.keys[keyIndex], previous, desired, groups[source.group])
    );
    if (!equal(before[beforeIndex]['base-url'], row['base-url'])) {
      if (group.keys.length > 1) {
        throw new Error('Edit a shared provider group base URL in the YAML configuration editor.');
      }
      if (row['base-url'] === undefined) delete group['base-url'];
      else group['base-url'] = row['base-url'];
    }
    group.keys[keyIndex] = key;
    const indexes = retained.get(source.group) ?? new Set<number>();
    indexes.add(keyIndex);
    retained.set(source.group, indexes);
  });
  return next.flatMap((group, index) => {
    if (index >= groups.length) return [group];
    if (openai) return retainedGroups.has(index) ? [group] : [];
    return [
      { ...group, keys: group.keys.filter((_, keyIndex) => retained.get(index)?.has(keyIndex)) },
    ];
  });
}

export async function mutateProviderConfig(
  section: string,
  mutate: (items: unknown[]) => unknown[],
  legacyMutation?: () => Promise<unknown>,
  validateSnapshot?: (items: unknown[]) => void
): Promise<void> {
  const generation = apiClient.getConnectionGeneration();
  const guard = () => {
    if (!apiClient.isCurrentConnection(generation)) throw conflict();
  };
  const response = await apiClient.getRaw('/config.yaml', { responseType: 'text' });
  guard();
  if (typeof response.data !== 'string') throw new Error('Invalid configuration response');
  parseConfigDocument(response.data);
  const v8 = usesV8ConfigLayout(response.data);
  const revision = configRevision(response, v8);
  if (!v8 && legacyMutation && !validateSnapshot) {
    await legacyMutation();
    guard();
    return;
  }
  const raw = await apiClient.get('/config');
  guard();
  if (!isRecord(raw) || (raw[section] !== undefined && !Array.isArray(raw[section])))
    throw conflict();
  const before = (raw[section] ?? []) as unknown[];
  validateSnapshot?.(before);
  if (!v8 && legacyMutation) {
    await legacyMutation();
    guard();
    return;
  }
  const after = mutate(before);
  if (!v8) {
    const path = section === 'interactions-api-key' ? '/interactions-api-key' : `/${section}`;
    await apiClient.put(path, after);
    guard();
    return;
  }
  const family = families[section];
  if (!family || !before.every(isRecord) || !after.every(isRecord)) throw conflict();
  const path = `/config/api-keys/${family}`;
  const options = { managementApiVersion: 'v8' as const };
  const readGroups = async (): Promise<Record<string, unknown>[]> => {
    let value: unknown;
    try {
      value = await apiClient.get(path, options);
    } catch (error) {
      guard();
      if (!isRecord(error) || error.status !== 404 || before.length) throw error;
      value = [];
    }
    guard();
    if (!Array.isArray(value) || !value.every(isRecord)) throw conflict();
    return value;
  };
  const groups = await readGroups();
  const next = reconcileProviderGroups(family, groups, before, after);
  const current = await apiClient.get('/config');
  guard();
  if (!isRecord(current) || !equal(current[section] ?? [], before)) throw conflict();
  const currentGroups = await readGroups();
  if (!equal(currentGroups, groups)) throw conflict();
  await apiClient.put(path, next, { ...options, headers: { 'If-Match': revision } });
  guard();
}
