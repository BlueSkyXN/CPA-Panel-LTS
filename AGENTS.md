# CPA-Panel-LTS agent instructions

## Purpose

`CPA-Panel-LTS` 是 `CPA-Core-LTS` 的长期维护 Web 管理面板。它保护完整 usage statistics，通过 selective-port 吸收上游修复，并以单文件 `management.html` 交付给 Core。

## Repository identity

- LTS repository: `BlueSkyXN/CPA-Panel-LTS`
- Upstream: `router-for-me/Cli-Proxy-API-Management-Center`
- Panel baseline: `v1.8.4` / `8ed837c3d734c3970a6d6799c557bb6a6753360d`
- Companion Core: `BlueSkyXN/CPA-Core-LTS`
- Core baseline: `CLIProxyAPI v6.9.49` / `b8bba053fcdafd80abc2152c88c78f4e7713c05a`
- `main` 是唯一 LTS 主线；不创建长期“保留统计”分支。

## Codex startup behavior

- 从仓库根目录启动时，本文件是 repo-local 启动期 router。
- 子目录 `AGENTS.md` 是按需 navigation card；修改对应目录前必须先读取。
- 若目标路径上有多层 `AGENTS.md`，从浅到深读取，冲突时以更近的规则为准。
- 不创建/修改 `AGENTS.override.md`，除非用户明确要求。

## Directory map

| Path | Responsibility | Local AGENTS.md | Read when |
|---|---|---:|---|
| `AGENTS.md` | 根 router、LTS 不变量、命令与验证入口 | This file | 每次从仓库根开始任务时 |
| `.codex/` | 本机 Codex 配置 symlink | No | 非仓库交付物；仅按用户明确要求处理 |
| `README.md`, `README_CN.md` | 对外介绍、开发和 release 说明 | No | 修改公开说明、quick start、release notes 前 |
| `docs/` | 仓库文档 | No | 修改普通文档前 |
| `docs/lts/` | feature contract、protected delta、selective-port runbook | Yes | 修改任一 LTS contract 或同步规则前 |
| `local/` | 未跟踪的本地证据和临时材料 | No | 可读取；不要当作源码或 release truth |
| `package.json`, `package-lock.json` | npm scripts、依赖与锁文件 | No | 改依赖、scripts 或安装链前 |
| `vite.config.ts` | single-file build、版本注入、alias、SCSS module | No | 改构建输出、asset inline、`__APP_VERSION__` 或 alias 前 |
| `.github/workflows/` | LTS contract CI 与 Panel release | Yes | 改 workflow、permissions、tag trigger 或 asset 前 |
| `scripts/` | contract checks、browser smokes、userscripts | Yes | 改检查脚本、smoke 或 userscript 前 |
| `src/main.tsx`, `src/App.tsx`, `src/router/`, `src/pages/` | app bootstrap、routes、page composition | No | 改入口、路由、guard 或页面挂载前 |
| `src/components/config/` | source/visual config editors、diff 与安全提示 | Yes | 改 `/config.yaml` 编辑、visual schema 或 save flow 前 |
| `src/components/usage/` | 完整 usage statistics UI | Yes | 改 usage charts、events、prices、import/export 前 |
| `src/components/quota/` | quota loaders、cards 与 provider quota config | No | 改 quota 加载、解析、刷新或展示前；Codex 专有逻辑另读 `src/lts/AGENTS.md` |
| `src/components/providers/` | 稳定 provider 页面、status bar、recent requests | No | 改 provider status 或 usage-dependent 展示前 |
| `src/components/modelAlias/` | OAuth model alias diagram/editor | No | 改 alias graph、fork、context menu 或 modal 前 |
| `src/components/ui/`, `src/components/common/`, `src/components/layout/` | shared UI primitives 与 layout | No | 改公共 props、navigation 或 design primitive 前 |
| `src/features/authFiles/` | auth-file CRUD、OAuth rules、quota/status cache | Yes | 改凭据操作、OAuth excluded/model alias 或 cache 前 |
| `src/features/providers/` | provider workbench、discovery、connectivity、mutation recovery | Yes | 改 workbench、adapter、provider form 或 test flow 前 |
| `src/features/plugins/` | capability-gated plugin management/store/resources | Yes | 改 plugin route、gate、install、polling 或 resource descriptor 前 |
| `src/features/dashboard/` | dashboard metrics and visualization | No | 改 dashboard aggregation 或 cards 前 |
| `src/services/api/` | browser-side Management API clients and transforms | Yes | 改 endpoint、auth header、transform 或 API error semantics 前 |
| `src/services/storage/` | management connection data 的浏览器存储封装 | Yes | 改 storage format、migration 或敏感数据持久化前 |
| `src/i18n/` | i18next bootstrap 与四套 shared locale | Yes | 新增/修改用户文案、locale key 或语言初始化前 |
| `src/lts/` | LTS-owned Codex sidecars 与 locale overlays | Yes | 改 Codex quota、remote cloud connect 或 `*.lts.json` 前 |
| `src/hooks/`, `src/stores/` | shared hooks 与 Zustand state | No | 改跨页面状态、连接生命周期、缓存或 draft 前 |
| `src/types/`, `src/utils/` | API/domain contracts、formatting、aggregation、parsers | No | 改 schema、usage/quota semantics 或共享算法前 |
| `src/styles/`, `src/assets/` | themes、SCSS primitives、logos/icons | No | 改全局 token、layout primitive 或品牌资产前 |
| `dist/` | Vite generated build output | No | 不手改；由 `npm run build` 生成 |
| `node_modules/` | installed dependencies | No | 不作为源码修改或 review |

