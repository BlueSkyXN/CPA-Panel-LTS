# AGENTS.md

本文件是 `CPA-Panel-LTS` 的 Codex root router。仓库内还有少量子目录 `AGENTS.md` 作为按需导航卡片；从仓库根目录启动 Codex 时，先遵守本文件，再按目录地图读取对应本地卡片。

## Purpose

`CPA-Panel-LTS` 是 `CPA-Core-LTS` 的长期维护管理面板。它不是上游 `router-for-me/Cli-Proxy-API-Management-Center` 的普通同步 fork，而是用于继续维护 Web 管理面板并保留完整使用统计 UI 的 LTS 分发仓库。

## Codex startup behavior

- Codex 通常从仓库根目录 `/Users/sky/Github/CPA-Panel-LTS` 启动，本文件是启动期主规则。
- 子目录 `AGENTS.md` 是按需导航卡片；修改带有本地卡片的目录前，必须先 `cat <path>/AGENTS.md`。
- 如果目标路径上存在多个本地 `AGENTS.md`，从浅到深依次读取，冲突时以更靠近目标文件的规则为准。
- 如果从子目录直接启动，Codex 可能自动加载路径链上的本地 `AGENTS.md`；仍以本文件的目录地图作为根启动 workflow 的 router。
- 当前没有 `AGENTS.override.md`。不要创建或修改 `AGENTS.override.md`，除非用户明确要求。

## Repository identity

- LTS 仓库：`https://github.com/BlueSkyXN/CPA-Panel-LTS`
- 上游来源：`https://github.com/router-for-me/Cli-Proxy-API-Management-Center`
- 面板基线版本：`v1.8.4`
- 面板基线提交：`8ed837c3d734c3970a6d6799c557bb6a6753360d`
- 配套核心仓库：`https://github.com/BlueSkyXN/CPA-Core-LTS`
- 核心基线版本：`CLIProxyAPI v6.9.49`
- 核心基线提交：`b8bba053fcdafd80abc2152c88c78f4e7713c05a`
- `main` 是唯一的 LTS 主线。不要为了“保留统计”再创建长期分支。

## Directory map

