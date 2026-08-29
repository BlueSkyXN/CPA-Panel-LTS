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
| `38f98975f8c30dc6b016527fc503583b8b82bb8a` | `adapt-port` | PR #54 | Dashboard rewrite accepted as the phase-1 visual port: data layer verified to depend only on `recentRequests`/config/auth-files (not removed usage stats); ampcode provider counting kept via `countAmpcodeConfig`; feature contract and guard markers updated to the new paths. |
| `a9eb14b92920245eb25364a526ea40f3ea32047a` | `adapt-port` | PR #54 | Real-time metrics, live-wire components, theme variables, and animation changes ported together with the dashboard rewrite. |
| `50c3b9fb3b3de8068393ba86f2615d7f5e1a46ad` | `adapt-port` | PR #48 / `7d1d3ba` | Parse modern Claude Fable `weekly_scoped` limits, prefer the active valid candidate, keep the legacy `iguana_necktie` fallback, and suppress duplicates. |
| `0f87214e262a683d2b3ea291b5a16ee4469d22d7` | `adapt-port` | PR #54 | Animation and chart responsiveness changes included in the accepted dashboard port. |
| `1708314bc7a27e0ad9ef86b083e28e4e00aceeb1` | `adapt-port` | PR #54 | Ambient positioning and wash effects included in the accepted dashboard port. |

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
| `22cf825d071ac9cc835fe422dae87acd2fded3a2` | `adapt-port` | PR #54：共享 motion hooks（`src/hooks/motion.ts`）随 Dashboard 移植一并接纳；`useCountUp` 的 effect 内同步 setState 按 LTS lint 规则改为 rAF 调度。 |
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
| `13a22da08224930fd50a07e4497540469764b988` | `adapt-port` | PR #54：`features/dashboard/.heroPeriod` 随 Dashboard 移植一并落地。 |
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

## Audited one-month intake closeout (2026-08-06)

Refs were fetched with pruning before the audit:

- Review window: `2026-07-06T00:00:00+08:00` through `2026-08-06`
- `upstream/main`: `30478c539c1f06649ac78deebeff6cfc227bbe22` (`v1.21.4`)
- `origin/main` at audit start: `c2b7b9886612150997de5404b32e7b647c898e58`
- Canonical upstream commits: 133 non-merge commits plus one excluded dev-sync merge (`d85afcc2`)
- No fetched upstream `main` commit was newer than 2026-08-03
- Prior runbook snapshots already covered 99 commits; the remaining 34 early-window commits were diff-reviewed against current LTS source

No additional product-code port is required beyond the already-recorded adaptations and Dashboard PR #54. The 34-commit delta closes as 17 `already-equivalent`, 5 historical `adapt-port` outcomes already present in LTS, 7 `reject`, and 5 `defer` decisions.

| Upstream commit group | Classification | LTS evidence and decision |
|---|---|---|
| `0c565c80`, `12bfeab7`, `637f399c`, `022634b6`, `ab6b0b3c`, `878abca7`, `6c64e25e`, `c69e5fd6`, `28189218`, `4afba522`, `5694b104`, `2cd2de77`, `6d540162`, `ad366efb`, `47f7a9e1`, `5754ecf3`, `73c3b15a` | `already-equivalent` | Current LTS already contains the collapsed provider editors, provider/status layout, concurrency guards, lossy-mutation protection, model-error handling, validation, alias/plugin/config preservation, quota cache isolation, and pending-save guards through commits `a88bff2`, `97f8e36`, `d7f0439`, `66f88a1`, `dd8eeba`, `2ad6d41`, `5cf2cf4`, `fd91aec`, `550199c`, `178f969`, `9dfdb13`, `42d9aff`, `fa4a7fa`, `798d39f`, `956b2c1`, and `ef50cf5`; do not duplicate them to mirror ancestry. |
| `550169cd`, `3f86f796`, `fd22c148`, `328bead7`, `fe24d787` | `adapt-port` | xAI weekly billing, FennoAI/Qiniu config-detected provider support, and plugin release-version selection are already adapted in `db3a16e`, `a88bff2`, `02b6580`, and `e7510df`. Keep npm/Node tests, commercial neutrality, unknown-field preservation, and plugin capability gates. |
| `e36de500`, `3ee7fce9`, `3785d759`, `3c91d573`, `c21d4aeb`, `d8f74ae5`, `a4f7bb20` | `reject` | The cleanup chain deletes API/config/store/auth/quota/style/locale behavior still referenced by the LTS usage, Home, quota, OAuth, plugin, and sidecar surfaces; the package change also introduces `bun.lock`. Do not copy the chain or migrate away from npm/package-lock. |
| `066d25fe`, `e43df69c`, `82bb41ce`, `9d3e82e9`, `2201fe1c` | `defer` | Orphan/icon cleanup has no product payoff; Code0/ClaudeAPI quick-fill is a separate provider UX choice; the bundled ESLint/provider-sort/secure-storage/log-scroller refactor must be split before review because LTS retains Home log behavior. None is required for current correctness. |