## On-demand cat protocol

修改 `Local AGENTS.md = Yes` 的路径前，读取对应卡片；跨边界修改要读取所有直接相关卡片：

```bash
cat .github/workflows/AGENTS.md
cat docs/lts/AGENTS.md
cat scripts/AGENTS.md
cat src/components/config/AGENTS.md
cat src/components/usage/AGENTS.md
cat src/features/authFiles/AGENTS.md
cat src/features/providers/AGENTS.md
cat src/features/plugins/AGENTS.md
cat src/services/api/AGENTS.md
cat src/services/storage/AGENTS.md
cat src/i18n/AGENTS.md
cat src/lts/AGENTS.md
```

## LTS invariants

完整 usage statistics 是本仓库存在的原因。除非用户明确改变 LTS 产品方向，以下链路必须保留：

- `/usage` in `src/router/MainRoutes.tsx`
- `src/pages/UsagePage.tsx` and `src/pages/UsagePage.module.scss`
- `src/components/usage/`
- `src/services/api/usage.ts`
- `src/stores/useUsageStatsStore.ts`
- `src/types/usage.ts`
- `src/utils/usage.ts`, `src/utils/usageIndex.ts`, and `src/utils/usage/`
- usage import/export、charts、token breakdown、request events、model/API/credential breakdown、local pricing
- 依赖完整 usage details 的 provider status surfaces

上游边界已确认：`v1.9.3` 仍保留完整 usage；本仓以 `v1.8.4` 为基线；`b25f722` 开始将 provider usage 转向 recent requests；`632be0b` 大规模删除完整 usage UI/store/API/utils。Panel 因此采用 **protected selective-port**，不是 Core 所用的 protected full-sync。

处理上游变更时：

1. 先读 upstream diff 与 `docs/lts/sync-runbook.md`、`panel-protected-deltas.yaml`。
2. 检查 route、usage store/API/utils、provider status、auth-file stats、quota、locale 与 release workflow 的影响。
3. 选择 cherry-pick、manual port 或 rejection；不得盲用 GitHub `Sync fork`。
4. 保留 LTS protected surface，再适配兼容部分。
5. port 完成前运行 `npm run check:lts`；广泛变更运行 `npm run validate:lts`。

Contract truth 必须保持一致：

- `docs/lts/panel-feature-contracts.yaml` 记录 `protected`、`lts-maintained`、`shared`、`coexist`、`experimental` surface。
- `scripts/check-lts-panel-contract.sh` 与 `scripts/check-panel-feature-contracts.mjs` 执行文件、route、API、locale、release、plugin、sidecar 等 marker guard。
- 新增或移除 protected/coexist LTS surface 时，同一变更中同步 registry 与 guard；若用户只授权调查，明确报告未落盘项。

当前关键边界：

- `full-usage-statistics` 不得被 recent-request/API-key summaries 取代。
- `provider-workbench` 和 `recent-requests` 可以 coexist，但不能替换稳定 provider 页面或完整 usage。
- `plugin-management` 必须由 Core capability gate 控制，包括 `x-cpa-support-plugin`、`pluginSupportKnown` 与 `RequirePluginSupport`。
- `codex-abnormal-reasoning-retry-config` 涉及 `visualConfig` types/hooks/editor、四套 shared locale、smoke markers 与 feature contract；Core schema 改变时一起核对。
- `src/lts/codexQuota/`、`codexRemoteCloudConnect/` 和 `i18n/*.lts.json` 是 LTS sidecars；shared pages 保持 thin integration surface。

