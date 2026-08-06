const API_KEY_PREFIX = 'sk-';
const API_KEY_RANDOM_LENGTH = 48;
const API_KEY_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_UNBIASED_BYTE = Math.floor(256 / API_KEY_CHARSET.length) * API_KEY_CHARSET.length;

/**
 * 生成 51 字符的随机 API key：`sk-` 加 48 个均匀分布的 base62 字符。
 */
export function generateSecureApiKey(): string {
  const characters: string[] = [];

  while (characters.length < API_KEY_RANDOM_LENGTH) {
    const remaining = API_KEY_RANDOM_LENGTH - characters.length;
    const randomBytes = new Uint8Array(Math.ceil(remaining * 1.1));
    globalThis.crypto.getRandomValues(randomBytes);

    for (const byte of randomBytes) {
      if (byte >= MAX_UNBIASED_BYTE) continue;

      characters.push(API_KEY_CHARSET[byte % API_KEY_CHARSET.length]);
      if (characters.length === API_KEY_RANDOM_LENGTH) break;
    }
  }

  return `${API_KEY_PREFIX}${characters.join('')}`;
}
