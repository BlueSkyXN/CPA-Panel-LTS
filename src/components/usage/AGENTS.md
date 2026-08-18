# src/components/usage navigation card

Complete usage statistics UI and pricing/detail components for the LTS product boundary.
Read before changing charts, events, tokens, prices, import/export, or usage-backed provider status.
Linked chain: `UsagePage.tsx`, `services/api/usage.ts`, `useUsageStatsStore.ts`, `types/usage.ts`, `utils/usage.ts`, `utils/usageIndex.ts`, `utils/usage/`, `MainRoutes.tsx`.

## Local invariants

- `/usage` is a protected first-class route, not legacy UI.
- Preserve request events, model/API/credential breakdowns, token categories, cached/reasoning tokens, service tier/effort semantics, charts, import/export, and local pricing.
- Recent requests or API-key summaries may coexist but cannot replace complete usage.
- Provider status bars consume usage aggregation/indexes; aggregation changes require consumer review.
- Import/export and persisted pricing changes require backward-compatible parsing or an explicit migration/fallback.
- API fields must match current Core Management API or live readback.

## Local rules

- Keep aggregation and pricing logic in shared utilities/hooks rather than duplicating card calculations.
- Preserve loading, empty, error, unsupported, import-success, and import-failure states.
- Chart and table/detail totals must agree at the same filter/grain.
- Protected marker changes require `docs/lts/AGENTS.md` and `scripts/AGENTS.md`.

## Do not

- Do not delete the linked route/store/API/types/utils chain.
- Do not silently drop a dimension because one sample response omitted it.
- Do not round away cents or token categories before aggregation requires it.
- Do not break saved usage imports or pricing settings without compatibility handling.

## Validation

- `npm run test:usage`
- `npm run check:lts`
- `npm run type-check`
- `npm run build`
- Run `npm run lint` for shared utility/hook changes. Inspect charts, tables, filters, and responsive layout in a browser for visual changes; report if skipped.
