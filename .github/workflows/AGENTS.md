# .github/workflows navigation card

GitHub Actions release workflows for the LTS panel. Read this card before modifying `.github/workflows/release.yml`, release tag triggers, GitHub permissions, or release asset preparation.

Key file: `.github/workflows/release.yml`.

## Why this is high-risk

- `CPA-Core-LTS` expects the Panel latest release to expose an asset named exactly `management.html`.
- The workflow builds `dist/index.html`, renames it to `dist/management.html`, and publishes it with `scripts/codex-quota-compass.user.js` through `softprops/action-gh-release`.
- The supported release tag pattern is `v*-tls-*`; widening or changing it can publish unintended assets.
- `contents: write` is required for release creation. Avoid adding broader permissions without a concrete reason.

## Required before changes

- Confirm the workflow still runs `npm ci` and `npm run build`.
- Confirm `VERSION` still comes from `workflow_dispatch.release_tag` or `github.ref_name`.
- Confirm the workflow still rejects release tags that do not match `v*-tls-*`.
- Confirm release files still include `dist/management.html` and the intended userscript asset.
- If changing the asset name, repository, tag scheme, or release semantics, check the corresponding `CPA-Core-LTS` updater contract first.

## Do not

- Do not rename `management.html`.
- Do not drop `scripts/codex-quota-compass.user.js` from release files without an explicit release-scope decision.
- Do not replace `npm ci` with an install mode that ignores `package-lock.json`.
- Do not remove the `v*-tls-*` guard without an explicit user request.
- Do not add secret printing, token echoing, or debug dumps of the GitHub context.
- Do not add `git push --tags` or any broad tag-publishing behavior.

## Validation

No repository-local workflow linter is configured. For workflow changes, run root build validation when build behavior is affected and report that live GitHub Actions validation still requires GitHub network/auth.
