# CPA-Panel-LTS 文档导航

本目录维护 `CPA-Panel-LTS` 的长期维护契约。它面向维护者、开发者和排障人员，说明哪些能力构成本仓库的产品身份、哪些能力由 LTS 独立维护、哪些上游能力可以共存，以及变更应如何验证。

`CPA-Panel-LTS` 不是普通的上游镜像。它采用 **protected selective-port**：选择性吸收上游修复，同时保护完整 usage statistics、`CPA-Core-LTS` Management API 兼容、LTS sidecar 和 `management.html` 发布契约。

## 从哪里开始

| 目标 | 文档 | 作用 |
|---|---|---|
| 了解仓库有哪些功能、哪些不能退化 | [feature-map.md](./feature-map.md) | 人类可读的完整功能地图和维护边界 |
| 理解完整 usage、计价、导入导出和 `Fast → Std` | [usage-statistics.md](./usage-statistics.md) | protected usage 行为契约与排障说明 |
| 检查机器可执行的 feature marker | [panel-feature-contracts.yaml](./panel-feature-contracts.yaml) | 路由、文件、API、locale、marker 和验证命令的 canonical registry |
| 检查最小不可删除面 | [panel-protected-deltas.yaml](./panel-protected-deltas.yaml) | 完整 usage、Core 兼容、发布资产和本地定制的 protected delta |
| 评估和移植上游变更 | [sync-runbook.md](./sync-runbook.md) | selective-port 分类、历史 intake 决策和发布边界 |
| 快速安装、构建和使用 | [README_CN.md](../../README_CN.md) | 面向使用者的仓库入口 |

## 状态定义

状态的 canonical 定义位于 [panel-feature-contracts.yaml](./panel-feature-contracts.yaml)。本目录统一使用以下语义：

| 状态 | 含义 | 维护要求 |
|---|---|---|
| `protected` | LTS 产品身份的一部分 | 除非明确改变 LTS 产品方向，否则必须存在且保持功能完整 |
| `lts-maintained` | 上游已弃用或由下游独有，但 `CPA-Core-LTS` 仍支持 | 由 LTS 独立维护；上游删除不是删除理由 |
| `coexist` | 已接受的上游或新增产品面 | 可以演进，但不能替代或削弱 protected 能力 |
| `shared` | Panel 与 Core 共享的管理能力 | 随兼容契约演进，变更时同时核对 Core |
| `experimental` | 可选且依赖后端 capability 的能力 | 当前 registry 没有登记此状态的 feature；不得把未登记实验面写成稳定能力 |

当前 registry 共登记 12 个 feature：2 个 `protected`、2 个 `lts-maintained`、3 个 `coexist`、5 个 `shared`。完整清单见 [feature-map.md](./feature-map.md)。

## 文档与事实的分层

不同材料证明的事情不同，不能互相替代：

1. 当前 Panel/Core 源码或 live endpoint readback 证明实际实现和当前运行状态。
2. `panel-feature-contracts.yaml` 定义 feature 分类、受保护 marker 和验证入口。
3. `panel-protected-deltas.yaml` 定义 selective-port 不能越过的最小边界。
4. `feature-map.md` 和各专题文档解释行为、责任边界和排障方法。
5. `sync-runbook.md` 记录上游变更的接受、适配、延期或拒绝决策。

本地 `type-check`、测试和 build 只证明对应源码检查通过；它们不证明 GitHub CI、release asset、Core 部署、live runtime 或业务验收。文档中的运行时结论必须注明证据层级。

## 跨仓责任边界

- `CPA-Core-LTS` 负责代理执行、认证、Management API、usage collection、plugin capability 和运行时配置。
- `CPA-Panel-LTS` 负责浏览器管理界面、数据解析、交互、可视化、本地 pricing profile 和单文件交付。
- Panel 不应按类比发明 Core endpoint、字段或 header；必须来自当前 Core source、schema 或 live readback。
- Core schema 改变时，要检查 Panel 的 API client、types、stores、usage/quota/auth-file/provider 消费者。
- Panel schema expectation 改变时，要反向核对 Core export/import、Management response 和兼容版本。
- `management.html` 的源码、release、下载、部署和 live 提供是不同事实层；任何一层成功都不能自动证明下一层成功。

## 文档维护规则

任何 feature 行为变化至少回答以下问题：

1. 用户从哪个 route 或页面使用它？
2. 状态是 `protected`、`lts-maintained`、`coexist`、`shared` 还是 `experimental`？
3. Panel 与 Core 各自负责什么？依赖哪些 endpoint、header 或 schema？
4. 哪些行为必须保留，哪些行为明确不能由相邻功能替代？
5. 失败、未知、缺失和不支持状态如何显示，是否会 fail closed？
6. 需要运行哪些 targeted test、contract guard、build 或 browser/Core smoke？
7. 结论属于源码、CI、release、部署还是 live acceptance？

需要同步更新的材料：

| 变更类型 | 必须更新 |
|---|---|
| 新增或删除 feature、route、Core endpoint | 人类专题文档、`panel-feature-contracts.yaml`、对应 guard/test |
| 改变 protected 或 LTS-owned 行为 | 专题文档、feature registry、必要时 `panel-protected-deltas.yaml` |
| 接受或拒绝上游变更 | `sync-runbook.md`；如产品契约改变，再更新 feature 文档和 registry |
| 改变用户可见文案或 evidence | 四套 locale、交互文档和相应 smoke/test |
| 改变 release asset、tag、构建链 | release 文档、workflow contract、`panel-protected-deltas.yaml` 和 guard |
| 仅增加一次性调查证据 | 放入本地证据或 issue/PR，不把临时状态写成长期产品保证 |

## 全局不可回归项

- 不得用 recent requests 或 API-key summaries 替代完整 usage statistics。
- 不得删除 `/usage`、usage import/export、完整 breakdown、request events 或本地 pricing workspace。
- 不得让 Provider Workbench 替代 usage-backed stable provider 页面。
- 不得绕过 plugin capability gate，或把配置中启用 plugin 等同于当前 Core binary 支持 plugin。
- 不得在 visual config 保存时丢失未托管 YAML、plugin store source 或并发产生的服务端字段。
- 不得因为上游删除而移除 Ampcode、Codex abnormal reasoning retry、Codex quota/cloud sidecar 等 LTS 仍维护的能力。
- 不得改变 release asset 的精确名称 `management.html`，也不得引入第二套 package manager/lockfile。
- 不得把凭据、raw quota/usage payload、内部账户数据或 deployment secret 写入文档、测试快照或公开产物。
- 文档和运行界面保持商业中立：不加入返利、注册优惠、付费推荐位或空状态品牌推荐。
