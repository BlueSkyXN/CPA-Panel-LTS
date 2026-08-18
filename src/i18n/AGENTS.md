# src/i18n navigation card

i18next bootstrap and shared locale catalogs.
Read before changing language initialization, fallback behavior, locale keys, nesting, interpolation, or user-visible shared text.
Key files: `index.ts`, `locales/en.json`, `zh-CN.json`, `zh-TW.json`, `ru.json`; LTS-only overlays are governed by `src/lts/AGENTS.md`.

## Local invariants

- Active shared locales are exactly `en`, `zh-CN`, `zh-TW`, and `ru`; new shared keys keep the same object/placeholder structure in all four.
- `zh-CN` is the configured fallback; language persistence/detection stays compatible with `getInitialLanguage()`.
- LTS-only Codex quota/remote-cloud strings belong in matching `src/lts/i18n/*.lts.json`, not copied into shared catalogs.
- Placeholder names, interpolation variables, plural/count behavior, and embedded product/API names remain consistent across translations.

## Local rules

- Place keys under the existing feature namespace; search before creating near-duplicates.
- Preserve valid JSON, UTF-8 text, and locale-specific wording; do not transliterate Chinese or Russian content.
- When removing/renaming a key, search all source and LTS overlay references first.

## Do not

- Do not update only one locale and silently rely on fallback for committed user-facing functionality.
- Do not put secrets, internal URLs, raw payloads, or environment-specific instructions in locale text.
- Do not move LTS overlay keys into shared catalogs merely to satisfy a missing translation.

## Validation

- `npm run type-check`
- `npm run build`
- `npm run check:lts` when LTS overlays or protected locale markers change.
- Browser-check language switching, interpolation, truncation, and mobile layout for substantial copy or namespace changes.
