# src/components/usage navigation card

Complete usage statistics UI for the LTS panel. Read this card before modifying charts, summary cards, token breakdowns, request events, import/export controls, cost estimates, or local model price settings.

Linked files: `src/pages/UsagePage.tsx`, `src/pages/UsagePage.module.scss`, `src/services/api/usage.ts`, `src/stores/useUsageStatsStore.ts`, `src/types/usage.ts`, `src/utils/usage.ts`, `src/utils/usageIndex.ts`, `src/router/MainRoutes.tsx`.

## Local invariants

- `/usage` is a first-class LTS route, not a legacy page to remove.
- Preserve complete usage details: request events table, model/API/credential breakdowns, token categories, cached/reasoning token handling, charts, import/export, and local model price settings.
- Do not replace this page with only recent requests, API-key counters, or a provider-level summary.
- Provider status bars rely on complete usage details through `src/utils/usage.ts` and `src/utils/usageIndex.ts`; update provider consumers when changing aggregation shape.
- API fields must match current `CPA-Core-LTS` Management API behavior. Do not invent response fields from UI assumptions.

## Local rules

- Keep expensive aggregation in reusable utilities/hooks rather than duplicating calculations across cards.
- Preserve loading, empty, error, unsupported, import-success, and import-failure states.
- When adding user-visible text, update `src/i18n/locales/` consistently.
- When changing chart datasets, verify both chart rendering and tabular/detail views still agree on totals.

## Do not

- Do not delete `UsagePage.tsx`, `useUsageStatsStore`, `usage.ts`, or `usageIndex.ts`.
- Do not silently drop dimensions just because a sample response lacks that field.
- Do not break existing pricing settings or imported usage data without migration or fallback.

## Validation

- `npm run type-check`
- `npm run build`
- Browser inspection is expected for layout/chart changes when feasible; report explicitly if it was not run.
