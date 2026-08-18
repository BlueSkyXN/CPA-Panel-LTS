# src/features/plugins navigation card

Plugin management, store, install gating, polling, and resource pages for Core runtimes that expose plugin support.
Read before changing plugin pages, `pluginResources.ts`, `pluginPolling.ts`, `pluginConfigDraft.ts`, or `PluginInstallGateModal.tsx`.
Integration points: `MainRoutes.tsx`, `MainLayout.tsx`, `useAuthStore.ts`, `services/api/plugins.ts`, `useVisualConfig.ts`.

## Local invariants

- Plugin UI is capability-gated by `x-cpa-support-plugin`, `pluginSupportKnown`, `supportsPlugin`, and `RequirePluginSupport`.
- Unknown/unsupported runtime support keeps routes and actions locked; enabling config alone does not prove binary capability.
- Store-source edits preserve unmanaged YAML and unrelated `plugin_store_sources` data.
- Install confirmation keeps `getPluginConfirmToken`, repository URL derivation, and explicit user acknowledgement.
- Polling is bounded, lifecycle-cleaned, and cannot continue updating an obsolete connection/view.

## Local rules

- Route/nav changes update `MainRoutes.tsx` and `MainLayout.tsx` together.
- API shapes come from current Core source or live endpoint.
- New protected plugin markers update feature contracts and guards together.

## Do not

- Do not bypass the runtime capability gate to expose `/plugins` or `/plugin-store`.
- Do not persist confirmation tokens, management keys, repository credentials, or raw plugin auth in browser storage.
- Do not drop store-source or unrelated visual config fields during save.
- Do not make install/polling loops unbounded or survive component/connection cleanup.

## Validation

- `npm run check:lts`
- `npm run type-check`
- `npm run build`
- `npm run smoke:lts` for routes, gate, resource pages, install modal, polling, or store-source behavior.
- `npm run smoke:lts:core -- --include-plugin-store` only with a compatible local Core and credentials; otherwise report it as skipped.
