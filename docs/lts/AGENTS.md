# docs/lts navigation card

Canonical LTS feature registry, protected-delta inventory, and selective-port runbook.
Read before editing `panel-feature-contracts.yaml`, `panel-protected-deltas.yaml`, or `sync-runbook.md`.
For executable marker changes also read `scripts/AGENTS.md` and the current source being protected.

## Local invariants

- `panel-feature-contracts.yaml` contains machine-checked paths, routes, APIs, locales, and markers used by `check-panel-feature-contracts.mjs`.
- `panel-protected-deltas.yaml` records full usage, Core compatibility, single-file build, `management.html`, and LTS surfaces.
- `sync-runbook.md` describes protected selective-port, never blind Panel full-sync.
- Status values `protected`, `lts-maintained`, `shared`, `coexist`, and `experimental` carry distinct maintenance meaning.
- Baseline/removal claims require concrete tags or commits.

## Required before changes

1. Inspect the current source path/route/API/marker named by the contract.
2. Determine whether the surface is protected, LTS-owned, shared, coexist, or experimental.
3. Keep registry and executable guard aligned when adding/removing a protected marker.
4. Run the checks below; stop if a proposed port weakens full usage or the release asset contract without an explicit product-direction decision.

## Do not

- Do not weaken `/usage`, import/export, complete aggregation, plugin capability gates, Core-owned visual config, or release markers to accommodate an upstream port.
- Do not register aspirational paths or features before source exists.
- Do not include credentials, raw live payloads, private account identifiers, or deployment secrets.

## Validation

- `npm run check:lts` — required for registry/marker edits.
- `npm run validate:lts` — required for broad protected-surface, route, API, locale, smoke-marker, or release-contract edits.
- Core behavior needs separate current Core source/live verification.
