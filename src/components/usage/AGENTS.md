# src/components/usage navigation card

Complete usage statistics UI for the LTS panel.
Read before modifying charts, events, import/export, prices, tokens, or usage-backed provider status.

Linked files: `UsagePage.tsx`, `usage.ts`, `useUsageStatsStore.ts`, `src/types/usage.ts`, `src/utils/usage.ts`, `src/utils/usageIndex.ts`, `MainRoutes.tsx`.

## Local invariants

- `/usage` is a first-class LTS route, not a legacy page to remove.
- Preserve events, model/API/credential breakdowns, token categories, cached/reasoning tokens, charts, import/export, and local prices.
- Do not replace this page with only recent requests, API-key counters, or a provider-level summary.
- Provider status bars rely on `src/utils/usage.ts` and `src/utils/usageIndex.ts`; update consumers when aggregation changes.
- API fields must match current `CPA-Core-LTS` Management API behavior. Do not invent response fields from UI assumptions.
- `docs/lts/panel-feature-contracts.yaml` and `scripts/check-lts-panel-contract.sh` are the registry/guard for protected markers.

## Local rules

- Keep expensive aggregation in reusable utilities/hooks rather than duplicating calculations across cards.
- Preserve loading, empty, error, unsupported, import-success, and import-failure states.
- When adding user-visible text, update `src/i18n/locales/` consistently.
- When changing chart datasets, verify both chart rendering and tabular/detail views still agree on totals.
- Keep import/export compatible with existing saved usage data, or add fallback/migration.

## Do not

- Do not delete `UsagePage.tsx`, `useUsageStatsStore`, `usage.ts`, or `usageIndex.ts`.
- Do not silently drop dimensions just because a sample response lacks that field.
- Do not break existing pricing settings or imported usage data without migration or fallback.

## Validation

- `npm run check:lts`
- `npm run type-check`
- `npm run build`
- Browser inspection is expected for layout/chart changes when feasible; report explicitly if it was not run.
