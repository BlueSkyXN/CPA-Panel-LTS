# src/features/providers navigation card

Provider workbench, descriptors/adapters/forms, discovery, connectivity, and mutation recovery.
Read before modifying `ProvidersWorkbenchPage`, descriptors, adapters, provider definitions, form hooks, model discovery, or connectivity behavior.
Related stable provider status code lives in `src/components/providers/`; API boundaries live in `src/services/api/`.

## Local invariants

- The workbench coexists with stable provider pages and full usage statistics; it does not replace either.
- Backend `sourceIndex`/stable identity drives mutations. Never use filtered/sorted UI row position as backend identity.
- Adapters preserve unknown/unmanaged provider fields during round-trip edits.
- Discovery/connectivity uses existing API clients and auth resolution; stale responses cannot overwrite newer state.
- Sponsor/provider descriptor integrity keeps IDs, categories, forms, logos, adapters, and API mutation paths aligned.

## Local rules

- New provider support updates descriptor, adapter/form, types, API integration, locale keys, and integrity tests as applicable.
- Mutation recovery must make uncertain server state visible and reload/read back before claiming success.
- Do not duplicate recent-request aggregation already available in shared provider/usage utilities.
- Read `src/services/api/AGENTS.md` before changing discovery/connectivity contracts.

## Do not

- Do not send provider API keys to arbitrary browser origins; outbound testing must follow the current Core `/api-call` contract.
- Do not persist provider secrets in workbench UI state or expose them in errors/logs/tests.
- Do not drop unmanaged YAML/provider fields on edit.
- Do not infer mutation success solely from an optimistic UI state.

## Validation

- `npm run test:providers`
- `npm run type-check`
- `npm run build`
- `npm run lint` for shared adapters/hooks/components.
- Browser-check changed CRUD, discovery, connectivity, recovery, error, and responsive flows.
