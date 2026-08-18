# src/features/authFiles navigation card

Auth-file CRUD UI, OAuth excluded/model-alias editors, prefix proxy editing, quota/status cards, and shared caches.
Read before changing credential upload/delete, OAuth rules, model lists, quota/status fetches, UI persistence, or invalidation.
Key files: `useAuthFilesData.ts`, `useAuthFilesOauth.tsx`, `useAuthFilesModels.ts`, `cacheInvalidation.ts`, `oauthEditorState.ts`, `uiState.ts`, card/modal components.

## Local invariants

- Runtime auth data stays in API/state paths; persisted UI state contains presentation preferences only.
- OAuth config load guards distinguish unsupported/missing endpoints from valid empty rules and transient errors.
- Mutation success invalidates every affected auth-file, model, quota, stats, and status-bar cache.
- OAuth excluded and model-alias saves preserve unrelated rules and provider entries.
- Codex quota/remote-cloud behavior remains owned by `src/lts/`; read its card when integration changes.

## Local rules

- File identity/provider grouping must use stable backend fields, not presentation order.
- Destructive upload/delete/overwrite keeps confirmation and actionable errors.
- Stored auth-file UI state must remain secret-free and backward tolerant.
- API/schema changes require `src/services/api/AGENTS.md` and current Core contract review.

## Do not

- Do not persist raw auth files, tokens, management keys, quota payloads, or credentials in local/session storage.
- Do not show raw credential material in notifications, logs, screenshots, or test fixtures.
- Do not treat an empty response caused by a failed load as user-confirmed empty configuration.
- Do not update only one cache consumer after a mutation.

## Validation

- `npm run test:auth-files`
- `npm run type-check`
- `npm run build`
- Run `npm run check:lts` and `npm run smoke:lts` when Codex sidecars, quota cards, plugin capability, or protected auth-file markers are affected.