| Path | Responsibility | Local AGENTS.md | Read when |
|---|---|---:|---|
| `AGENTS.md` | 根启动规则、LTS 不变量、命令索引 | This file | 每次从仓库根目录开始任务时 |
| `README.md`, `README_CN.md` | 人类文档、LTS 背景、开发和发布说明 | No | 修改对外说明、quick start、release notes 前 |
| `docs/` | 仓库文档和 LTS contract/runbook | No | 修改文档索引、普通说明、非 LTS contract 文档前 |
| `docs/lts/` | LTS protected-delta registry、feature contracts、selective-port runbook | Yes | 修改 `panel-feature-contracts.yaml`、`panel-protected-deltas.yaml`、`sync-runbook.md` 前 |
| `local/` | 未跟踪本地证据、截图、release-candidate 和临时交付材料 | No | 读取材料可用；不要把它当作主线源码或发布 truth |
| `package.json`, `package-lock.json` | npm 依赖、scripts、锁定版本 | No | 新增依赖、改 scripts、改构建链前 |
| `vite.config.ts` | Vite single-file build、版本注入、alias、SCSS module 配置 | No | 改 build 输出、asset inline、`__APP_VERSION__`、`@/` alias 前 |
| `.github/workflows/` | GitHub Actions release workflow，发布 Panel `management.html` asset | Yes | 修改 workflow、tag trigger、release asset、GitHub permissions 前 |
| `scripts/` | 额外材料和维护/验证脚本；userscript 不属于 Panel 主线完成标准 | Yes | 修改 `codex-quota-compass.user.js`、metadata、ChatGPT quota 请求逻辑，或维护/验证脚本前 |
| `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/App.css` | React app 入口和全局样式入口 | No | 修改 app bootstrap、全局 CSS 注入、router 挂载前 |
| `src/router/` | route registration and protected routes | No | 修改路由、导航路径、`/usage`、auth guard 前 |
| `src/pages/` | 页面级 UI、页面状态和 page-level SCSS modules | No | 修改 Dashboard、Providers、AuthFiles、Quota、Usage、Config、Logs、System 页面前 |
| `src/components/usage/` | 完整 usage statistics UI 组件 | Yes | 修改 usage charts、token breakdown、events table、import/export、price settings 前 |
| `src/components/quota/` | quota cards、quota loader、quota config and rendering | No | 修改 Claude/Codex/Gemini/Antigravity/Kimi quota 展示或刷新逻辑前 |
| `src/components/providers/` | provider config sections、provider nav、status bar、provider stats | No | 修改 provider 表单、status bar、usage-dependent provider 展示前 |
| `src/components/config/` | visual/source config editor、diff modal、config sections | No | 修改 `/config.yaml` 编辑、save/reload、visual config blocks 前 |
| `src/components/modelAlias/` | OAuth model alias diagram/list editing UI | No | 修改 alias diagram、fork、context menu、modal 行为前 |
| `src/components/ui/` | 共享 UI primitives 和 icon wrappers | No | 修改 Button/Input/Modal/Select/Toggle 等公共组件 API 前 |
| `src/features/authFiles/` | auth file cards、OAuth excluded/model alias、auth-file quota/status cache | No | 修改凭据上传/删除、runtime-only 状态、OAuth excluded/model alias、auth-file quota 前 |
| `src/features/providers/` | provider workbench、model discovery、connectivity tests、recent-request health | No | 修改 `/ai-providers/workbench`、provider form/adapters/model discovery/recent request smoke 前 |
| `src/features/plugins/` | plugin management/store/resource pages，受 Core plugin capability gate 控制 | Yes | 修改 `/plugins`、`/plugin-store`、plugin resource pages、install gate、plugin polling/resource descriptors 前 |
| `src/hooks/` | 通用 React hooks | No | 修改 shared hook contract、interval、pagination、unsaved guard、API hook 前 |
| `src/i18n/` | i18next setup and active locale JSON (`en`, `zh-CN`, `zh-TW`, `ru`) | No | 新增或修改用户可见文案、语言切换、locale key 前 |
| `src/lts/` | LTS-owned sidecar/overlay code：Codex quota、Codex remote cloud connect、LTS locale overlays | Yes | 修改 `codexQuota`、`codexRemoteCloudConnect`、`i18n/*.lts.json` 或 LTS-only integration 前 |
| `src/services/api/` | browser-side Management API clients and transformers | No | 修改 `/v0/management` endpoint、request/response transform、auth header、usage/quota/oauth clients 前 |
| `src/services/storage/` | browser local storage abstraction | No | 修改 management key 或敏感本地存储前 |
| `src/stores/` | Zustand stores for auth/config/models/usage/quota/theme/drafts | No | 修改跨页面缓存、load state、draft state、usage/quota store 前 |
| `src/styles/` | SCSS variables、themes、mixins、layout/global styles | No | 修改 global design tokens、theme variables、layout primitives 前 |
| `src/types/` | TypeScript contracts for API/domain data | No | 修改 Management API schema、usage/quota/auth/provider types 前 |
| `src/utils/` | shared formatting、usage/quota aggregation、source resolving、validation helpers | No | 修改聚合、索引、格式化、quota parser/resolver 前 |
| `src/assets/` | logos and provider icons | No | 替换 icon/logo 资产前 |
| `dist/` | build output, generated by Vite | No | 不要手动修改；由 `npm run build` 生成 |
| `node_modules/` | installed dependencies | No | 不要手动修改或审查为源码 |

## On-demand cat protocol

Before editing files under a directory that has `Local AGENTS.md = Yes`, read that file first:

```bash
cat .github/workflows/AGENTS.md
cat docs/lts/AGENTS.md
cat scripts/AGENTS.md
cat src/features/plugins/AGENTS.md
cat src/lts/AGENTS.md
cat src/components/usage/AGENTS.md
```

Read only the cards that are on the path or directly relevant to the change. Do not create extra local cards for pure organization directories unless there is a real invariant, high-risk boundary, or directory-specific validation that is not already covered here.

## LTS invariants

Full usage statistics are the reason this LTS panel exists. Preserve this data path unless the user explicitly asks for a different LTS direction.

Must keep:

- `/usage` route in `src/router/MainRoutes.tsx`
- `src/pages/UsagePage.tsx`
- `src/pages/UsagePage.module.scss`
- `src/components/usage/`
- `src/services/api/usage.ts`
- `src/stores/useUsageStatsStore.ts`
- `src/types/usage.ts`
- `src/utils/usage.ts`
- `src/utils/usageIndex.ts`
- usage import/export
- usage charts, token breakdown, request events table, model/API/credential breakdown, local model price settings
- provider status bar displays that depend on complete usage details

Do not directly merge or re-create the upstream direction that replaces complete usage statistics with only recent requests or API-key summaries.

Confirmed upstream removal boundary:

