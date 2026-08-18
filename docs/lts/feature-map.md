# CPA-Panel-LTS 功能地图

本文档是 [panel-feature-contracts.yaml](./panel-feature-contracts.yaml) 的人类可读视图。registry 仍是 feature 路由、文件、endpoint、marker 和验证命令的机器真相；本文档负责解释产品目的、保护理由、共存关系和维护边界。

## 总览

| Feature | 状态 | 主要入口 | 所有权与定位 |
|---|---|---|---|
| `full-usage-statistics` | `protected` | `/usage`、`/usage/pricing` | Panel LTS 的核心产品身份；依赖 Core 完整 usage API |
| `provider-stable-lts-page` | `protected` | `/ai-providers/legacy`、provider detail routes | 保留 usage-backed status 和 LTS provider；不能被 Workbench 替代 |
| `ampcode` | `lts-maintained` | `/ai-providers/legacy/ampcode` | 上游 Panel 已删除，Core LTS 仍提供配置和 Management API |
| `codex-abnormal-reasoning-retry-config` | `lts-maintained` | `/config` | Core LTS-owned runtime 策略的 visual config surface |
| `provider-workbench` | `coexist` | `/ai-providers` | canonical provider 管理工作台；与 stable LTS provider 页面共存 |
| `plugin-management` | `coexist` | `/plugins`、`/plugin-store` | 由 Core capability gate 控制的 plugin 管理和资源页面 |
| `recent-requests` | `coexist` | provider health surfaces | 短窗口运行健康证据；不能替代完整 usage |
| `dashboard-overview` | `shared` | `/`、`/dashboard` | 使用 config/auth/model/recent request 数据的概览面 |
| `logs-runtime` | `shared` | `/logs` | 同时兼容 file-log 和 Home DB runtime |
| `config-management` | `shared` | `/config` | source/visual 配置编辑，必须保留未托管 YAML 和并发变更 |
| `auth-files-management` | `shared` | `/auth-files`、`/oauth` | auth-file、OAuth exclusion/alias、状态与 LTS cloud sidecar |
| `quota-management` | `shared` | `/quota` | provider quota、Codex analytics/reset credits 和 LTS quota sidecar |

当前没有登记 `experimental` feature。源码中出现实验字段或 UI 片段，不等于已经成为 LTS feature contract。

## Protected：LTS 产品身份

### 完整 usage statistics

`full-usage-statistics` 是本仓库存在的首要原因。它保护：

- 完整 requests/tokens 图表和 hour/day trend。
- API、model、credential/source 维度 breakdown。
- request events、latency、reasoning、cache read/write、service-tier evidence 和逐事件本地费用估算。
- `/usage/export`、`/usage/import` 的 canonical v2 和可证明安全的 v1 migration。
- duplicate/overlap 检查、uncertain identity 披露和 invalid canonical token fail-closed。
- browser-local pricing profile、preset catalog、Fast/Std、long-context 和逐事件费用估算。
- aggregate/detail coverage reconciliation；缺失 detail、unmatched 或 unsupported 不得显示为完整覆盖或 `$0`。

Core 依赖至少包括：

- `GET /v0/management/usage`
- `GET /v0/management/usage/export`
- `POST /v0/management/usage/import`
- Core compatibility routes for `/v0/management/usage-statistics-enabled`；Panel 当前从整体 config 读取，并以 `PUT` 执行直接 mutation

`recent-requests` 和 `/v0/management/api-key-usage` 可以提供短窗口健康信息，但不能取代上述链路。完整行为见 [usage-statistics.md](./usage-statistics.md)。

### Stable provider LTS 页面

`provider-stable-lts-page` 保留历史稳定 provider 页面及其完整 usage-backed status bar：

- `/ai-providers/legacy` 是 stable provider 聚合入口。
- provider detail routes 继续覆盖 Gemini、Codex、Claude、Vertex、OpenAI compatibility 和 Ampcode。
- status 依赖完整 usage aggregation，不得改用 recent requests 作为唯一真相。
- upstream Workbench 可以作为 canonical 配置入口，但不能删除 stable 页面或其 LTS-only provider。

