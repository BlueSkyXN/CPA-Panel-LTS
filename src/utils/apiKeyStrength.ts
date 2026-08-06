export type ApiKeyStrengthTier = 'weak' | 'fair' | 'good' | 'strong';

export interface ApiKeyStrength {
  tier: ApiKeyStrengthTier;
  segments: number;
  bits: number;
}

const TIER_ORDER: readonly ApiKeyStrengthTier[] = ['weak', 'fair', 'good', 'strong'];

export const API_KEY_STRENGTH_SEGMENTS = TIER_ORDER.length;

const CHARSET_CLASSES: readonly { pattern: RegExp; size: number }[] = [
  { pattern: /[a-z]/, size: 26 },
  { pattern: /[A-Z]/, size: 26 },
  { pattern: /[0-9]/, size: 10 },
  { pattern: /[^a-zA-Z0-9]/, size: 32 },
];

const GUESSABLE_TOKENS: readonly string[] = [
  'password',
  'passwd',
  '123456',
  'qwerty',
  'admin',
  'secret',
  'apikey',
  'api-key',
  'letmein',
  'changeme',
  'iloveyou',
  'default',
  'test',
  'demo',
];

const REPEAT_WEIGHT = 0.25;
const SEQUENCE_WEIGHT = 0.35;
const GUESSABLE_FACTOR = 0.4;

const BITS_FOR_FAIR = 40;
const BITS_FOR_GOOD = 64;
const BITS_FOR_STRONG = 96;

const LENGTH_CAPS: readonly { below: number; tier: ApiKeyStrengthTier }[] = [
  { below: 8, tier: 'weak' },
  { below: 16, tier: 'fair' },
  { below: 24, tier: 'good' },
];

const MIN_UNIQUE_FOR_FAIR = 5;

function effectiveLength(key: string): number {
  let total = 0;
  let sequenceRun = 1;

  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    const previous = index > 0 ? key.charCodeAt(index - 1) : Number.NaN;

    if (code === previous) {
      total += REPEAT_WEIGHT;
      sequenceRun = 1;
      continue;
    }

    const delta = code - previous;
    if (delta === 1 || delta === -1) {
      sequenceRun += 1;
      total += sequenceRun >= 3 ? SEQUENCE_WEIGHT : 1;
      continue;
    }

    sequenceRun = 1;
    total += 1;
  }

  return total;
}

/** 识别完整或尾部不完整的重复周期，例如 `abcabca` 的周期为 3。 */
function smallestPeriod(key: string): number {
  for (let period = 1; period <= Math.floor(key.length / 2); period += 1) {
    let matches = true;
    for (let index = period; index < key.length; index += 1) {
      if (key[index] !== key[index % period]) {
        matches = false;
        break;
      }
    }
    if (matches) return period;
  }
  return key.length;
}

function charsetSize(key: string): number {
  return CHARSET_CLASSES.reduce(
    (size, charClass) => (charClass.pattern.test(key) ? size + charClass.size : size),
    0
  );
}

function tierForBits(bits: number): ApiKeyStrengthTier {
  if (bits >= BITS_FOR_STRONG) return 'strong';
  if (bits >= BITS_FOR_GOOD) return 'good';
  if (bits >= BITS_FOR_FAIR) return 'fair';
  return 'weak';
}

function capTier(tier: ApiKeyStrengthTier, cap: ApiKeyStrengthTier): ApiKeyStrengthTier {
  return TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(cap) ? tier : cap;
}

/**
 * 评估用户自拟 API key 的参考强度。结果只用于提示，不参与保存校验。
 */
export function evaluateApiKeyStrength(rawKey: string): ApiKeyStrength {
  const key = rawKey.trim();
  if (!key) return { tier: 'weak', segments: 0, bits: 0 };

  const pool = charsetSize(key);
  const lowerCased = key.toLowerCase();
  const guessable = GUESSABLE_TOKENS.some((token) => lowerCased.includes(token));
  const period = smallestPeriod(key);
  const length = effectiveLength(key.slice(0, period)) + (key.length - period) * REPEAT_WEIGHT;
  const bits = Math.floor(length * Math.log2(pool) * (guessable ? GUESSABLE_FACTOR : 1));

  let tier = tierForBits(bits);
  for (const { below, tier: cap } of LENGTH_CAPS) {
    if (key.length < below) tier = capTier(tier, cap);
  }
  if (new Set(key).size < MIN_UNIQUE_FOR_FAIR) tier = capTier(tier, 'weak');

  return { tier, segments: TIER_ORDER.indexOf(tier) + 1, bits };
}