- `v1.9.3` still retains the complete usage implementation.
- `v1.8.4` is the baseline used by this repository and the last tagged panel version before the removal path.
- `b25f722` starts switching provider usage tracking to recent requests.
- `632be0b` removes the full usage UI, store, API client, and usage utilities at large scale.

Panel maintenance mode is protected selective-port, not protected full-sync. `CPA-Core-LTS` can full-sync because its protected delta is small and localized; this Panel cannot, because upstream deletes the protected usage UI itself. Port compatible upstream fixes deliberately, and reject or adapt changes that weaken complete usage statistics.

When following upstream:

- Do not use GitHub `Sync fork` blindly.
- Read upstream diffs first, then choose cherry-pick, manual port, or rejection.
- Before merging an upstream change, check whether it touches usage routes, usage store, usage API client, provider status bar, auth-file stats, quota display, or release workflow.
- If an upstream change removes or weakens full statistics, preserve the LTS implementation first and port only unrelated compatible pieces.
- Lightweight cleanup may remove promotional copy, sponsorship text, unused pages, unused providers, or non-target release machinery, but must not remove code still needed by the Core/Panel statistics contract.
- Run `npm run check:lts` before opening or merging upstream-port PRs.
- For detailed upstream handling rules, read `docs/lts/sync-runbook.md` and `docs/lts/panel-protected-deltas.yaml`.

Contract truth lives in two places and should stay aligned:

- `docs/lts/panel-feature-contracts.yaml` documents protected, LTS-maintained, shared, coexist, and experimental feature surfaces.
- `scripts/check-lts-panel-contract.sh` enforces sentinel files, required markers, locale overlay coverage, lockfile policy, release asset contract, plugin support markers, and LTS sidecar markers.

When adding or removing a protected/coexist LTS surface, update both the feature contract and the guard script in the same change unless the user explicitly scopes a partial investigation.

Important current feature boundaries:

- `full-usage-statistics` is protected and must not be replaced by recent-request summaries.
- `provider-workbench` and `recent-requests` may coexist, but must not replace the stable LTS provider page or full usage statistics.
- `plugin-management` is capability-gated by Core support, including `x-cpa-support-plugin`, `pluginSupportKnown`, and `RequirePluginSupport`.
- `codex-abnormal-reasoning-retry-config` is a downstream Core LTS visual config surface. Keep `src/types/visualConfig.ts`, `src/hooks/useVisualConfig.ts`, `src/components/config/VisualConfigEditor.tsx`, all active locale catalogs, smoke markers, and the feature contract aligned when Core changes `codex.abnormal-reasoning-retry`.
- `src/lts/codexQuota/` and `src/lts/codexRemoteCloudConnect/` are LTS-owned sidecars; shared pages should keep thin integration points.
- `src/lts/i18n/*.lts.json` are runtime overlay locale catalogs. Keep all active locales aligned when adding LTS-only text.

## CPA-Core-LTS contract

`CPA-Core-LTS` is the server core. It owns proxying, auth, Management API, and usage data collection.

`CPA-Panel-LTS` is the browser management panel. It reads the Core `/v0/management` API to show and edit config, credentials, logs, quota, and full usage statistics.

Maintain these contracts:

- Core must continue to provide usage Management API endpoints such as `/usage`, `/usage/export`, and `/usage/import`.
- Panel must remain compatible with Core usage response structures.
- Panel latest release must include an asset named exactly `management.html`; Core downloads this asset by default.
- If Core changes usage/quota/auth-file schema, inspect Panel types, API clients, stores, pages, and provider status bar before claiming compatibility.
- If Panel changes usage UI or schema expectations, verify Core still exposes the corresponding endpoint and field semantics.

## Commands

All commands below are confirmed from `package.json`, `.github/workflows/release.yml`, or repository docs.

