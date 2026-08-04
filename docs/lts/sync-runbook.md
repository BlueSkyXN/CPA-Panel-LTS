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
| `38f98975f8c30dc6b016527fc503583b8b82bb8a` | `accept-port` | `codex/upstream-dashboard-visual-port` | Dashboard rewrite accepted as the phase-1 visual port: data layer verified to depend only on `recentRequests`/config/auth-files (not removed usage stats); ampcode provider counting kept via `countAmpcodeConfig`; feature contract and guard markers updated to the new paths. |
| `a9eb14b92920245eb25364a526ea40f3ea32047a` | `accept-port` | `codex/upstream-dashboard-visual-port` | Real-time metrics, live-wire components, theme variables, and animation changes ported together with the dashboard rewrite. |
| `50c3b9fb3b3de8068393ba86f2615d7f5e1a46ad` | `adapt-port` | PR #48 / `7d1d3ba` | Parse modern Claude Fable `weekly_scoped` limits, prefer the active valid candidate, keep the legacy `iguana_necktie` fallback, and suppress duplicates. |
| `0f87214e262a683d2b3ea291b5a16ee4469d22d7` | `accept-port` | `codex/upstream-dashboard-visual-port` | Animation and chart responsiveness changes included in the accepted dashboard port. |
| `1708314bc7a27e0ad9ef86b083e28e4e00aceeb1` | `accept-port` | `codex/upstream-dashboard-visual-port` | Ambient positioning and wash effects included in the accepted dashboard port. |

The earlier `upstream/dev` watchlist commit `51b034dd914719c3bd6b5ab0eb64bc8b103ca0d4` is now on `upstream/main` and is reassessed in the next snapshot. It remains `defer`: CPA-Panel-LTS owns additional Codex quota/reset-credit classification in `src/lts/codexQuota/`, so its selection and availability semantics must be compared with the sidecar before porting.

## Audited seven-day intake snapshot (2026-08-03)

Refs were fetched after Core v7.2.116, Panel pricing, and the 360-day Codex analytics PRs were merged:

- `origin/main`: `a60570ca8ec9d3d5a1184491cf9b7c01e76e4e72`
- previous audited boundary: `1708314bc7a27e0ad9ef86b083e28e4e00aceeb1` (`v1.20.0`)
- `upstream/main`: `30478c539c1f06649ac78deebeff6cfc227bbe22` (`v1.21.4`)
- canonical first-parent non-merge commits reviewed: 56
- raw upstream diff: 180 files, 18,426 insertions, 8,505 deletions
- decisions: 1 `direct-port`, 11 `adapt-port`, 6 `already-equivalent`, 1 `reject`, 37 `defer`

The accepted subset is deliberately architecture-neutral: auth-file boundary normalization and stale-request/cache guards, xAI/Kimi quota parser correctness, reset/refresh exclusion, and the standalone Sheet focus fix. The AuthFiles/Vault rewrite, WRR/excluded-model/Interactions contracts, and the quota redesign/timeline series remain deferred. Full usage statistics, the old LTS quota host, npm/package-lock, all downstream Codex sidecars, and `management.html` remain unchanged.

Dependency chains reviewed as units rather than isolated hunks:

- AuthFiles: `dbe7094 -> 20c0cb8 -> b9c3fbb -> cc13476 -> 0a181ba -> 29b1b9b`
- WRR: `8faaa39 -> 90971e8`
- Excluded models: `afd7da0 -> 20bb855 -> 4abd41f -> 826ea3c`
- Quota redesign: `572da18 -> 9ecd89b -> 54af5fb -> 46ffeba -> 1705246 -> ... -> 30478c5`

