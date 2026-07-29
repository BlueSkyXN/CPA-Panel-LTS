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

## Audited upstream intake snapshot (2026-07-24)

Refs captured after publishing Panel commit `f199ea5` and fetching all remotes with pruning:

- `origin/main`: `f199ea55dfc2281a05ea3e478fc2809b9dd687fe`
- `upstream/main`: `3738c0b7ff21ce7e1423795a26769fff05fd81d6` (`v1.18.6`)
- `upstream/dev`: `3738c0b7ff21ce7e1423795a26769fff05fd81d6`
- `upstream/kimi-provider`: `f860bc81bcc507826bbced5434cf037bf77f8244`
- merge-base: `8ed837c3d734c3970a6d6799c557bb6a6753360d`
- `origin/main..upstream/main`: 260 commits
- `upstream/main..origin/main`: 203 commits
- `origin/main..upstream/dev`: 260 commits
- `origin/main..upstream/kimi-provider`: 252 commits

The raw commit counts are not the selective-port backlog. Panel PR #10, PR #16, PR #20, and PR #27 already adapted substantial upstream work without making those upstream commits ancestors of `main`, while PR #23 recorded the `v1.18.3` result as already equivalent. `upstream/dev` currently matches `upstream/main`; `upstream/kimi-provider` remains a historical review ref rather than an accepted release boundary.

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
| xAI / `5d24c6f` | `adapt-port` | Panel PR #27 and `test:provider-xai` cover the current Core xAI contract while preserving unknown fields and selecting mutations by `api-key` plus `base-url` | Keep the existing LTS adaptation; do not copy the upstream Bun test or weaken npm/package-lock. |
| `v1.18.4` provider integrity / `5b62fa1`, `4e0af8c` | `adapt-port` | Panel commits `2519786` and `4b3e309` preserve backend OpenAI source indices across the Workbench and stable Provider page, keep custom branded endpoints in the generic group, stop FennoAI from claiming unsupported OpenAI configs, and delete sponsor OpenAI entries by descending index | Accepted as a manual LTS adaptation; retain unknown-field preservation and config-detected branded groups. |
| `v1.18.4` recent-request isolation / `291f15c` | `direct-port` | Panel commit `2519786` scopes the recent-request cache by `apiBase` plus `managementKey` and adds a late-response regression test | Accepted; this hardens the coexist recent-health view without touching full usage statistics. |
| `v1.18.4` auth safety / `e3fa19b`, `abcd70f` | `adapt-port` | Panel commit `ef24b2c` guards inline quota commits with the existing LTS cache generation and blocks OAuth writes until a baseline load succeeds; mock browser smoke covers 5xx load failures and verifies no write request is emitted | Accepted as a shared auth/quota safety fix with no Management API schema change. |
| Kimi versioned OpenAI URL / `f324135` | `defer` | The technical `/v1` correction belongs to the still-unaccepted Kimi workbench surface; current Panel already supports Kimi quota/auth files but has no Kimi branded workbench group | Reassess only as part of a commercial-neutral, config-detected Kimi workbench design; do not introduce the upstream affiliate constants to absorb one URL hunk. |
| Kimi functional/theme base / `b2c8490`, `7fb5890`, `f860bc8` | `defer` | The feature reached upstream main, and `5b62fa1` fixed custom sponsor endpoint preservation, but the accepted Panel surface still does not include a Kimi workbench group and the implementation remains coupled to promotional/affiliate code | Revisit as a separate feature decision; custom endpoints must round-trip unchanged and unconfigured Kimi must stay hidden. |
| Kimi domestic/overseas mapping / `6a6a22a` (`v1.18.5`) | `defer` | Adds `moonshot.cn`/`moonshot.ai` protocol mappings and changes the default region inside the unaccepted Kimi workbench surface | Do not port as an isolated endpoint patch. Region defaults and the new provider surface require an explicit product decision and commercial-neutral implementation. |
| xAI paid OAuth health fallback / `3738c0b` (`v1.18.6`) | `defer` | The upstream refresh path can issue `POST https://api.x.ai/v1/chat/completions` with `grok-4.5`; this is a potentially billable write-like probe, not a quota read. Current CPA-Core-LTS auth-file list entries expose `prefix` but not the upstream classifier's `using_api`, raw JWT, or nested credential metadata, so the paid classifier cannot be adopted as-is. The upstream test also uses `bun:test`, outside this repository's npm/Node gates. | Do not cherry-pick or enable the chat probe by default. Reassess only with an explicit user-controlled paid-health action, a confirmed Core metadata contract that identifies paid credentials without exposing tokens, no retained unused account identifiers, and npm/Node plus browser-smoke coverage. Preserve the existing billing error when the optional probe is not explicitly enabled. |
| Kimi promotion series / `e2aa494`, `6a8319d`, `339529f`, `bb48387`, `72c13c0`, `36681ce` plus affiliate hunks in `f860bc8` | `reject` | `provider-workbench` contract requires commercial-neutral, config-detected groups without registration links | Do not add recommended-provider placement, quick sign-up controls, or `?aff=cliproxyapi` registration links. |

