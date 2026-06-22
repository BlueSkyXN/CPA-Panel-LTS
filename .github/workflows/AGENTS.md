# .github/workflows navigation card

GitHub Actions workflows for release and LTS contract CI.
Read this before modifying `release.yml`, `lts-panel-contract.yml`, tag triggers, permissions, Node setup, npm install mode, or release asset preparation.
Key files: `release.yml`, `lts-panel-contract.yml`, `scripts/check-lts-panel-contract.sh`.

## Why this is high-risk

- `CPA-Core-LTS` expects the latest Panel release to expose an asset named exactly `management.html`.
- `release.yml` builds `dist/index.html`, renames it to `dist/management.html`, and publishes it.
- `lts-panel-contract.yml` runs contract, type-check, build, and lint gates.
- The supported release tag pattern is `v*-tls-*`; widening it can publish unintended assets.
- `contents: write` is required for release creation. Avoid broader permissions without a concrete reason.

## Required before changes

- Confirm release CI still uses `npm ci`, `npm run build`, `VERSION`, the `v*-tls-*` guard, and `dist/management.html`.
- Confirm contract CI still runs `npm run check:lts` with type-check/build/lint.
- If changing asset name, repository, tag scheme, or release semantics, inspect `CPA-Core-LTS` updater compatibility.

## Do not

- Do not rename `management.html`.
- Do not replace `npm ci` with an install mode that ignores `package-lock.json`.
- Do not remove the `v*-tls-*` guard without an explicit user request.
- Do not remove `npm run check:lts` from PR/main CI.
- Do not add secret printing, token echoing, or debug dumps of GitHub context.
- Do not add broad tag-publishing behavior such as `git push --tags`.
- Do not treat userscript publishing as part of the Panel mainline release unless the user explicitly scopes that work.

## Validation

No repository-local workflow linter is configured.
Run `npm run build` for release build changes and `npm run check:lts` for contract CI changes; use `npm run validate:lts` for broad CI changes.
Live GitHub Actions validation requires GitHub network/auth.
