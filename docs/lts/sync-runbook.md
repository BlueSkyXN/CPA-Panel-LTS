# CPA-Panel-LTS upstream handling runbook

## Summary

`CPA-Panel-LTS` should not use the same full-sync strategy as `CPA-Core-LTS`.

Core can use protected full-sync because its protected usage delta is small and can be replayed at a few integration points. Panel is different: the upstream management UI moved away from complete usage statistics and directly deleted the LTS-protected usage page, store, API client, and utilities. A blind merge would remove the main reason this repository exists.

The maintenance model for Panel is therefore:

```text
main = CPA-Panel-LTS product line
     + full usage statistics UI
     + CPA-Core-LTS Management API compatibility
     + selected compatible upstream UI/fix improvements
     + downstream CPA-Core-LTS visual config surfaces
     + local downstream panel customizations
```

## Audited upstream intake snapshot (2026-07-15)

Refs captured after Panel PR #25 and before this audit change:

- `origin/main`: `165c95e8f85887fa36063b3365e68b3394a1ed5f`
- `upstream/main`: `d3df9b074ecc8c1161d998d65e09948bcbcaa6ef` (`v1.18.3`)
- `upstream/dev`: `5d24c6f971e05cc9b5c97ed76ae786efe099de98`
- `upstream/kimi-provider`: `f860bc81bcc507826bbced5434cf037bf77f8244`
- merge-base: `8ed837c3d734c3970a6d6799c557bb6a6753360d`
- `origin/main..upstream/main`: 242 commits
- `upstream/main..origin/main`: 144 commits
- `origin/main..upstream/dev`: 243 commits
- `origin/main..upstream/kimi-provider`: 252 commits

The raw commit counts are not the selective-port backlog. Panel PR #10, PR #16, and PR #20 already adapted substantial upstream work without making those upstream commits ancestors of `main`, while PR #23 recorded the `v1.18.3` result as already equivalent. `upstream/dev` and `upstream/kimi-provider` are review inputs, not accepted release boundaries.

The upstream diff deletes or replaces protected LTS usage files, including:

- `src/components/usage/`
- `src/pages/UsagePage.tsx`
- `src/pages/UsagePage.module.scss`
- `src/services/api/usage.ts`
- `src/stores/useUsageStatsStore.ts`
- `src/types/usage.ts`
- `src/utils/usage.ts`
- `src/utils/usageIndex.ts`

This confirms that upstream full-sync is unsafe for Panel.

Recent upstream intake:

| Upstream release / commit | Classification | Panel evidence | Decision |
|---|---|---|---|
| `v1.18.0` / `4af4cf4` | `reject` | PR #16 records the controlled npm security subset | Reject Bun CI, `bun.lock`, and package-manager migration. |
| `v1.18.1` / `07562b7` | `adapt-port` | PR #16 / `v1-tls-0.0.8` | Preserve LTS auth/quota/provider boundaries while adapting official xAI API routing. |
| `v1.18.2` / `7958915` | `adapt-port` | PR #20 | Add `disable-image-generation: passthrough` through the existing visual-config and browser-smoke architecture; do not copy upstream Bun tests or missing search-index architecture. |
| `v1.18.3` / `d3df9b0` | `already-equivalent` | `src/lts/codexQuota/` uses `pickCodexClassifiedWindows` | The LTS sidecar already classifies and selects additional quota windows before building display rows; no product-code port is needed. |
| `upstream/dev` / `5d24c6f` | `adapt-port` | Paired `CPA-Core-LTS main` `f7d321b` includes Core xAI contract commit `423f3d5` and exposes `GET`/`PUT`/`PATCH`/`DELETE /v0/management/xai-api-key`; Panel uses the workbench's xAI category and `test:provider-xai` regression | Manually adapt the xAI API-key workbench surface, preserving unknown fields and selecting mutations by `api-key` plus `base-url`; retain npm/package-lock and do not copy the upstream Bun test. |
| `upstream/kimi-provider` functional base / `b2c8490` | `defer` | Current Panel already supports Kimi OAuth, auth files, and quota; the branch has not reached upstream `dev` or `main`, and its name-based detection can silently rewrite a custom `Kimi` gateway to the official Moonshot endpoint on save | Revisit only a config-detected Kimi OpenAI/Claude compatibility grouping after the branch stabilizes and custom base URLs round-trip unchanged. Preserve the LTS rule that branded groups appear from real config and do not become promotional quick-start surfaces. |
| `upstream/kimi-provider` icon/theme hunks / `7fb5890`, `f860bc8` | `defer` | The commits mix reusable icon/theme work with OAuth reordering and affiliate-link behavior | Reassess stable asset-only hunks after upstream integration; do not cherry-pick the mixed commits as-is. |
| `upstream/kimi-provider` promotion series / `e2aa494`, `6a8319d`, `339529f`, `bb48387`, `72c13c0`, `36681ce` plus affiliate hunks in `f860bc8` | `reject` | `provider-workbench` contract requires commercial-neutral, config-detected groups without registration links | Do not add recommended-provider placement, quick sign-up controls, or `?aff=cliproxyapi` registration links. |

