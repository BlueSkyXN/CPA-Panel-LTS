/**
 * API 密钥管理（v8 `access.api-keys`）
 */

import { getConfigValue, guardConfigConnection, putConfigValue, readConfigSnapshot } from './configValue';

const PATH = '/config/access/api-keys';

const normalizeKeys = (data: unknown): string[] =>
  Array.isArray(data) ? data.filter((key): key is string => typeof key === 'string') : [];

/** List edits are derived from one read and written with that read's revision. */
async function updateKeys(mutate: (keys: string[]) => string[]) {
  const assertConnection = guardConfigConnection();
  const { value, revision } = await readConfigSnapshot<unknown>(PATH, []);
  assertConnection();
  return putConfigValue(PATH, mutate(normalizeKeys(value)), revision);
}

export const apiKeysApi = {
  async list(): Promise<string[]> {
    return normalizeKeys(await getConfigValue<unknown>(PATH, []));
  },

  replace: (keys: string[]) => updateKeys(() => keys),

  update: (index: number, value: string) =>
    updateKeys((keys) => {
      if (index < 0 || index >= keys.length) throw new Error('API key changed; refresh and try again.');
      return keys.map((key, i) => (i === index ? value : key));
    }),

  delete: (index: number) =>
    updateKeys((keys) => {
      if (index < 0 || index >= keys.length) throw new Error('API key changed; refresh and try again.');
      return keys.filter((_, i) => i !== index);
    }),
};