| Command | Purpose | Scope | Sandbox notes |
|---|---|---|---|
| `npm ci` | Install exact dependencies from `package-lock.json` | repo | Requires npm registry/network if dependencies are not already cached |
| `npm run dev` | Start Vite dev server | local browser/dev | Long-running server; use when browser validation is needed |
| `npm run build` | Run `tsc && vite build` and generate single-file `dist/index.html` | repo | Default build validation for UI/TS/release-affecting changes |
| `npm run preview` | Serve built `dist/` output locally | local browser/dev | Requires `npm run build` first; long-running server |
| `npm run lint` | Run ESLint on `ts,tsx` files | repo | Does not validate `scripts/*.js` userscripts |
| `npm run type-check` | Run `tsc --noEmit` | repo | Good first validation for TypeScript-only changes |
| `npm run format` | Run Prettier over `src/**/*.{ts,tsx,css,scss}` | `src/` only | Writes files; use only when formatting source changes is intended |
| `npm run check:feature-contract` | Run `scripts/check-panel-feature-contracts.mjs` against `docs/lts/panel-feature-contracts.yaml` | repo | Feature file/route/API marker guard; included by `npm run check:lts` |
| `npm run check:lts` | Run the Panel LTS contract guard, including feature contract, sentinel paths, release asset contract, provider/plugin/recent-request/visual-config markers, and npm lockfile policy | repo | Lightweight guard; does not replace browser or Core compatibility smoke |
| `npm run validate:lts` | Run `check:lts`, `type-check`, `lint`, and `build` in sequence | repo | Default post-port validation for shared code or upstream-port batches |
| `npm run smoke:lts` | Build and run optional Python Playwright browser smoke against a mock Core API | local browser/dev | Requires Python Playwright and Chromium; not part of default CI gate |
| `npm run smoke:lts:core` | Build and run optional authenticated smoke against a local sibling `CPA-Core-LTS` process, including safe writes to the temporary smoke config | local browser/dev + Core checkout | Requires Go, `/Users/sky/Github/CPA-Core-LTS`, Python Playwright, and Chromium; plugin-store is skipped unless `-- --include-plugin-store` is passed; use `-- --no-write-smoke` to skip temp config/provider writes |
| `scripts/check-lts-panel-contract.sh` | Underlying shell implementation for `npm run check:lts` | repo | Prefer npm script in docs and handoffs unless debugging the shell script itself |

There is no configured `npm test` script in this repository. Do not claim tests passed unless a real test command is added or provided by the user.

## Validation standard

For documentation-only or AGENTS-only changes:

1. Verify only intended `AGENTS.md` or docs files changed.
2. No build is required unless the content change depends on generated output.

For TypeScript or UI changes:

1. Run `npm run type-check`.
2. Run `npm run build`.
3. Run `npm run lint` when touching shared components, hooks, stores, API clients, or broad refactors.
4. For visual/layout changes, start `npm run dev` or `npm run preview` and inspect in a browser when feasible.

For visual config schema changes:

1. Inspect `src/types/visualConfig.ts`, `src/hooks/useVisualConfig.ts`, `src/components/config/VisualConfigEditor.tsx`, `src/components/config/VisualConfigEditorBlocks.tsx`, and all active locale JSON files.
2. If the change is an LTS/Core-owned config surface such as `codex.abnormal-reasoning-retry`, keep `docs/lts/panel-feature-contracts.yaml` and `scripts/check-lts-panel-contract.sh` aligned in the same change.
3. Run `npm run check:lts`.
4. Run `npm run type-check`.
5. Run `npm run build`.
6. Run `npm run smoke:lts` or `npm run smoke:lts:core` when behavior depends on browser write flows or current `CPA-Core-LTS` config parsing; report skipped browser/Core validation separately.

For usage statistics changes:

1. Read `src/components/usage/AGENTS.md`.
2. Read `docs/lts/AGENTS.md` if the protected feature registry or guard markers need to change.
3. Run `npm run check:lts`.
4. Run `npm run type-check`.
5. Run `npm run build`.
6. Inspect `src/router/MainRoutes.tsx`, `src/pages/UsagePage.tsx`, `src/services/api/usage.ts`, `src/stores/useUsageStatsStore.ts`, `src/types/usage.ts`, `src/utils/usage.ts`, and `src/utils/usageIndex.ts` for contract drift.
7. If the change depends on Core behavior, verify against current `CPA-Core-LTS` Management API code or live endpoint; do not infer fields from memory.

For LTS contract or guard changes:

1. Read `docs/lts/AGENTS.md`.
2. Read `scripts/AGENTS.md` when changing `scripts/check-lts-panel-contract.sh`, `scripts/check-panel-feature-contracts.mjs`, or smoke scripts.
3. Keep `docs/lts/panel-feature-contracts.yaml` and `scripts/check-lts-panel-contract.sh` aligned.
4. Run `npm run check:lts`.
5. Run `npm run validate:lts` for broad protected-surface, route, API, or smoke marker changes.

For LTS sidecar changes under `src/lts/`:

