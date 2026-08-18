# src/components/config navigation card

Source YAML/visual editors, diff review, and API-key persistence behavior.
Read before changing `/config.yaml` edit/save/reload, visual config blocks/schema, diff modal, or credential inputs.
Related contracts: `src/hooks/useVisualConfig.ts`, `src/types/visualConfig.ts`, `src/services/api/config*.ts`, locale catalogs, LTS feature contracts.

## Local invariants

- Visual saves preserve unmanaged YAML and fields not represented by the active editor.
- Editors expose parse/load/save failures; failed/partial loads are not valid empty config.
- Diff/review happens before destructive full-config replacement where the current flow provides it.
- Secret inputs do not leak full values into logs, notifications, persisted drafts, DOM snapshots, or committed tests.
- Core-owned LTS config surfaces, including `codex.abnormal-reasoning-retry`, keep type, hook, editor blocks, locales, smoke markers, registry, and guard aligned.

## Local rules

- Confirm config keys and serialization against current Core parser/types before adding visual fields.
- Preserve unknown keys and key spelling; round-trip tests/smoke should verify unrelated YAML survives.
- User-visible labels/help/errors require all active locale catalogs.
- API/storage changes also require the corresponding local navigation card.

## Do not

- Do not invent config keys by analogy or silently coerce unsupported values.
- Do not replace the whole YAML from an incomplete visual model.
- Do not store or echo complete API keys in localStorage, console output, fixtures, or screenshots.
- Do not update only the UI while leaving Core/LTS contracts or smoke markers stale.

## Validation

- `npm run test:config`
- `npm run type-check`
- `npm run build`
- LTS/Core-owned visual schema: `npm run check:lts` and `npm run smoke:lts`; use `smoke:lts:core` only with the required local Core/credentials.