## Post-closeout v1.22.0 intake (2026-08-06)

Upstream published a new release after the earlier same-day closeout, so refs were fetched again before final repository cleanup:

- previous audited boundary: `30478c539c1f06649ac78deebeff6cfc227bbe22` (`v1.21.4`)
- `upstream/main`: `0eeb747cdc7903834fee00ce9f9254c23b162be9` (`v1.22.0`)
- `origin/main` at intake start: `bdd4a69b93d018efd14b7955abd483c11624bf52`
- canonical delta: 11 non-merge commits, 66 files, 7,001 insertions, and 4,955 deletions
- decisions: 4 `adapt-port`, 2 `already-equivalent`, 5 `defer`

The release is dominated by a replacement Config page. That rewrite cannot be copied over LTS: its field registry omits downstream Core surfaces including `codex.abnormal-reasoning-retry`, `transient-error-cooldown-seconds`, `enable-gemini-cli-endpoint`, and the existing LTS payload/config preservation markers, then deletes the current editor files that implement them. The accepted subset therefore stays on the existing LTS Config architecture and ports only independent behavior.

| Upstream commit | Classification | LTS evidence and decision |
|---|---|---|
| `c2feeac1`, `40749f00`, `77ec68bd`, `38ee01c0` | `defer` | Treat the feature shell, section migration, document orchestration, route switch, and legacy-editor deletion as one dependency chain. A future port must first map every `VisualConfigValues` leaf and protected marker, preserve source/visual concurrent-save behavior, keep plugin store sources and downstream Codex retry controls, then pass authenticated browser write smoke. Do not copy the new route or delete the current editor piecemeal. |
| `00f34bc3` | `adapt-port` | Commit `b1b05ca88b74a3a65cea1db9a7b6c40129130889` ports the independent `Collapsible` easing and `prefers-reduced-motion` behavior. Styles that target only the deferred Config feature remain with that chain. |
| `437fa820` | `already-equivalent` | Existing LTS commits `3308307` and `5469945` already switch invalid YAML to source mode while leaving the Visual tab available; `handleTabChange('visual')` reparses the repaired source before switching back. |
| `c7fe030c` | `already-equivalent` | The current LTS page has one action-bar status surface, derived from the same connection/loading/error/validation/dirty state; it has no separate redesigned header metadata state that can diverge. |
| `125cdbd8` | `adapt-port` | Commit `b1b05ca88b74a3a65cea1db9a7b6c40129130889` adds localized validation counts to the accessible names of the existing section, subsection, and system-tab navigation. LTS does not show per-section dirty dots, so it does not announce a state that is not visually represented. |
| `6e550fbe` | `defer` | This changes the new page's explicit Discard action to restore its captured server snapshot. The current LTS control is intentionally Reload and fetches the latest server YAML after confirmation; adding a second Discard action belongs with the deferred page/navigation product change. |
| `cfa8f616` | `adapt-port` | Commit `b1b05ca88b74a3a65cea1db9a7b6c40129130889` replaces the 17-character modulo generator with 48 uniformly distributed base62 characters after `sk-`, using rejection sampling and Node/Vite regressions. No API, YAML shape, or saved-key validation changes. |
| `0eeb747c` | `adapt-port` | Commit `b1b05ca88b74a3a65cea1db9a7b6c40129130889` adds the advisory strength meter to the existing LTS API-key modal, keeps it non-blocking, covers all four active locales and accessible progress semantics, and corrects partial-period detection in the upstream heuristic. |

