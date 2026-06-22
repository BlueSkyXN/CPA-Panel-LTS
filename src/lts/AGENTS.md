# src/lts navigation card

LTS-owned sidecar and overlay modules for downstream-only panel behavior.
Read this before modifying `codexQuota/`, `codexRemoteCloudConnect/`, or `i18n/*.lts.json`.
Key integration files: `QuotaPage.tsx`, `AuthFilesPage.tsx`, `AuthFileCard.tsx`, `quotaConfigs.ts`, `src/i18n/index.ts`.

## Local invariants

- Keep downstream Codex-specific logic in `src/lts/` when it would otherwise create noisy conflicts with upstream/shared pages.
- Shared pages/components should stay thin integration surfaces into sidecar exports.
- `src/lts/i18n/*.lts.json` are runtime overlay catalogs; every active locale (`en`, `zh-CN`, `zh-TW`, `ru`) must receive matching keys.
- Codex reset-credit behavior must preserve `/rate-limit-reset-credits`, `/consume`, expiry, cents-preserving USD, and guarded dialog markers.
- Codex remote cloud connect calls must go through the Management API `/api-call` path and must not expose raw credentials or tokens.

## Local rules

- If a sidecar marker is added, update `docs/lts/panel-feature-contracts.yaml` and `scripts/check-lts-panel-contract.sh`.
- Keep helper parsing tolerant of snake_case and camelCase when the upstream service returns both shapes.
- For display changes, verify mobile/desktop layout or report why browser inspection was not run.

## Do not

- Do not move LTS-only Codex behavior into generic quota/auth-file modules unless the change deliberately makes it shared product behavior.
- Do not hardcode ChatGPT account IDs, OAuth tokens, access tokens, management keys, or raw auth JSON.
- Do not remove guarded strings such as `formatCodexUsdAmount`, `CodexResetCreditsDetailsButton`, or remote cloud connect i18n keys without updating the guard.

## Validation

- `npm run check:lts`
- `npm run type-check`
- `npm run build`
- `npm run smoke:lts` for Codex quota, reset-credit, remote cloud connect modal, or LTS locale overlay changes.