## CPA-Core-LTS contract

- Core owns proxying、auth、Management API 与 usage collection；Panel 只通过浏览器端 `/v0/management` 管理。
- Core 需继续提供 `/usage`、`/usage/export`、`/usage/import` 等 Management API；Panel types/transforms 必须匹配当前 Core 或 live endpoint。
- Panel release asset 必须精确命名为 `management.html`，Core updater 依赖该名称。
- Core schema 变更时，检查 Panel API client、types、stores、pages、quota/auth-file 与 provider status；Panel schema expectation 变更时反向核对 Core。
- 构建通过只证明本地编译，不证明 Core compatibility、release、deployment 或 live acceptance。

## Commands

命令来源为当前 `package.json`、workflow 与仓库脚本。仓库使用 npm 和 `package-lock.json`；CI 使用 Node.js 20。

| Command | Purpose | Scope | Sandbox notes |
|---|---|---|---|
| `npm install` | 本地 quick start 安装/更新依赖与 lockfile | repo | README 的交互开发入口；需要 npm registry/network，可能改 `package-lock.json` |
| `npm ci` | 按 lockfile 安装依赖 | repo | 缓存缺失时需要 npm registry/network；会重建 `node_modules/` |
| `npm run dev` | 启动 Vite dev server | local UI | 长驻进程；browser validation 时使用 |
| `npm run preview` | 服务已构建的 `dist/` | local UI | 先运行 build；长驻进程 |
| `npm run type-check` | `tsc --noEmit` | TS source | 默认 TypeScript 检查 |
| `npm run build` | `tsc && vite build`，生成 single-file `dist/index.html` | repo | UI/TS/release 变更的默认构建检查 |
| `npm run lint` | ESLint `ts,tsx` | repo | 不覆盖 userscript JavaScript |
| `npm run format` | Prettier 写入 `src/**/*.{ts,tsx,css,scss}` | `src/` | 会修改文件；仅在明确需要格式化时运行 |
| `npm run test:usage` | usage cache/prices/import/effort/tier/pricing tests | usage chain | Node test aggregator |
| `npm run test:providers` | xAI、provider integrity、recent requests tests | provider code | Node test aggregator |
| `npm run test:plugins` | plugin source/repository trust tests | plugin store | Node/Vite test |
| `npm run test:auth-files` | OAuth load guard 与 upstream quota-port tests | auth/quota | Node tests |
| `npm run test:dashboard` | dashboard metric tests | dashboard | Node test |
| `npm run test:config` | config API-key storage/security tests | config | Node test |
| `npm run test:api-client` | connection-generation/client semantics | API client | Node test |
| `npm run test:logs` | incremental log merge semantics | logs | Node test |
| `npm run test:quota` | upstream quota-port semantics | quota | Node test |
| `npm run check:feature-contract` | 校验 feature registry 的文件/route/API markers | LTS contract | 被 `check:lts` 包含 |
| `npm run check:lts` | Panel LTS contract guard | repo | 轻量结构门禁，不替代 browser/Core smoke |
| `npm run validate:lts` | 全部已配置 Node tests + contract + type-check + lint + build | repo | 默认广泛变更/port gate；可能耗时 |
| `npm run smoke:lts` | build + mock Core browser smoke | local browser | 需要 Python Playwright 与 Chromium |
| `npm run smoke:lts:core` | build + local sibling Core authenticated smoke | Panel + Core | 需要 Go、Core checkout、Python Playwright、Chromium 与 management credentials；可能写临时 smoke config |

没有通用 `npm test`；报告实际运行的 `test:*` 或 `validate:lts`。

## Validation standard

验证按变更风险选择最小充分集合，且区分 local check、mock smoke、real-Core smoke、GitHub CI/release 与 live deployment。

### AGENTS/docs only

1. 用 `git diff --check` 检查 whitespace。
2. 用 `git status --short` 与 `git diff --name-only` 确认只修改目标文档/`AGENTS.md`。
3. 内容若依赖命令、schema 或 workflow，回读真实配置；纯规则修改不要求 build。

### TypeScript/UI

1. 运行相关 `npm run test:*`（若存在）。
2. 运行 `npm run type-check` 与 `npm run build`。
3. 共享 components/hooks/stores/API clients、跨模块改动或广泛 refactor 再运行 `npm run lint`。
4. layout、navigation、chart、modal 或 responsive 行为变更时用 dev/preview 做 browser inspection；未运行要单独报告。