| Upstream commit | Classification | LTS evidence and decision |
|---|---|---|
| `51b034dd914719c3bd6b5ab0eb64bc8b103ca0d4` | `defer` | Codex `applicableAvailableCount` 与 LTS `src/lts/codexQuota/` 的 reset-credit 分类不等价；待 sidecar/API 一起审。 |
| `22cf825d071ac9cc835fe422dae87acd2fded3a2` | `accept-port` | `codex/upstream-dashboard-visual-port`：共享 motion hooks（`src/hooks/motion.ts`）随 Dashboard 移植一并接纳；`useCountUp` 的 effect 内同步 setState 按 LTS lint 规则改为 rAF 调度。 |
| `b62dbefda80f81fabaff189f931ce77583efab59` | `defer` | QuotaCard/AuthFiles 样式与错误 resolver 大重排依赖新 quota 架构，不能覆盖 LTS 宿主。 |
| `dbe7094e8cb3152e9f9422fb942fd5b0107af98d` | `adapt-port` | 已在 `authFiles.ts` 保留 raw 字段并归一化 camelCase、recent requests、计数和 Blob download；Node regression 覆盖。 |
| `20c0cb865e5572757ae01fa4e3d5ca7d0af16389` | `adapt-port` | 已适配到旧页面 hooks：后台刷新、stale list request、batch download、model/quota cache invalidation；未引入新 AuthFiles 架构。 |
| `b9c3fbbb77fc686251290d5d7d5434a038460857` | `defer` | AuthFiles card/quota/sheet/batch componentization 是大结构迁移，会穿过现有 LTS quota/OAuth 集成。 |
| `cc13476844e4328cf1f1a973d548e019ccd371ff` | `defer` | Vault header、pulse、provider tabs 重建并删除旧页面；需独立产品/浏览器验收。 |
| `0a181ba6616ca67a17f42659f0816f706a5c39f5` | `defer` | 依赖未接纳的 Vault/Pulse 结构及 i18n 删除，不能单独移植。 |
| `29b1b9bb4812a8e3b475f34794f736013bd73947` | `defer` | 仅是未接纳 VaultHeader 的后续整理，当前 LTS 无对应组件。 |
| `3c8eba30274b315e702ac76108f40ae378027577` | `adapt-port` | 已统一 `isProblemAuthFile`：disabled 独立，error/unavailable/非健康 message 才进入问题筛选和批量删除；有 Node regression。 |
| `966a2918d53e9bb272e61b77ceef8c85c8eea69a` | `adapt-port` | 已使 auth-file 上传/删除/字段保存同步失效 model 与 generation-protected quota caches；有 Node regression。 |
| `840df32f16a6b67da455f1676494da31d031f16d` | `adapt-port` | 已给 model modal 增加 request ID、全局/单文件 cache version 和 close invalidation，旧响应不能覆盖新 modal。 |
| `b76037ac7cb4860926c25ff92eb2ef485f6cf938` | `adapt-port` | 已让只有最新 list request 清 loading/refreshing，mutation 失效时主动收口状态。 |
| `c9636a3c543c564ca9b59fd5d9b3c22da1970969` | `adapt-port` | 已增加同步 `uploadPendingRef`，阻止 React 状态提交前的重复上传。 |
| `6360b52d1827dfa647172d8aafcb6f195dbd01ac` | `already-equivalent` | 当前 `AuthFilesPage.module.scss` 已覆盖 header/action/pagination/quota 的 mobile wrapping；不复制新路径 CSS。 |
| `9524cc7f32a3d227a71540e169b0a7b1545dbdc9` | `defer` | Codex Pro 20x badge/animation 依赖新 quota/AuthFiles 视觉架构，不是 correctness port。 |
| `8faaa395346624258408b442a5d4923f3b0e1fc8` | `defer` | WRR strategy/credential weight 跨 Core schema、visual config 和写入并发，需跨仓库专项。 |
| `90971e8f6a573e800dc8909c350285bf2f1c2396` | `defer` | 依赖 WRR Core contract 与新 AuthFiles UI，不能只接 weight 控件。 |
| `530b585bd0b72448bc576e970b0f2c6f1f55df11` | `defer` | Interactions provider surface 需要当前 CPA-Core-LTS Management/API contract；本批次不新增 provider 产品面。 |
| `fe93db0941de406c336d0db8a4a12f9ebd8959bd` | `already-equivalent` | LTS `CODEX_CONFIG.canResetQuota` 已按 total available reset credits 显示 reset action。 |
| `6cda18a85235e7f047d8584d93480319c10e1942` | `defer` | 9524cc7 的视觉 follow-up，依赖未接纳 quota redesign。 |
| `13a22da08224930fd50a07e4497540469764b988` | `accept-port` | `codex/upstream-dashboard-visual-port`：`features/dashboard/.heroPeriod` 随 Dashboard 移植一并落地。 |
| `afd7da059d9749773127163eb42236694ad801f8` | `defer` | LTS 已有不同的 OAuth excluded-model contract；新 per-auth/global rules 需与 Core 一起审。 |
| `20bb8559d476efb5cc3707d68bb8c74ed2a79375` | `defer` | 依赖 afd7da0 的 excluded-model backend/UI contract。 |
| `4abd41f947bccae528acba7a4be67c074a802aa9` | `defer` | 依赖前两段 excluded-model 新模块；不替换现有 OAuth excluded 页面。 |
| `826ea3c0d0bdd6409a0a2703ada90faaf5aede2d` | `already-equivalent` | docs-only consolidation note，无运行时行为可移植。 |
| `7345e99059f66810c921529b33d7d82d2946af89` | `already-equivalent` | test-only helper extraction；当前 LTS plan tier 行为无缺口，不为镜像 ancestry 新增代码。 |
| `572da189bc4e8997efa09f3acaffad317dc79e4c` | `defer` | Provider quota data layer 大拆分与 LTS `quotaConfigs` + Codex sidecar 架构不同。 |
| `9ecd89b1367e4494bcd672da40bb04e7fc0fd917` | `defer` | Typed JSX quota bodies 依赖 572da18，直接替换会破坏 LTS renderer/styles。 |
| `54af5fb3e3cb1943cff8c93599d8963b4839a1ed` | `defer` | 新 quota feature shell 是未路由的大功能，需整体评估。 |
| `46ffeba5ddd7f2dc846353b33909ed21ef14654e` | `defer` | 将 `/quota` 切到新 shell 并删除旧实现，会直接切断 LTS quota integration。 |
| `1705246ed1ca68286c146adf08539ffa26d3db53` | `defer` | 新 quota shell 的 motion follow-up，不可独立。 |
| `fb6d94788b77e75cd46bf3e4008dbba369413a22` | `reject` | 删除的 view-mode/too-many-files i18n 仍被 LTS `QuotaSection.tsx` 使用，移植会产生缺失文案。 |
| `66d24c053c36998c1ffade24c7fb507e0eb6d306` | `adapt-port` | 已在旧 `QuotaSection` 阻止 reset 期间的单卡/全量 refresh 并禁用 refresh button。 |
| `31afcffd99e486e46b2080b7465cbaf717ee1e1c` | `defer` | 上游修的是新 Antigravity countdown component；LTS 当前显示稳定 absolute reset timestamp，无同一 hook target。 |
| `ea107fded08688eeb96c1269b036216d434eded1` | `defer` | Quota timeline/reset instant 是新 quota 架构的大功能。 |
| `01ab01d388fdcd918cc4d16d75b922844027af2a` | `defer` | 仅是 timeline 的 5h window follow-up。 |
| `ea0652c51cdf388651538b3e143da2afec8c6099` | `adapt-port` | 已在旧 xAI builder 原子选择 period type/start/end，避免 weekly 类型借用 monthly rollover；Node regression 覆盖。 |
| `66d52992e8ead5ed0f442936d875a4932e715768` | `defer` | 依赖 timeline state model，旧 LTS 无对应 stale usage fill。 |
| `f3713c53825b3e3ae6d0212b4dc82c444353520e` | `defer` | 新 QuotaPage pagination contract 与 LTS AuthFiles/Quota 分页不同。 |
| `7c072c4ab4266453f526b56505335698ac87c122` | `defer` | AuthFiles identity/search 大改跨现有筛选、分页、quota 和 OAuth。 |
| `8038469a2da13b7e3cc9fbd5a4aa3dc1ced0996a` | `defer` | QuotaTimeline empty state/zoom follow-up，无旧架构 target。 |
| `b2bd48e58b8bc5d79e47e40b974a853112d38854` | `adapt-port` | 已在旧 Kimi builder 支持 singular/plural、`TIME_UNIT_*`、snake/camel unit 和 week；Node regression 覆盖。 |
| `7976b16f6c2fb957a050c0593e571c59dc836f9b` | `defer` | LMU AI 同时带 provider、sponsor/affiliate surface，缺少 Core contract 且业务决策未授权。 |
| `6394584b99d245a055f977acf1d2da2eab346302` | `defer` | disable-cooling 跨 Core auth mutation/schema，需跨仓库写入验收。 |
| `648a3d4af4dced499e7f544a953a717b8d417605` | `direct-port` | 已原样移植 Sheet body scroll reset 与 `focus({preventScroll:true})`；不触及 protected seam。 |
| `b1aefecf94b3ba0efe41463821fd56d44ee9e21e` | `defer` | 依赖未接纳的 ExcludedModelsPanel。 |
| `285d9e6753111d30dfcf54d3c225119ade7ed3c1` | `defer` | Manual reset credit timeline 行为与 LTS Codex reset-credit sidecar 不同。 |
| `ddabc99e24cc5fdc59d47ce4de9ef2811c939e89` | `defer` | shared minute clock/relative-time 绑定新 quota bodies；不为视觉增强重构全部旧 renderer。 |
| `3eb9f3cc712983212a6d92520e6c1c7a2dc54d51` | `already-equivalent` | LTS Codex reset-credit expiry 已用 browser-local `Date`/`toLocaleString`。 |
| `0272e9b455cb38343d835f83ba26c9f7b508e580` | `defer` | 所有 absolute dates 的 relative label 依赖新 QuotaResetLabel，不扩大本批次 UI 范围。 |
| `c277ad353ca8d437de6ed04f5a1600f6a9414296` | `defer` | recovery highlight 依赖统一 resetSchedule contract，旧 LTS 无该抽象。 |
| `001e1308cfa52d893a91ab73487ef7c1cdff64f6` | `defer` | soonest-recovery sort 依赖新 QuotaPage state。 |
| `f50f9b0f643aacbbb3b699b8853e00a268387992` | `already-equivalent` | test-only Timeline prop，LTS 无 Timeline 运行时。 |
| `afee40ec2310878833831ff70757e6e73a04a5f5` | `defer` | urgent-final-hour emphasis 依赖 recovery/timeline 系列。 |
| `30478c539c1f06649ac78deebeff6cfc227bbe22` | `adapt-port` | 已在旧 Kimi rows 保留 concrete reset instant，并显示 absolute local time + relative hint；Node regression 覆盖。 |

Accepted code was validated with the repository's npm/Node regression path, TypeScript checker, ESLint, LTS contract/build, mock browser smoke, and the read-only local Core smoke before merge. Publishing a tag, GitHub release, or `management.html` asset remains a separate explicitly authorized action.


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
