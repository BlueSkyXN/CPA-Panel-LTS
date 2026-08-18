# src/lts navigation card

LTS-owned sidecars and runtime locale overlays for downstream-only Codex behavior.
Read before modifying `codexQuota/`, `codexRemoteCloudConnect/`, or `i18n/*.lts.json`.
Integration points include quota/auth-file pages, `quotaConfigs.ts`, `AuthFileCard.tsx`, and `src/i18n/index.ts`.

## Local invariants

- Keep downstream Codex logic here when moving it into shared/upstream-shaped pages would increase selective-port conflicts.
- Shared pages expose thin typed integration surfaces; LTS sidecars own parsing, state, dialog, and request-specific behavior.
- All active overlay locales (`en`, `zh-CN`, `zh-TW`, `ru`) carry matching key structure.
- Reset-credit behavior preserves `/rate-limit-reset-credits`, `/consume`, expiry data, cents-preserving USD formatting, and guarded dialog paths.
- Remote cloud connect uses the Management API `/api-call` path and never exposes raw auth material.

## Local rules

- Add/remove sidecar markers in feature contracts and the executable guard together.
- Accept verified snake_case/camelCase response variants only where the service/Core contract actually permits both.
- UI changes retain loading/error/unsupported states and responsive behavior.

## Do not

- Do not move LTS-only behavior into generic quota/auth-file modules unless intentionally making it shared product behavior.
- Do not hardcode or log ChatGPT account IDs, OAuth/access tokens, management keys, raw auth JSON, or sensitive raw responses.
- Do not remove guarded exports/strings without updating the contract and all integration callers.

## Validation

- `npm run check:lts`
- `npm run type-check`
- `npm run build`
- `npm run smoke:lts` for quota/reset-credit/remote-cloud UI or overlay changes.
- Also run `npm run test:auth-files` or `npm run test:quota` when the changed sidecar affects those data paths.
