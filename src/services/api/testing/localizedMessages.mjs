// Errors raised through i18n.t follow the ambient language (navigator/locale), which differs
// between local Node and CI. Tests match the message against every bundled translation instead.
import { readFileSync } from 'node:fs';

const LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'ru'];

const lookup = (bundle, key) => key.split('.').reduce((node, part) => node?.[part], bundle);

export function localizedMessages(key, defaultValue) {
  const messages = new Set(defaultValue === undefined ? [] : [defaultValue]);
  for (const lng of LANGUAGES) {
    const url = new URL(`../../../i18n/locales/${lng}.json`, import.meta.url);
    const message = lookup(JSON.parse(readFileSync(url, 'utf8')), key);
    if (typeof message !== 'string') throw new Error(`missing ${lng} translation for ${key}`);
    messages.add(message);
  }
  return (error) => messages.has(error?.message);
}