The accepted code passed `npm run validate:lts` and `npm run smoke:lts`. A real-Core smoke was not required because this subset does not add or mutate a Management API field or YAML schema. Publishing a tag, release, or `management.html` asset remains outside this intake.

The 2026-08-06 LTS navigation fix (`a8eee1b`, merged by PR #55) is an LTS-owned partial adaptation only: it restores the Logs entry and exposes Provider Workbench without importing the upstream sidebar event/badge/layout series. The complete upstream sidebar series remains deferred until auth-file events, responsive layout, `/usage`, and plugin capability behavior are reviewed together.

Open upstream PRs were reviewed separately because they are not represented by `upstream/main` history:

| Upstream PR / head | Classification | LTS evidence and decision |
|---|---|---|
| `#371` / `5d8d18f7` | `defer` | The Anthropic login-mode selector depends on Core PR #4830 adding the `manual` query parameter and returning the effective mode. Current CPA-Core-LTS `RequestAnthropicToken` neither reads `manual` nor returns it. When an older Core ignores the parameter, the proposed Panel falls back to the user's selected mode and can label a local callback as a manual authorization-code flow, so it is not harmless for the current LTS pair. Reassess after the Core contract lands with an explicit response/capability signal and authenticated browser coverage for both redirects. |
| `#366` / `4b9aea67` | `defer` | Custom/system/accelerator plugin proxy selection depends on the still-open Core PR #4693 and new `/plugin-proxy`, `/plugin-proxy/validate`, and `/proxy-url` contracts. Its service split also drops `PluginStoreResponse.sources`, which LTS needs for `plugin_store_sources` round-trip behavior. A later adaptation must preserve that field, the plugin capability gate, confirm-token flow, npm validation, and authenticated write smoke. |
| `#367` / `93c4cb0c` | `defer` | Per-key profiles, request/token limits, summaries, and recent events depend on the still-open Core PR #4753 and its SQLite-backed Management APIs. The page may later coexist with protected full `/usage`, but it must not redirect away from existing LTS API-key configuration or replace full usage statistics without an explicit capability/version contract. |
| `#352` / `9813935a` | `defer` | Korean locale support is independent of Core but expands the active four-locale contract. Accepting it requires a reviewed `ko.lts.json` overlay, complete LTS-only keys, locale guards, language selection/browser mapping, and translation QA; that product expansion is outside this intake closeout. |

## Audited seven-day v1.22.1-v1.22.2 intake (2026-08-10)

Refs were fetched with pruning after the prior `v1.22.0` intake:

- rolling review window: `2026-08-03T11:11:54+08:00` through `2026-08-10T11:11:54+08:00`
- previous audited boundary: `0eeb747cdc7903834fee00ce9f9254c23b162be9` (`v1.22.0`)
- `upstream/main`: `f60c8ca683b118be5750ff102187cc6d8ad4605b` (`v1.22.2`)
- `origin/main` at intake start: `63e411301c1b7f1cfcaf294fab673c3405fb1f29`
- new canonical delta since the prior boundary: 2 non-merge commits, 19 files, 423 insertions, and 18 deletions
- decisions: 1 `already-equivalent`, 1 `adapt-port`

| Upstream commit | Classification | LTS evidence and decision |
|---|---|---|
| `1ad9cac75c6bd694160da3b80f4092cff1b83da4` | `already-equivalent` | The upstream fix pins its unified Codex timeline lane to the account `five-hour` or `weekly` window instead of a same-period Spark window. LTS does not use that timeline state model: `buildCodexQuotaWindows` builds the account rows from the top-level `rate_limit`, renders each `additional_rate_limits` entry with separate IDs, and derives analytics only from the top-level weekly window. The incorrect lane substitution is therefore not reachable, so no timeline code was copied. |
| `f60c8ca683b118be5750ff102187cc6d8ad4605b` | `adapt-port` | Panel commit `5703e0c` / PR #61 recognizes the official Infistar domestic and global endpoints across OpenAI, Codex, Anthropic, and Gemini configs while retaining backend `sourceIndex` and leaving custom endpoints in the generic group. The group is config-detected only. Affiliate metadata, registration links, recommendations, quick fill, and the upstream Bun tests were omitted; the accepted path uses the repository's Node/Vite regression and four active locales. |

The accepted adaptation passed `npm run validate:lts`, `npm run test:provider-integrity`, `npm run check:lts`, and `git diff --check`. An initial sandboxed Chromium launch was blocked by the macOS Mach port permission, but the final `npm run smoke:lts` rerun outside that sandbox completed successfully. No Core Management API, full usage statistics, quota data model, release workflow, tag, release, or deployment changed.

## Audited seven-day v1.22.3-v1.22.5 intake (2026-08-18)

Refs were fetched without pruning before diff review:

- rolling review window: `2026-08-11T16:04:21+08:00` through `2026-08-18T16:04:21+08:00`
- previous audited boundary: `f60c8ca683b118be5750ff102187cc6d8ad4605b` (`v1.22.2`)
- `upstream/main`: `0d84919845b5be9f8d1dd8ed1e03f6bff77ade65` (`v1.22.4` and `v1.22.5` point to the same merge)
- `origin/main` at intake start: `367a46dbd7402c43f186ddbc901b7a37d531596f`
- exact seven-day window: 3 non-merge commits plus 1 merge, 15 files, 204 insertions, and 15 deletions
- carry-forward since the prior audited boundary: `38b6ac66138b4105f0f982465fb6ffe1c7005b4b` from 2026-08-09, reviewed here so no new upstream commit is skipped
- full delta since `v1.22.2`: 4 non-merge commits plus 1 merge, 16 files, 209 insertions, and 20 deletions
- decisions: 1 `direct-port`, 3 `reject` rows; no protected usage, Core API, package, build, or release change is required

| Upstream commit | Classification | LTS evidence and decision |
|---|---|---|
| `38b6ac66138b4105f0f982465fb6ffe1c7005b4b` | `direct-port` | PR #65 corrects the config-detected provider display name from `ClaudeAPI` to `Claudeapi.com` in the shared constant and all four active locales. Current and legacy gateway detection remains unchanged, and no affiliate, registration, quick-fill, or outbound request behavior is added. |
| `73db424f08e273c56d70812b38a8dd0cc11c4410` (`v1.22.3`) | `reject` | Upstream temporarily hides FennoAI and QiniuCloud because their sponsor roster changed. LTS already removed affiliate and promotion metadata, and exposes these brands only when matching configuration actually exists. A temporary commercial relationship change is not a correctness reason to hide stable, config-detected provider management or move those entries to generic groups. Existing backend `sourceIndex`, custom-endpoint preservation, and neutral visibility remain. |
| `3d922bf34da03fc1b7448ea68d0b9843eed22264`, `c6c8e3bb66489eed2d751bbcff03193a47f4752e` | `reject` | The BestProxy row is a referral link (`?keyword=ayh7otlb`); the `labelExtra` / `topExtra` and sibling alignment changes exist only to make room for that sponsored row inside the still-deferred replacement Config architecture. The commercial-neutral contract rejects the link and its otherwise unnecessary layout scaffolding. |
| `0d84919845b5be9f8d1dd8ed1e03f6bff77ade65` (`v1.22.4`, `v1.22.5`) | `reject` | The merge has no independent hunk beyond the two rejected parent decisions above. Do not cherry-pick it merely to mirror upstream ancestry or release tags. |

The accepted copy correction is covered by provider tests, four-locale build checks, the full LTS validation gate, and mock browser smoke in this intake. No tag, GitHub release, `management.html` publication, Core deployment, or live runtime update is part of the selective-port.

## Post-closeout v1.22.6 intake (2026-08-19)

Refs and tags were fetched with pruning after the prior `v1.22.5` closeout:

- rolling review window: `2026-08-12T22:11:51+08:00` through `2026-08-19T22:11:51+08:00`
- previous audited boundary: `0d84919845b5be9f8d1dd8ed1e03f6bff77ade65` (`v1.22.4` and `v1.22.5`)
- `upstream/main` and `upstream/dev`: `6586f88858ca27e840bd8db2630dccd371a1cd4a` (`v1.22.6`)
- exact seven-day window: 4 non-merge commits plus 1 merge; the first 4 were already classified in the 2026-08-18 snapshot
- new delta since the previous audited boundary: 1 non-merge commit, 1 file, 1 insertion, and 4 deletions
- decision: 1 `already-equivalent`; no product-code port, contract change, guard change, or test change is required

| Upstream commit | Classification | LTS evidence and decision |
|---|---|---|
| `6586f88858ca27e840bd8db2630dccd371a1cd4a` (`v1.22.6`) | `already-equivalent` | Upstream clears `TEMPORARILY_HIDDEN_SPONSOR_BRANDS`, restoring FennoAI and QiniuCloud after `73db424` temporarily hid them. LTS rejected that temporary commercial-roster behavior and never introduced the hidden-brand set: both providers remain commercial-neutral, config-detected groups that appear only when matching configuration exists. Do not add an empty compatibility layer merely to mirror upstream ancestry. |

The `v1.22.6` tag still descends from the rejected BestProxy referral and layout-scaffolding chain (`3d922bf`, `c6c8e3b`, and merge `0d84919`). Restoring provider visibility does not make the release tag safe to sync as a whole. The existing provider contract and mock browser smoke already require configured FennoAI/QiniuCloud groups to be visible while preventing unconfigured recommendation placement; full usage statistics, Core Management API compatibility, npm/package-lock, LTS sidecars, plugin gates, and `management.html` are unaffected.

This intake changes only the durable decision record. Its required validation is the repository's docs-only `git diff --check`, status, and changed-file review; no product behavior or release was changed.

## Audited seven-day v1.22.7-v1.22.9 intake (2026-08-29)

Refs and tags were fetched without pruning before commit-level diff review:

- review window: `2026-08-22T00:00:00+08:00` through `2026-08-29T20:58:03+08:00`, selected by committer time
- previous audited boundary: `6586f88858ca27e840bd8db2630dccd371a1cd4a` (`v1.22.6`)
- `origin/main` at intake start: `2f2192853391231f1076697a67a326b629ba05e9`
- `upstream/main` and `upstream/dev`: `d249ff008e0bc2803deb23fb3e2c62418a1e8d17` (`v1.22.9`)
- exact delta: 4 non-merge commits plus 1 merge, 19 files, 232 insertions, and 55 deletions
- decisions: 1 `direct-port`, 1 `adapt-port`, 1 `already-equivalent`, and 2 `reject`

The accepted subset is a manual LTS port, not release/tag ancestry intake. It updates the shared Codex quota request identity and replaces the deprecated Claude CCH checkbox with the current Core-owned `fingerprint-profile` contract. Full usage statistics, stable provider routes, plugin capability gates, npm/package-lock, LTS sidecars, and `management.html` remain present.

| Upstream commit | Classification | LTS evidence and decision |
|---|---|---|
| `73baabab62ba21fcf4e76d80e472c4ebf87545af` | `reject` | PR #394 adds APIMart registration links, marketing copy, and about 9.2 MB of sponsor images to the public READMEs. It has no Panel correctness or Core compatibility change and conflicts with the commercial-neutral LTS contract. |
| `0a3ef8475119fa3d42628ee8e2806d7265505f5b` | `reject` | This is the PR #394 merge carrier and has no independent hunk beyond the rejected sponsor content. Do not absorb it to mirror `v1.22.7` ancestry. |
| `681d70481df8857f0456848283b1446a63e85b9c` (`v1.22.7`) | `already-equivalent` | Upstream standardizes type sizes inside the replacement `AuthFileQuota.module.scss`. LTS did not accept that Vault/quota architecture: its current host already uses consistent 12px quota text, while the LTS Codex sidecar intentionally retains a separate hierarchy for labels, values, and reset-credit details. Do not create the absent upstream module or flatten the LTS hierarchy merely to copy the implementation. |
| `966abff9e9d3aa12308f82772e8455591cc93ef5` (`v1.22.8`) | `direct-port` | Replace the stale `codex_cli_rs/0.76.0` quota identity with upstream's current `codex-tui/0.149.1` identity. The endpoint, token placeholder, methods, parsers, and remote-cloud `Codex Desktop` identity are unchanged. The optional read-only quota monitor is updated because it calls the same `/backend-api/wham/usage` endpoint through Core. Node regression locks the exact shared header; live ChatGPT endpoint acceptance remains a separate runtime check. |
| `d249ff008e0bc2803deb23fb3e2c62418a1e8d17` (`v1.22.9`) | `adapt-port` | Current `CPA-Core-LTS origin/main` exposes and validates `claude-api-key[].fingerprint-profile`, accepting empty/default or `claude-code-cli` and retaining `experimental-cch-signing` only as a deprecated no-op. LTS adapts the complete type/normalize/serialize/form/tag/four-locale chain onto its unknown-field-preserving provider workbench, clears the deprecated field on save, and replaces the Bun test with Node/Vite plus mock/real-Core browser assertions. Stable provider pages and config-detected commercial-neutral groups are unchanged. |

Open upstream PRs updated in the same window were reviewed separately because they are not part of `upstream/main`:

| Open upstream PR / head | Classification | LTS evidence and decision |
|---|---|---|
| `#399` / `1842c5948a63c65f073aeb5af66528812e2dba53` | `defer` | OrcaRouter can use the existing OpenAI-compatible and Claude config contracts, so it does not require a new Core endpoint; the only related Core PR #4950 is a still-open documentation example. However, this provider-team-authored PR is `REVIEW_REQUIRED`/`BLOCKED` with no checks or reviews, and its upstream implementation adds a permanent first-class commercial brand rather than LTS's config-detected, recommendation-free behavior. Current LTS/Core source contains no OrcaRouter-specific contract or demonstrated configured use. Reassess after upstream review/merge or a real configuration need, then manually adapt it with `sourceIndex`/unknown-field preservation, Node/Vite tests, browser mutation recovery, and `CONFIG_DETECTED_BRANDS`; do not port this exact PR now. |
| `#398` / `927034542f6e71cd1e6f9aebbc7ba972b87890d3` | `defer` | Command Code provider management depends on still-open Core PR #5060 and `/commandcode-api-key`; current CPA-Core-LTS has no matching config or Management API contract. Reassess as a provider-workbench adaptation only after Core support lands, while retaining `ampcode` counts, unknown fields, stable providers, and full usage. |
| `#397` / `b1b7944d8fe50328de897b0148f5d7190ffc73c8` | `reject` | The Tor proposal mixes five commits, 38 files, a large unrelated lockfile/config/UI bundle, duplicate Tor panels, and routes not proven registered by still-open Core PR #5282. LTS also uses a different protected Config architecture. If Core later ships a reviewed Tor contract, start a clean Config adapt-port rather than reuse this branch. |
| `#393` / `1f6d0f7a00e6c602d3a1292746d8962a081ac4ab` | `defer` | Native `kimi-api-key` depends on still-open Core PR #5225, replaces the current OpenAI plus Claude dual-protocol model without a migration decision, and retains affiliate behavior rejected by LTS. Reassess only as a commercial-neutral, config-detected full-chain adaptation after the Core contract lands. |
| `#389` / `8151e55f864107c5c9a8684be5baefb2d8da0496` | `defer` | Managed users and OAuth invitations depend on still-open PostgreSQL-gated Core PR #5169. The Panel PR has no capability gate and exposes high-impact user/key/invitation writes and one-time secrets. It needs an independent permissions/product decision and authenticated write/readback coverage. |
| `#388` / `5d23e766c7a8f0cb200bc7a9312f772ef27e127b` | `defer` | Cursor quota could theoretically reuse the existing generic `/api-call`, but current LTS has no verified Cursor credential or payload contract. The PR makes five POST reads and targets the unaccepted replacement quota timeline. Reassess first after real read-only payload/Core smoke, then adapt only into the existing quota host without replacing full usage. |

None of these open PRs has a completed review or visible Panel check result. Their watchlist classification is not permission to pre-port an unstable backend contract.

Local and GitHub work were audited separately before this intake branch was created:

- local `main` equaled `origin/main` at `2f2192853391231f1076697a67a326b629ba05e9`, with no tracked/untracked changes, stash, extra linked worktree, or open Panel PR
- six retained feature/docs branches are ancestors of `main`; their PRs were already merged
- `codex/panel-upstream-port-20260822` / PR #67 remains intentionally closed and unmerged because its empty sponsor-hiding compatibility layer has no current behavior benefit and can hide unsupported brand combinations
- 21 unreachable commits were reviewed without creating refs or running GC/prune; lost-stash UI and usage candidates were older prototypes superseded by current behavior, so no production code was restored
- still-useful orphan assertions were rewritten into the current Node/Vite suites: OAuth force-mapping/excluded/dirty-state preservation and the plugin store's combined official-source plus official-repository trust rule

The dangling objects remain only historical recovery material. Their presence is not a reason to merge rejected code, and destructive object cleanup remains outside this intake.

The completed intake passed `npm run validate:lts`, `npm run smoke:lts`, and the full `npm run smoke:lts:core`. The real-Core smoke used temporary local configuration against the clean sibling Core checkout at `3ec9109b69aa5377763166fa891d7831960490e3` and proved Claude fingerprint create, readback, reset, and delete through the Management API and browser workbench. The accepted schema was also read directly from `CPA-Core-LTS origin/main` at `7eadb07e34139af5e0922a8a5c97485be8a4267c`. These checks do not establish a GitHub merge, release, deployment, live ChatGPT quota acceptance, or business UAT.

## Core-backed deferred-contract reassessment (2026-08-29)

The historical `defer` decisions for WRR, auth-file weight, and Interactions API were correct while the companion Core contract was absent. They are superseded for current maintenance only after a fresh cross-repository readback:

- Panel baseline: `origin/main` at `987d9903e1a15f25aa5c196d0532242c80586d1a`
- Panel upstream: `upstream/main` at `d249ff008e0bc2803deb23fb3e2c62418a1e8d17` (`v1.22.9`)
- companion Core contract: `CPA-Core-LTS origin/main` at `dd465fb4002fc2846544f0dbcda879e1411792b8d`
- Core now registers GET/PUT/PATCH/DELETE for `/v0/management/interactions-api-key`, validates credential weights up to `1,000,000`, accepts `weighted-round-robin`/`wrr`, excludes non-positive weights under WRR, and owns the `gemini-interactions` executor with default `Api-Revision: 2026-05-20`

| Upstream dependency | Classification | Current LTS decision |
|---|---|---|
| `e95cc2b621e3b5836091a03c9b6be22aacdbd8cb`, `c595ada`, `3dc365f` | `adapt-port` | Adapt the Antigravity `retrieveUserQuotaSummary` group/bucket payload, project discovery, server clock offset, current `antigravity/cli/1.0.13` identity, and best-effort `loadCodeAssist` plan lookup into the existing LTS quota host. Do not migrate the replacement quota shell, timeline, global relative-time framework, or soonest-recovery sorting. |
| `8faaa395346624258408b442a5d4923f3b0e1fc8`, `90971e8f6a573e800dc8909c350285bf2f1c2396` | `adapt-port` | Add `weighted-round-robin` to the existing visual Config editor and round-trip integer `weight` across provider keys, OpenAI key entries, configured multi-protocol groups, and the existing auth-file fields modal. Omitted weight remains Core default `1`; values at or below `0` retain Core exclusion semantics. No new routing abstraction or replacement AuthFiles UI is introduced. |
| `530b585bd0b72448bc576e970b0f2c6f1f55df11` | `adapt-port` | Add commercial-neutral Interactions API management to the existing Workbench: config normalization, unknown-field-preserving CRUD, Gemini model discovery, `/v1beta/interactions` connectivity payload, `Api-Revision`, `gemini-interactions` usage mapping, dashboard count, and four locales. No registration link, affiliate metadata, sponsor placement, or quick-start route is accepted. |
| `3738c0b` | `reject` | The paid xAI fallback performs a POST health request to `/v1/chat/completions`. LTS quota reads must not create a potentially billable probe merely to label an account; the existing read-only billing/control-plane flow remains. |
| `ea107fd`, `0272e9b`, `001e130`, `afee40e` and the replacement Config/Quota shells | `defer` | Timeline, global relative-time, soonest sort, urgency decoration, and whole-shell migration are separate product/architecture changes with no correctness dependency for these contract ports. |

Existing commercial-neutral rejections remain in force: commercial API-key referral integrations, APIMart and its assets, BestProxy referrals, provider registration links, affiliate fields, sponsor recommendations, and commercial roster-driven hiding do not enter LTS. Cursor quota and other open provider proposals remain deferred until their own Core/data contracts and product decisions are independently proven.

This reassessment deliberately adds no dependency, no release workflow, no tag, no deployment, and no broad test framework. The implementation passed the focused quota/auth-files/providers/dashboard suites, `npm run validate:lts`, and `npm run smoke:lts`. Real-Core validation used an exact detached worktree at Core `dd465fb4002fc2846544f0dbcda879e1411792b8d`: the full write phase proved auth-file weight persistence, and the final `--no-write-smoke` browser run proved WRR visual save/reload plus Interactions create/update/readback/delete and weight round-trip. One intermediate retry encountered the pre-existing plugin config PATCH readback flake after that same plugin check had already passed; no product or expected-value change was made for it. These checks do not claim a release, deployment, paid upstream probe, live Antigravity account acceptance, or business UAT.

## Official Grok billing identity maintenance (2026-08-13)

This maintenance item is based on the public `xai-org/grok-build` source at `e5fd4816d43260c15ba785f103990c1ed6cea230` (Grok Shell `1.0.3`), not on a Management Center upstream commit. Its `x.ai/billing` handler still calls `GET /billing?format=credits` and sends the OAuth bearer placeholder, `X-XAI-Token-Auth: xai-grok-cli`, the auth-file user ID, the Grok Shell version, and `x-grok-client-mode: interactive`; the interactive Pager startup identity makes the shared client render `grok-pager/1.0.3 grok-shell/1.0.3 (macos; aarch64)` on the matching local platform.

The LTS adaptation updates the existing billing request identity, including Grok's `aarch64` / `x86_64` wire labels, obtains the real billing `user_id` from Core's curated auth-file response or the official read-only `/user` fallback, and parses current credits supplements (`prepaidBalance`, unified billing, subscription tier, on-demand state, history count, and the read-only `/auto-topup-rule`). An authoritative empty rule means disabled; transport, non-2xx, or malformed rule responses preserve the last successful auto-top-up state. It preserves the weekly/monthly merge and full usage statistics, and does not port Management Center's paid-account `/v1/me` or `/v1/chat/completions` health probes, add a paid request, mutate auto-top-up, or publish a release. The companion Core contract now persists the `/user` result separately from OIDC `sub` and exposes only that non-secret `user_id` through `/v0/management/auth-files`; enrichment failure remains backward compatible and never treats `sub` as a billing ID.


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
5. Create an annotated `v*-tls-*` tag. Its subject is the user-facing summary and its body must contain exactly one `Companion-Core: v*-tls-*` line. Do not use a lightweight tag, a placeholder summary, or release-time proximity as a compatibility signal.
6. Push only the exact intended tag, for example `v1-tls-0.0.3`.
7. Confirm `.github/workflows/release.yml` wrote the Release body via `scripts/generate-lts-release-notes.sh` and that the GitHub release contains `management.html`.
8. Read the published notes and confirm they show the tag summary, explicitly declared companion Core release, and `management.html` asset — not a raw commit dump.
9. A manual dispatch for an existing Release preserves its title and body by default. Enable `rewrite_release_notes` only when replacing those fields is intentional.
