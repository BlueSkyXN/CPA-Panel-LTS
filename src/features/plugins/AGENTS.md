# src/features/plugins navigation card

Plugin management, plugin store, and plugin resource pages for Core runtimes with plugin support.
Read this before modifying plugin pages, `pluginResources.ts`, `pluginPolling.ts`, or `components/PluginInstallGateModal.tsx`.
Key integration files: `MainRoutes.tsx`, `MainLayout.tsx`, `useAuthStore.ts`, `plugins.ts`, `constants.ts`, `useVisualConfig.ts`.

## Local invariants

- Plugin UI is not always-on. Routes and nav depend on `x-cpa-support-plugin`, `pluginSupportKnown`, `supportsPlugin`, and `RequirePluginSupport`.
- Unsupported or unknown plugin support should hide or redirect plugin routes.
- Plugin store source editing is visual config behavior; preserve unmanaged YAML and `plugin_store_sources`.
- Install gating must keep `getPluginConfirmToken`, repository URL building, and explicit user confirmation behavior.
- Plugin polling must avoid unbounded loops and should respect existing lifecycle cleanup.

## Local rules

- Add or change plugin routes in `MainRoutes.tsx` and `MainLayout.tsx` together.
- When changing API shapes, inspect current `CPA-Core-LTS` Management API code or a live endpoint.
- Keep `docs/lts/panel-feature-contracts.yaml` and `scripts/check-lts-panel-contract.sh` aligned with new plugin markers.

## Do not

- Do not bypass the backend support gate to make `/plugins` or `/plugin-store` visible on unsupported Core versions.
- Do not persist install confirmation tokens, management keys, or plugin credentials in browser storage.
- Do not drop plugin store source data while saving unrelated visual config fields.

## Validation

- `npm run check:lts`
- `npm run type-check`
- `npm run build`
- `npm run smoke:lts` for routes, resources, install modal, or config-store source behavior.
- `npm run smoke:lts:core -- --include-plugin-store` only when local Core, credentials, and plugin-store support are available; otherwise report skipped.
