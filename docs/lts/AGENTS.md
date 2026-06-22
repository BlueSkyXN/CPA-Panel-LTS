# docs/lts navigation card

LTS maintenance contracts, protected-delta registry, and selective-port runbook.
Read this card before editing `panel-feature-contracts.yaml`, `panel-protected-deltas.yaml`, or `sync-runbook.md`.
These files describe what future agents and CI must preserve, not general README prose.

## Local invariants

- `panel-feature-contracts.yaml` is the feature registry used by `scripts/check-panel-feature-contracts.mjs` and mirrored by `scripts/check-lts-panel-contract.sh`.
- `panel-protected-deltas.yaml` preserves the product identity: full usage statistics, CPA-Core-LTS Management API compatibility, `management.html`, npm/package-lock build, and downstream LTS customizations.
- `sync-runbook.md` must continue to describe protected selective-port, not blind full-sync with upstream.
- Contract entries should use real routes, files, endpoints, and marker strings from current source.
- Feature status words are meaningful: `protected`, `lts-maintained`, `coexist`, `shared`, and `experimental` are not interchangeable.

## Local rules

- When adding or removing markers, inspect current source first and keep `scripts/check-lts-panel-contract.sh` aligned.
- Keep upstream baseline/removal facts tied to concrete tags or commits.
- Mention external/live validation only when it was actually run; otherwise mark it as required or skipped.

## Do not

- Do not weaken `/usage`, usage import/export, complete usage aggregation, `usage-statistics-enabled`, plugin capability gates, or release asset markers to make a port easier.
- Do not add aspirational features to the contract before source exists.
- Do not include secrets, raw tokens, private account IDs, or live API payloads in docs.

## Validation

- `npm run check:lts`
- `npm run validate:lts` for broad registry, protected-surface, route, API, smoke marker, or release-contract changes.