## Maintenance rules

Use protected selective-port:

1. Fetch upstream and inspect first.
2. Classify upstream commits as direct-port, adapt-port, already-equivalent, reject, or defer.
3. Cherry-pick or manually port compatible changes into a Panel LTS branch.
4. Preserve complete usage UI and CPA-Core-LTS API compatibility.
5. When Panel explicitly manages or displays a Core-owned config key, update the visual config types, YAML mapper, editor UI, active locale catalogs, feature contract, contract guard, and relevant smoke together.
6. Core-owned keys that Panel does not manage must still survive source and visual saves through the complete YAML `Document` preservation path; do not add a UI merely to claim schema coverage.
7. Run `npm run validate:lts` before PR, or run the equivalent contract, type-check, lint, and build commands separately when diagnosing failures.
8. Merge Panel maintenance PRs normally. Do not use GitHub Sync fork.

Do not:

- Use GitHub Sync fork.
- Run a blind `git merge upstream/main`.
- Run file-level checkout from upstream over `src/`.
- Delete or weaken `/usage`, `src/components/usage/`, `usageApi`, `useUsageStatsStore`, or usage utilities.
- Introduce `bun.lock`, `yarn.lock`, or `pnpm-lock.yaml`; this repository uses npm and `package-lock.json`.
- Rename the release asset away from `management.html`.

## Classification guide

Every non-deferred decision must record the upstream SHA, classification, Panel commit or PR, reason, and validation scope. Use these result classes consistently:

Direct-port candidates:

- Localized form validation, browser autofill, accessibility, or copy fixes that do not touch a protected/shared seam.
- UI bug fixes whose patch applies without changing LTS routes, data contracts, build tooling, or downstream integrations.
- Patch/minor dependency updates that retain npm/`package-lock.json` and require no LTS-specific code adaptation.

Adapt-port candidates:

- Provider UX improvements that must preserve the stable provider page and complete usage details.
- Provider workbench refactors.
- Status bar or provider stats changes.
- Auth-file display or stats changes that overlap LTS-specific Codex environment behavior.
- Config schema changes that overlap `usage-statistics-enabled`.
- Visual config changes around downstream Core LTS surfaces such as `codex.abnormal-reasoning-retry`.
- Quota page changes that share parsing, account identity, or provider metadata.
- Release workflow hardening that must retain `management.html`, npm, and `v*-tls-*` semantics.
- Tooling changes that need LTS-specific command, lockfile, CI, or smoke adaptation.

Already-equivalent:

- The current Panel behavior or a prior LTS PR already implements the upstream outcome.
- Record the upstream SHA and the existing Panel commit/PR; do not create a duplicate code change merely to mirror ancestry.

Reject by default:

- Replacing complete usage statistics with recent requests only.
- Replacing complete usage statistics with API-key usage summaries only.
- Removing usage charts, import/export, request events, token breakdown, or local model prices.
- Removing CPA-Core-LTS release/download assumptions.

Defer:

- Large UI rewrites where the protected usage chain cannot be preserved quickly.
- Package manager migration away from npm.
- Release semantics changes that need Core-side confirmation.

## Suggested workflow

```bash
cd /Users/sky/Github/CPA-Panel-LTS
git fetch origin --prune --tags
git fetch upstream --prune --tags

git status --short --branch
git log --oneline --first-parent origin/main..upstream/main
git diff --name-status origin/main..upstream/main -- src
```

Create a branch:

```bash
git switch -c codex/panel-upstream-port-YYYYMMDD origin/main
```

For each candidate:

```bash
git show --stat --name-status <upstream-sha>
git show -- <paths>
```

Then either cherry-pick, manually port, or reject. Prefer small PRs grouped by feature area, not by file-level overwrite.

After changes:

```bash
npm run validate:lts
npm run smoke:lts  # optional local browser smoke; requires Python Playwright
npm run smoke:lts:core -- --no-write-smoke  # optional real Core smoke; requires local CPA-Core-LTS, Go, Python Playwright, and Chromium
```

## PR body checklist

Each Panel upstream-port PR should state:

- upstream commit(s) considered
- classification for every considered commit: direct-port, adapt-port, already-equivalent, reject, or defer
- Panel commit/PR evidence for ported or already-equivalent items
- commits rejected or deferred, with reason
- usage UI contract impact
- CPA-Core-LTS Management API compatibility impact
- visual config / downstream Core config surface impact
- release asset impact
- validation commands and results
- whether optional `npm run smoke:lts` or a real CPA-Core-LTS authenticated smoke was run

## Release note

Publishing a Panel release is separate from porting code. A release is externally visible and affects what `CPA-Core-LTS` can download as `management.html`, so it should be done only when explicitly requested.

When releasing:

1. Run `npm run check:lts`.
2. Run `npm run type-check`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Push only the exact intended tag, for example `v1-tls-0.0.3`.
6. Verify the GitHub release contains `management.html`.