1. Read `src/lts/AGENTS.md`.
2. Run `npm run check:lts`.
3. Run `npm run type-check`.
4. Run `npm run build`.
5. Run `npm run smoke:lts` when touching Codex quota rendering, reset-credit behavior, remote cloud connect UI, auth-file quota cards, or locale overlays; report if Playwright/Chromium is unavailable.

For plugin management changes:

1. Read `src/features/plugins/AGENTS.md`.
2. Run `npm run check:lts`.
3. Run `npm run type-check`.
4. Run `npm run build`.
5. Run `npm run smoke:lts` for route, gate, install modal, store-source, or plugin resource changes.
6. Use `npm run smoke:lts:core -- --include-plugin-store` only when local `CPA-Core-LTS`, management credentials, and plugin-store support are available; report skipped real-Core validation separately.

For release workflow changes:

1. Read `.github/workflows/AGENTS.md`.
2. Confirm `npm run build` still produces `dist/index.html`.
3. Confirm the workflow still publishes `dist/management.html`.
4. Live workflow or GitHub release validation requires GitHub network/auth and should be reported separately.

For userscript changes:

1. Read `scripts/AGENTS.md`.
2. There is no package script that fully validates `scripts/codex-quota-compass.user.js`.
3. Do not treat `npm run build`, `npm run lint`, or `npm run type-check` as userscript validation unless the build config is changed to include it.
4. If no browser/Tampermonkey smoke test was run, say so in the final report.

## Global rules

- Package manager is npm. Use `package-lock.json`; do not introduce pnpm, yarn, bun, or a second lockfile.
- Communicate with the user in Chinese by default; keep code, commands, file paths, API names, and proper nouns in English.
- Prefer `npm ci` for repeatable install in automation. README still mentions `npm install` for casual local quick start.
- React app code is TypeScript with strict compiler settings. Avoid `any` as a default escape hatch; if unavoidable, keep it narrow and justified by external data shape.
- Import application modules through the existing `@/` alias when that matches local style.
- Reuse existing API clients, stores, hooks, utilities, and UI primitives before adding new abstractions.
- User-visible text belongs in locale JSON under `src/i18n/locales/`. When adding text, update all active locale files (`en`, `zh-CN`, `zh-TW`, `ru`) or clearly report any missing translation.
- Keep SCSS module class names compatible with `localsConvention: 'camelCase'`.
- Browser-side Management API semantics must come from current `CPA-Core-LTS` implementation, current Panel code, or a live endpoint. Do not invent fields or endpoints by analogy.
- Keep secrets out of docs, logs, screenshots, release notes, and userscript metadata. Do not hardcode management keys, API keys, OAuth access tokens, refresh tokens, or JWTs in committed files.
- It is acceptable to use user-provided test credentials for local debugging when the user asks, but remove them before writing docs, committing, publishing, or producing shareable artifacts.
- UI work should preserve responsive behavior for desktop and mobile management screens. Check for text overflow, incoherent overlap, and broken navigation after layout changes.

## Do not

- Do not delete or weaken the full usage statistics page and data chain listed in this file.
- Do not rename the release asset away from `management.html`.
- Do not treat userscript or other `scripts/` extra materials as Panel mainline completion criteria unless the user explicitly scopes that work in.
- Do not broaden release tag publishing casually; panel releases use `v*-tls-*`, for example `v1-tls-0.0.1`.
- Do not run `git push --tags` after upstream tracking work; push only the exact intended panel release tag when releasing.
- Do not execute release publishing, `gh release`, or workflow dispatch unless the user explicitly asks for release work.
- Do not edit `dist/` by hand; change source/config and rebuild.
- Do not add hidden network calls from the browser UI without clear user-facing purpose and error handling.
- Do not log raw Management API credentials, OAuth tokens, ChatGPT access tokens, or raw quota/usage responses that may contain sensitive account data.
- Do not assume upstream changes are safe just because they build; compare them against the LTS usage contract.

## Notes for future agents

- This repository is a single Web UI, not the proxy server. Server-side fixes usually belong in `CPA-Core-LTS`.
- The panel is expected to work from `/management.html` on the API server port and talk to `/v0/management`.
- Opening `dist/index.html` directly via `file://` can hit browser CORS limits; use `npm run preview` or a dev server for browser checks.
- Quota and auth-file status surfaces often share data through `src/stores/useQuotaStore.ts`, `src/components/quota/`, and `src/features/authFiles/`; avoid fixing only one display if the underlying data model changed.
- Provider status bar depends on complete usage details through `src/utils/usage.ts` and `src/utils/usageIndex.ts`; usage changes can affect provider pages even when `src/components/providers/` was not edited.