### Protected domains

- Usage: 先读 `src/components/usage/AGENTS.md`；运行 `test:usage`、`check:lts`、`type-check`、`build`。
- Config: 先读 `src/components/config/AGENTS.md`；运行 `test:config`、`type-check`、`build`；LTS/Core-owned schema 再加 `check:lts` 与相应 smoke。
- Providers: 先读 `src/features/providers/AGENTS.md`；运行 `test:providers`、`type-check`、`build`；mutation/discovery UI 需要 browser smoke 时说明依赖。
- Auth files/quota: 先读 `src/features/authFiles/AGENTS.md`；运行 `test:auth-files`（或 `test:quota`）、`type-check`、`build`；涉及 Codex sidecar 再读 `src/lts/AGENTS.md` 并跑 `check:lts`/smoke。
- API client: 先读 `src/services/api/AGENTS.md`；运行 `test:api-client`、`type-check`、`build`；Core-dependent semantics 必须核对当前 Core source 或 live endpoint。
- LTS contract/guard: 先读 `docs/lts/AGENTS.md` 与 `scripts/AGENTS.md`；运行 `check:lts`，广泛 marker/route/API 变更运行 `validate:lts`。
- Plugins: 先读 `src/features/plugins/AGENTS.md`；运行 `test:plugins`、`check:lts`、`type-check`、`build`、`smoke:lts`；只有本地 Core 具备支持和凭据时才运行 `smoke:lts:core -- --include-plugin-store`。
- LTS sidecars/locales: 读 `src/lts/AGENTS.md` 与 `src/i18n/AGENTS.md`；运行 `check:lts`、`type-check`、`build`，交互变更运行 `smoke:lts`。
- Release workflow: 读 `.github/workflows/AGENTS.md`；确认 build 产生 `dist/index.html` 且 workflow 发布 `dist/management.html`。Live Actions/release 需要 GitHub network/auth，不能由本地检查代替。
- Userscript: 读 `scripts/AGENTS.md`；app build/lint/type-check 不覆盖 userscript。未运行 Tampermonkey/browser smoke 时明确报告。

## Global rules

- 默认中文沟通；代码、命令、路径、API/配置键与专有名词保留英文。
- 使用 npm；依赖变更同步 `package.json` 与 `package-lock.json`，不引入第二种 package manager/lockfile。
- TypeScript strict；不要用宽泛 `any` 逃避外部数据解析，必要时缩小范围并说明数据边界。
- 优先复用现有 `@/` imports、API clients、stores、hooks、utilities 与 UI primitives。
- 用户可见文案进入 locale catalogs；shared key 同步 `en`、`zh-CN`、`zh-TW`、`ru`，LTS-only key 进入四套 `*.lts.json` overlay。
- SCSS module class names 必须兼容 `localsConvention: 'camelCase'`；UI 保持 desktop/mobile responsive，检查 overflow、overlap 与 navigation。
- Management API endpoint/schema/header 只能来自当前 Panel/Core source、schema 或 live readback；不要按类比编造。
- 现有测试凭据可用于用户授权的本地调试，但不得进入 commit、docs、logs、screenshots、fixtures 或 shareable artifacts。

## Do not

- 不删除或削弱完整 usage statistics chain。
- 不把 release asset 改离 `management.html`。
- 不把 userscript 或 `scripts/` 额外材料当作 Panel mainline 完成标准，除非用户明确点名。
- 不盲目 full-sync upstream；build pass 不是 LTS contract preservation 的证明。
- 不手改 `dist/` 或 `node_modules/`。
- 不新增无用户目的或无错误处理的隐藏 browser network call。
- 不记录 raw management keys、OAuth/access/refresh tokens、JWT、auth JSON 或可能含账户数据的 raw quota/usage payload。
- 不运行 release publishing、`gh release`、workflow dispatch、push exact tag 或 `git push --tags`，除非用户明确授权；release tag pattern 保持 `v*-tls-*`。

## Notes for future agents

- 本仓库是单一 Web UI，不是 proxy server；server-side fixes 通常属于 `CPA-Core-LTS`。
- Panel 通常由 API server 的 `/management.html` 提供，并调用 `/v0/management`；不要用 `file://dist/index.html` 代替 dev/preview browser validation。
- Quota/auth-file surfaces 共享 store、components 与 cache；底层模型改变时检查所有消费者。
- Provider status bar 依赖完整 usage aggregation；usage 变更时一并检查。