## Audited seven-day intake snapshot (2026-07-30)

Refs were re-fetched with pruning after the accepted ports were merged:

- `origin/main`: `8546513f8880cd6409dccc2abb3e0edc16bbdc2a`
- `upstream/main`: `1708314bc7a27e0ad9ef86b083e28e4e00aceeb1` (`v1.20.0`)
- `upstream/dev`: `51b034dd914719c3bd6b5ab0eb64bc8b103ca0d4`
- Review window: commits on `upstream/main` since `2026-07-23T00:00:00+08:00`
- Canonical non-merge commits reviewed: 21
- Decisions: 2 `direct-port`, 6 `adapt-port`, 3 `reject`, 10 `defer`

Accepted ports were delivered in three independently validated PRs:

- PR #47 / merge `6f1bad7803bd7ac51f7b39f94d86284567eecde5`: localized Plugin Store and provider URL CSS fixes.
- PR #48 / merge `d10cf1a240b6ea7d07510e0b12378433774f50ce`: Kimi/Fable quota and Kimi auth-file theme adaptation with npm/Node regression coverage.
- PR #49 / merge `8546513f8880cd6409dccc2abb3e0edc16bbdc2a`: Management API error parsing and ClaudeAPI current/legacy gateway adaptation without promotional metadata.

Every accepted PR passed `npm run check:lts`, `npm run validate:lts`, `npm run smoke:lts`, and `npm run smoke:lts:core -- --no-write-smoke` before merge. PR-head CI passed for the exact reviewed SHA. Publishing a release or deploying the merged panel remained outside this intake.