涉及 usage 聚合、provider status、source identity 或 credential mapping 的变更，要同时检查完整 usage 与 provider 消费面。

## LTS-maintained：下游特色能力

### Ampcode

上游 Panel 已移除 Ampcode，但 `CPA-Core-LTS` 仍支持其配置和 Management API，因此 Panel 继续维护：

- provider 页面、启用状态和 upstream URL/API key 编辑。
- model mappings 与 force model mappings。
- Dashboard/provider counts 中的 Ampcode 识别。

上游删除、导航重构或 provider 清单重写都不能作为删除 Ampcode 的依据。只有 Core contract 与 LTS 产品方向同时明确改变时，才可重新评估。

### Codex abnormal reasoning retry visual config

`codex.abnormal-reasoning-retry` 由 `CPA-Core-LTS` 运行时拥有，Panel 维护 `/config` 中的可视化编辑面。当前 feature contract 覆盖：

- `action`：retry、observe-only 或 disabled。
- 命中条件：model、reasoning effort、reasoning token、auth kind 和 auth id。
- stream buffer 和最大字节数。
- max retries 与 exhausted behavior。
- client usage aggregation。
- delivery policy 与 fallback policy。
- hedged retry、mode、delay 和 distinct-auth 要求。

Panel 只编辑 Core 已有 schema，不自行发明运行时语义。未知现有字段必须通过 source/advanced JSON 路径无损保留；Core schema 变化时同步检查 types、hook、visual editor、四套 locale、feature contract 和 smoke marker。

### Codex LTS sidecars

以下特色能力当前分别归入 `auth-files-management`、`quota-management` 或 protected delta，而不是单独的 feature id：

- `src/lts/codexQuota/`：Codex quota、daily workspace analytics、leaderboard、reset credits 和本地展示逻辑。
- `src/lts/codexRemoteCloudConnect/`：auth-file 页面中的 Codex remote cloud connect environment UI。
- `src/i18n/*.lts.json`：LTS-only locale overlay。

这些 sidecar 是本仓库的下游集成面。shared 页面应保持 thin integration，不应把 sidecar 逻辑散落回上游共享模块；上游 quota/auth-file 大改必须先比较 sidecar 行为再决定 port。

## Coexist：可演进但不能替代 protected 能力

### Provider Workbench

`/ai-providers` 是 canonical provider 管理工作台，`/ai-providers/workbench` 是兼容 redirect；它与 `/ai-providers/legacy` 共存。

必须保持的契约：

- provider mutation 使用 Core 返回的稳定 identity/source index，不按当前过滤后数组位置猜测。
- round-trip `display-name` 和 model mappings。
- Thinking editor 遵循 Core `ThinkingSupport` 的 `levels`、`min`、`max`、`zero_allowed`、`dynamic_allowed`。
- Codex client-only `ultra` compatibility preset 不得伪装为 provider wire capability。
- advanced JSON 对未知字段和未知 level 保持无损。
- xAI API-key 变更以 `api-key` 加 `base-url` 选择目标并保留未知 config 字段。
- branded provider group 只能由实际 config 检测得出，不加入推广、affiliate、注册入口或空状态推荐。

### Plugin management

Plugin 页面依赖 Core runtime capability，不是静态 always-on 功能：

- Core 通过 `X-CPA-SUPPORT-PLUGIN` header 和/或 probe 提供 capability evidence。
- Panel 必须等待 connection ready 且 `pluginSupportKnown` 后再决定 route。
- 配置中启用 plugin 不等于当前 Core binary 支持 plugin。
- capability 不支持但存在 plugin 配置时，应显示明确的 runtime unavailable 状态；不能绕过 gate 直接调用 endpoint。
- store install、version selection、auth、confirm token、config patch 和 enable/disable 使用 Core contract，不把未知状态当成功。

主要 Management API 包括 `/v0/management/plugins`、plugin config/enabled routes、`/v0/management/plugin-store` 和 install route。CGO/build capability、当前配置、远程 release source 和成功安装是不同事实层。

### Recent requests

`recent-requests` 用于短时间窗口的 provider health、最近请求状态和 Workbench 辅助信息。它应：

