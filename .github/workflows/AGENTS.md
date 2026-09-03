# .github/workflows navigation card

GitHub Actions for LTS contract CI and Panel release publication.
Read before changing `release.yml`, `lts-panel-contract.yml`, triggers, permissions, Node/npm setup, tests, or asset preparation.
Key dependencies: `package.json`, `package-lock.json`, `scripts/check-lts-panel-contract.sh`.

## Why this is high-risk

- Core expects the released asset to be named exactly `management.html`.
- `release.yml` builds and renames `dist/index.html`, then publishes on `v*-lts-*` tags or explicit dispatch.
- `lts-panel-contract.yml` is the remote gate for Node tests, contracts, type-check, build, and lint.
- `contents: write` is only for release creation.

## Required before changes

- Read both workflow files and current `package.json` scripts; do not preserve stale command assumptions.
- For release changes, verify Node 20, `npm ci`, `VERSION`, tag validation, and the `index.html` → `management.html` flow.
- For CI changes, compare its gate with `npm run validate:lts`; report intentional differences.
- If asset name, repository, or release semantics would change, stop and inspect current `CPA-Core-LTS` updater contract before editing.

## Do not

- Do not rename or omit `management.html`.
- Do not weaken `v*-lts-*` validation or add broad tag publishing without explicit release scope.
- Do not replace `npm ci` with a mode that ignores `package-lock.json`.
- Do not remove protected tests or `npm run check:lts` merely to make CI green.
- Do not echo secrets, tokens, GitHub context, or sensitive payloads.
- Do not dispatch or publish as validation without explicit authorization.

## Validation

- `npm run validate:lts` — local parity gate for broad CI changes.
- `npm run build` — confirm `dist/index.html` is generated for release changes.
- Inspect the workflow diff to confirm it still publishes `dist/management.html`.
- No local workflow linter is configured. Live GitHub Actions/release verification requires GitHub network/auth and is a separate claim.