| Upstream commit | Classification | Panel evidence | Decision |
|---|---|---|---|
| `3447a0bd582dae34ac08b172b546ca53c87d4084` | `adapt-port` | PR #48 / `7d1d3ba` | Show Kimi detail windows before the weekly summary; replace the upstream Bun test with the repository's npm/Node+Vite regression test. |
| `f2be3bb5da3db60a8862dd7f27cdbf761b61fb5e` | `reject` | LTS visual config and current CPA-Core-LTS still expose `codex.identity-confuse` | Do not remove a downstream Core config surface that remains supported and user-configurable. |
| `e677a68c4d35eee7082929837b4cd46a3fa0cb36` | `adapt-port` | PR #49 / `ff2d905` | Prefer the human-readable Management API `message`, retain the stable machine code as `apiCode`, and preserve connection-generation isolation so a delayed 401 cannot log out a newer connection. |
| `aef7ff09913321e4ee94e0f4daabc05a13451a30` | `defer` | Sidebar series review | This begins a multi-commit navigation redesign. Reassess the complete series against `/usage`, plugin capability gating, downstream routes, responsive behavior, and badge semantics instead of porting its first layout step alone. |
| `4d081359b9f1a7313e8f52385d0b7dc939a658d4` | `defer` | Sidebar/auth-file series review | Auth-file events, navigation badges, tooltip accessibility, and locale changes span shared state and LTS routes; require a dedicated integrated port and browser acceptance. |
| `55903260183964fa084a985c248a4112023497d0` | `defer` | Sidebar series review | The color-token hunk is coupled to the unaccepted sidebar layout sequence and should be reviewed with that complete visual direction. |
| `05631cfb4396214bb57e02345b296b117e7eff5f` | `adapt-port` | PR #48 / `7d1d3ba` | Apply only Kimi light/dark theme-surface behavior while retaining LTS auth-file quota/status integration and existing provider visibility. |
| `7793321b189be64e23326c6e140b07ee4689a337` | `defer` | AuthFiles diff review | The large page redesign deletes the current status-filter surface and overlaps downstream quota/cache/write guards; evaluate as a standalone product change, not a maintenance fix. |
| `b24f3069be19cb94a7a42efeadef3a0d8b411260` | `adapt-port` | PR #49 / `ff2d905` | Use `gw.apito.ai` as the current ClaudeAPI gateway and keep `gw.claudeapi.com` as legacy detection; omit registration and affiliate metadata. |
| `1d7bc0d1902e68308606a92443b6415023232e63` | `defer` | Auth-file write-path and current Core review | The manual refresh action mutates `expired` through `/auth-files/fields`; accept only after provider-specific refresh semantics, disabled/runtime-only behavior, concurrent writes, and authenticated browser coverage are reviewed as one feature. |
| `458e5e144bb9422a270c7df30e7b36d206839fa2` | `direct-port` | PR #47 / `53ca3b7` | Localized Plugin Store card grid and badge wrapping; no route, API, plugin gate, or usage impact. |
| `cf3c6174440b669a60139b4aca48a8cb25ef11d5` | `defer` | Sidebar series review | The nav-group cleanup assumes the preceding unaccepted sidebar structure; do not port it independently. |
| `0a2be7dc57bcf08313c91689a3a6c847ed9f5f7a` | `reject` | Current CPA-Core-LTS Home client/runtime and Panel Home smoke | Removing Home detection would break an actively retained runtime compatibility path. |
| `21af57620b45f5e159e5450bc7e702498b664639` | `reject` | Current Home log payload/cursor implementation and browser smoke | Keep Home request-log payload, cursor, pagination, and download compatibility while Core retains Home. |
| `310fbff060006694a6a827beec4d92e361fd0a0a` | `direct-port` | PR #47 / `c531596` | Localized responsive ellipsis for long provider base URLs; no data or mutation behavior changes. |
| `ba02883736221a977a7206c69fe0979d4d0f81c1` | `adapt-port` | PR #48 / `7d1d3ba` | Format Kimi reset durations over 24 hours as `Xd Yh` while preserving sub-day and `<1m` behavior under Node regression tests. |
| `38f98975f8c30dc6b016527fc503583b8b82bb8a` | `defer` | Dashboard rewrite diff review | This is a new dashboard architecture with more than 3,000 changed lines and new metrics/state assumptions; it needs a separate LTS product and performance review. |
| `a9eb14b92920245eb25364a526ea40f3ea32047a` | `defer` | Dashboard series review | Real-time metrics, live-wire components, theme variables, and animation changes depend on the unaccepted dashboard rewrite. |
| `50c3b9fb3b3de8068393ba86f2615d7f5e1a46ad` | `adapt-port` | PR #48 / `7d1d3ba` | Parse modern Claude Fable `weekly_scoped` limits, prefer the active valid candidate, keep the legacy `iguana_necktie` fallback, and suppress duplicates. |
| `0f87214e262a683d2b3ea291b5a16ee4469d22d7` | `defer` | Dashboard series review | Animation and chart responsiveness changes have no safe standalone target before the dashboard rewrite is accepted. |
| `1708314bc7a27e0ad9ef86b083e28e4e00aceeb1` | `defer` | Dashboard series review | Ambient positioning and wash effects are follow-up CSS for the deferred dashboard architecture. |

`upstream/dev` has one additional watchlist commit, `51b034dd914719c3bd6b5ab0eb64bc8b103ca0d4`, which adds `applicableAvailableCount` to shared Codex quota structures. It remains `defer`: it is not on `upstream/main`, and CPA-Panel-LTS owns additional Codex quota/reset-credit classification in `src/lts/codexQuota/`. Reassess only after the upstream behavior stabilizes and can be compared against the sidecar's selection and availability semantics.

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