- 使用独立、连接感知的 cache，避免跨 `apiBase` 或 management key 污染。
- 将 load error 与真实零请求区分。
- 只作为实时健康补充，不改变 `/usage` 的聚合、导入导出、pricing 或历史分析职责。

## Shared：随 Core 兼容契约演进

### Dashboard overview

- provider counts 来自已加载 config，不丢失 Ampcode 等 LTS provider。
- model/auth/recent-request load failure 不得显示为已确认的零。
- visual rewrite 可以演进，但数据定义必须保持可解释且有回归检查。

### Logs runtime

- `/logs` 同时支持 CPA file-log 和 Home DB runtime。
- cursor、`latestAfter`、`nextCursor` 和 cursor reset 语义必须匹配当前 Core。
- error log/request log 的查看、复制和下载不能因 runtime 切换而丢失。

### Config management

- source mode 与 visual mode 使用同一 `/config.yaml` 真相。
- visual save 只修改明确 dirty 的受管字段。
- 未托管 YAML、`plugin_store_sources`、payload JSON 和并发产生的服务端变更必须保留。
- save/reload 的本地成功不等于 Core 已采用配置；必要时回读当前 config 或 runtime 行为。

### Auth files 与 OAuth

- 支持 auth-file list/upload/download/delete、status 和 fields/models。
- OAuth excluded-model 和 model-alias editor 必须先成功加载 baseline 才允许写，避免 load failure 覆盖服务端配置。
- mutation 后按实际影响失效 quota/status cache；未知字段不得因局部编辑丢失。
- Codex remote cloud connect 是 LTS sidecar；它依赖当前 Core/auth-file 能力，不是独立云服务保证。

### Quota management

- `/quota` 汇总多个 provider 的 quota、billing/analytics evidence，以及由用户显式触发的 reset-credit action。
- Codex analytics、leaderboard、reset credits 与 xAI/Grok quota 都通过 Core `/v0/management/api-call` 代理读取外部数据。
- cache generation、connection identity 和 refresh race 必须隔离；过期请求不能覆盖新连接数据。
- reset-credit consume 等有状态动作必须由用户明确触发并有确认/回读，不能混入普通 refresh。
- companion userscript 是辅助材料，不是 Panel mainline 完成标准。
- `scripts/codex-quota-monitor.py` 是可选的只读 CLI 摘要工具；它复用现有 Management API 和 `/api-call`，不证明 Panel UI、release 或 live deployment，输出不得包含 Management Key、access token 或 raw payload。

## 跨功能保护边界

### Management API

Panel 是 browser client，Core 才拥有服务端行为。变更 endpoint、header、schema、auth 或错误语义时，必须检查当前 `CPA-Core-LTS` source 或 live readback。不得用相似 endpoint 或旧历史样本推断当前契约。

### 单文件发布

- Vite build 生成 `dist/index.html`，release workflow 将资产发布为精确名称 `management.html`。
- Core updater 依赖 `management.html`；改名会破坏集成。
- 仓库使用 npm 和 `package-lock.json`，不得引入第二套 lockfile。
- release tag 保持 `v*-tls-*` guard。
- build pass 只证明本地构建，不证明 release 已发布、Core 已下载或 live `/management.html` 已更新。

### Locale 与可访问性

- shared 用户文案同步 `en`、`zh-CN`、`zh-TW`、`ru`。
- LTS-only 文案进入四套 `*.lts.json` overlay。
- route gate、状态 badge、tooltip 和 evidence 需要可访问 label；browser smoke 应按语义属性断言，不按页面任意文本计数。

## Feature 变更检查表

1. 在 registry 中确认 feature id 和状态。
2. 核对目标 route、source、Core endpoint/header/schema 与所有直接消费者。
3. 明确保留、替换、删除和 non-goal，尤其检查是否触及 protected 面。
4. 更新人类文档；如 marker、route、API 或 locale 改变，同时更新 registry 与 guard。
5. 运行 registry 中针对该 feature 的 targeted validation。
6. 跨模块或 protected 广泛变更再运行 `npm run validate:lts`。
7. 交互、layout、capability gate 或 runtime integration 变更运行相应 browser/Core smoke。
8. 分开报告 local source、CI、release、deployment 和 live acceptance。
