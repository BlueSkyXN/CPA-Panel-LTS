# 完整 usage statistics 契约

完整 usage statistics 是 `CPA-Panel-LTS` 的 primary protected capability。本文档说明数据来源、导入导出、pricing、service tier 和排障证据的稳定语义。

机器可检查的路径、marker 和验证命令仍以 [panel-feature-contracts.yaml](./panel-feature-contracts.yaml) 中的 `full-usage-statistics` feature 为准；最小不可删除面见 [panel-protected-deltas.yaml](./panel-protected-deltas.yaml)。

## 保护范围

必须保留的用户能力：

- `/usage` 完整统计页面和 `/usage/pricing` 独立价格工作区。
- requests/tokens、hour/day trend、RPM/TPM 等完整聚合。
- API、model、credential/source 维度 breakdown。
- request events、latency、result、reasoning effort、token breakdown 和逐事件本地费用估算。
- request events 可显示 Core 提供的 `ttfb_ms`、`ttft_ms`、`ttfa_ms`，并派生 `Output TPS`、`Avg TPS`、可见平均 TPS 与 Reasoning 占比。
- cache read、cache write、non-cache-read input 和 reasoning token 语义。
- usage export/import、预检查、版本迁移、重复/重叠处理和失败回执。
- 本地 pricing catalog/profile、来源链接、Fast/Std 和 long-context 策略。
- 依赖完整 usage 的 provider status surface。

`recent-requests` 或 API-key summaries 只能补充短窗口健康信息，不能替代上述任一历史统计、导入导出或计价能力。

主要 Panel source：

- [`src/components/usage/`](../../src/components/usage/)
- [`src/services/api/usage.ts`](../../src/services/api/usage.ts)
- [`src/stores/useUsageStatsStore.ts`](../../src/stores/useUsageStatsStore.ts)
- [`src/types/usage.ts`](../../src/types/usage.ts)
- [`src/utils/usage.ts`](../../src/utils/usage.ts)
- [`src/utils/usage/serviceTier.ts`](../../src/utils/usage/serviceTier.ts)
- [`src/utils/usage/pricing/`](../../src/utils/usage/pricing/)

## Core Management API 边界

Core 提供 request-level usage collection 和 Management API；Panel 只读取、解析、展示并提交经过预检查的 import：

| Endpoint | Panel 用途 | 关键边界 |
|---|---|---|
| `GET /v0/management/usage` | 当前 usage snapshot | 返回 aggregate、API/model tree、details 和 failed requests；具体 shape 以当前 Core 为准 |
| `GET /v0/management/usage/export` | 导出 canonical usage | 当前 LTS contract 为 version 3；不能因 UI 兼容而伪造缺失语义 |
| `POST /v0/management/usage/import` | 导入 usage | Panel 先执行本地预检查并提交；最终验证、合并和失败语义必须以当前 Core contract/readback 为准，不能仅凭 preflight 宣称已写入或原子合并 |
| `/v0/management/usage-statistics-enabled` | 查看或修改新 usage 写入开关 | Core compatibility layer 暴露独立读写方法；Panel 当前从整体 config 读取，并以 `PUT` 执行直接 mutation。开关影响新记录；历史 snapshot/export/import 的可读性由 Core 当前契约决定 |

所有 Management endpoint 受 Core management authentication 和 remote-management policy 控制。Panel 构建通过不证明 Core endpoint 可访问，也不证明 live 数据完整。

## Usage export/import

### Canonical version 3

version 3 是当前 Core/Panel 的 canonical export contract。它要求 token category、aggregate、detail、schema metadata 和 timing contract 具有可验证的一致语义。无效 canonical token、timing 因果关系、整数溢出或 shape 错误必须在写入前拒绝。

每个新 Core detail 使用 `timing_version: 1`。`ttfb_ms` 是首个上游 response byte/payload，`ttft_ms` 是首个非空 reasoning 内容，`ttfa_ms` 是首个非空用户可见 assistant 文本；三个 timing 字段都可以缺失，缺失不得补成零。非流式和未知 format 不伪造 semantic timing。

### Version 1 migration

version 1 和 version 2 只在语义可证明时迁移到 v3：

- 允许恢复能够无损解释的旧字段和被省略的 legacy zero。
- cache category 存在歧义时 fail closed，不把未知 token 强行分类。
- v1 receipt 的 `migrations` 为 `v1_uncached_input_tokens_to_v2`、`v2_timing_contract_to_v3`；v2 receipt 的 `migrations` 为 `v2_timing_contract_to_v3`。旧 Core 的单数 `migration` 仍由 Panel 兼容读取。

### Duplicate、overlap 与 uncertain identity

- duplicate/overlap identity 必须与 Core 当前规则兼容。
- 无法稳定识别的记录应披露 uncertain identity，而不是假装精确去重。
- import preflight 是风险说明和输入检查，不代替 Core 的最终原子验证。
- “选择了文件”不等于“已导入”；成功必须来自 Core response 和必要的后续 readback。

## Request performance metrics

Core 的 request detail 使用可选字段 `ttfb_ms` 表示从 Core 发起上游请求到收到首个上游 response byte/payload 的时长，单位为毫秒。历史记录或不支持该测量的请求不会补造该字段。

Panel 在浏览器本地按同一条明细派生以下指标：

- `Output TPS` = `output_tokens / ((latency_ms - ttfb_ms) / 1000)`，且包含 provider 报告的 reasoning tokens。
- `Avg TPS` = `output_tokens / (latency_ms / 1000)`，表示端到端输出速度。
- `Visible Avg TPS` = `max(output_tokens - reasoning_tokens, 0) / (latency_ms / 1000)`。
- `Reasoning Ratio` = `reasoning_tokens / output_tokens`。
- 当时间字段缺失、非正、或 `ttfb_ms >= latency_ms` 时，TPS 显示为 `--`。
- 筛选汇总使用分子和有效时长分别求和，不使用逐请求 TPS 的简单平均；每项显示自己的有效样本数。

这些是按 Core request detail 边界计算的有效吞吐，不是供应商账单字段，也不保证等同于 CLI stdout 的首事件或模型内部逐 token decode 速度。聚合时应使用 token 总数除以有效时长总和，不能简单平均每条 TPS。

## Token 和 pricing 语义

### Token 分类

- `input_tokens` 是完整输入；cache read/write 是其中具有独立计价语义的类别。
- non-cache-read input 不得通过重复相减造成负值或 double count。
- reasoning tokens 与用户可见 output 是不同语义；provider 是否将 reasoning 计入 output 由已验证 parser 决定。
- 缺失类别不得默认为免费，也不得为了 coverage 显示而制造 token。

### 本地费用估算

Panel pricing 是 **browser-local estimate**，不是 Core billing API 或服务商账单：

- preset catalog 随 Panel source/release 发布，并保存来源和 `verified as of` 信息。
- custom profile 保存在当前浏览器；它不会自动同步到 Core 或其他浏览器。
- model matching 使用 canonical id 和显式 alias，不做模糊 substring 猜测。
- `cacheWrite` 缺失表示 Auto/继承 input，显式 `0` 才表示免费。
- Fast 可以使用独立费率或 `Standard × multiplier`；没有已验证 Fast policy 时不得默认为 Standard 价格。
- long-context threshold 和 Fast long-context 支持按具体 catalog entry 决定，不是全局统一能力。
- unmatched、unsupported 或 coverage 不完整返回明确状态和 `amount: null`，不能显示成 `$0`。
- request events 使用当前 browser-local `priceProfile` 和同一套 `calculateCostEstimate` 逻辑；表格、图表和 coverage 不得形成第二套计价口径。
- request-event CSV/JSON 导出保留 `estimated_cost_usd` 与 `pricing_status`；未匹配或不支持时费用保持空值，不能导出为免费。

aggregate 和 detail 必须对账。Core aggregate 有 3 条请求而 Panel 只有 1 条可计价 detail 时，coverage 不能显示为 100%；aggregate-only model 也不能从 pricing workspace 消失。

## Service tier 字段

Core 和 Panel 使用不同字段保存请求意图、实际出站和上游结果。不要只看单个 badge 或单个字段下结论。

| 字段 | 来源 | 含义 | 权威限制 |
|---|---|---|---|
| `service_tier` | Core usage detail | 兼容字段，通常保存客户端请求 tier | 请求意图，不证明最终 Fast |
| `request_service_tier` | Core usage detail | 明确的客户端请求 tier | 请求意图，不证明 translator/payload rule 后仍保留 |
| `outbound_service_tier` | Core executor | translator、payload rules 和最终 shaping 后，实际发送 payload 顶层的 raw tier | 能证明 CPA 发出了什么；不能证明 provider 最终采用 |
| `response_service_tier` | provider response body/SSE | 上游返回的 raw tier | 非空 response 是最高运行时证据；未知值不能被下游请求意图覆盖 |
| `effective_service_tier` | Core usage resolver | 当前 companion Core contract 中，response 优先、response 缺失时由 outbound canonicalize 得出的最终 tier | 当前 Core 只生成可识别 canonical tier，未知保持空；Panel 仍容忍 import、旧版或未来 Core 中的非空未知值，并按 `Std + assumed` 处理 |
| `resolved_service_tier` | Panel request-event export | Panel 映射后的 `fast` 或 `std` | UI/估算结果，不是新的 Core 原始证据 |
| `service_tier_evidence` | Panel request-event export | `effective`、`response`、`outbound`、`request` 或 `assumed` | 说明 resolved 结果依据 |

Core canonical mapping 与 Panel display mapping：

| Raw value | Core canonical | Panel display |
|---|---|---|
| `priority`、`fast` | `priority` | `Fast` |
| `standard`、`default` | `standard` | `Std` |
| `auto`、`flex`、`scale`、其他未知值 | 空/unknown | 不确认 Fast；按下面的保守规则处理 |

## Panel resolver 优先级

[`resolveServiceTier`](../../src/utils/usage/serviceTier.ts) 使用以下顺序：

1. 可识别的 `effective_service_tier`。
2. 非空但未知的 effective：立即停止 fallback，显示 `Std + assumed`。
3. 可识别的 `response_service_tier`。
4. 非空但未知的 response：立即停止 fallback，显示 `Std + assumed`。
5. 可识别的 `outbound_service_tier`。
6. 非空但未知的 outbound：立即停止 fallback，显示 `Std + assumed`。
7. 可识别的 `request_service_tier`，兼容回退到 `service_tier`。
8. 历史、缺失或仍未知：显示 `Std + assumed`。

“高权威字段非空但未知”与“字段完全缺失”不同。未知 response 可能代表服务商引入了新 tier，不能绕过它继续采用较低权威的 request Fast；因此 resolver fail closed 为 assumed Std，同时保留 raw evidence 供排查。

## `Fast → Std` 的准确含义

请求事件单元格只在客户端请求 display tier 与最终 resolved tier 不同时显示箭头：

```text
请求意图 → 最终解析
Fast    → Std
```

它表示“客户端请求了 Fast，但更高权威证据没有确认最终 Fast”。它不等于 Panel 修改了请求，也不自动等于 provider 明确降级。

| Tooltip evidence | Panel 结果 | 可以得出的结论 |
|---|---|---|
| request=`priority`，outbound=`priority`，response=`default`，effective=`standard` | `Fast → Std`，response/effective evidence | 上游明确按 Standard 返回；可能是服务端降级 |
| request=`priority`，outbound=`priority`，response 缺失，effective=`priority` | `Fast` | CPA 确认发出 Fast，且 Core 用 outbound 得到 effective Fast |
| request=`priority`，outbound=`priority`，response=`auto`，effective 缺失 | `Fast → Std`，assumed | response 非空但未知；这是保守推定，不是已确认降级 |
| request=`priority`，outbound 缺失或 `default`，response 缺失 | `Fast → Std` 或 `Std` | 没有证据证明最终向上游发送 Fast；继续检查 translator/config/version |
| 历史记录只有 request=`priority` | `Fast`，request evidence | 只能证明请求意图；实际计费 tier 可能不同 |
| 所有 tier 字段缺失 | `Std`，assumed | 历史/未知兼容结果，不是 provider 明确返回 Standard |

鼠标 Tooltip/ARIA 会列出：客户端请求、CPA 出站、上游响应、生效档位和最终 evidence。CSV/JSON export 保留 raw 和 resolved 字段；排障时应使用这些字段，不按 badge 颜色猜测。

## OpenAI Fast mode 的官方语义

根据 2026-08-13 回读的 [OpenAI Fast mode 文档](https://developers.openai.com/api/docs/guides/fast-mode.md)：

- 请求可发送 `service_tier: "fast"` 或 `service_tier: "priority"`。
- 对 GPT-5.6 及更早模型，即使请求发送 `fast`，response 通常仍返回 `priority`。
- 如果触发 ramp-rate limit，部分 Fast 请求可能降级为 Standard，response 返回 `service_tier: "default"`，并按 Standard 速度和价格处理。
- Fast 的支持模型、费率和限制会变化；这些是外部 provider 文档事实，不是 Panel/Core 的永久静态契约。Panel preset catalog、当前官方文档和 live response 必须分别核对，不能只依赖请求配置。

因此，对 GPT-5.6 排障时应该寻找 response `priority`，不能要求 response 必须出现字面量 `fast`。

## Request-level usage 与 Workspace 日汇总

Panel 同时可能看到 Core request-level usage 和 Codex Workspace analytics。两者粒度和用途不同：

| 数据面 | 粒度 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| Core `/v0/management/usage` details | 单条 provider attempt/request | request、outbound、response、effective tier 和 token evidence | 服务商账号侧最终日账是否已经结算 |
| Workspace `daily-workspace-usage-counts` | 日期、workspace/client 等聚合 | Panel sidecar 当前消费的 daily totals/clients；实际 upstream payload 可能额外返回 model/speed 或 product surface 聚合 | 额外字段不是当前稳定 typed contract，也不能映射到某一条 Core usage detail，除非另有共同 request identity |
| Gateway/proxy log | 单次请求或事件 | 在保留相应 payload 时观察发送/返回 tier 和时间 | 未记录字段、过期日志或聚合事件不能补造缺失证据 |

例如，某次实际 upstream readback 可能出现以下额外字段；这是说明粒度差异的示例，不是稳定 schema：

```json
{
  "model": "gpt-5.6-sol",
  "speed": "fast",
  "credits": 1.23
}
```

在该次 readback 的上下文中，它能证明日汇总中存在该模型的 Fast credits，但不能证明同一天 Panel 中任意一条 `Fast → Std` 记录也是 Fast。当天同时存在 `speed: "standard"` 时，两种结果本来就可以共存。

还应注意：

- credits 占比不是请求数占比，也不是 token 占比。
- `product_surface_usage_values` 是按产品入口聚合的另一维度，不是 service-tier response evidence。
- 当前 Panel typed analytics contract 主要消费 daily totals/clients；服务端返回的额外字段只有在 types、parser、UI 和测试都纳入后，才成为稳定 Panel feature contract。
- Workspace analytics 与 Core usage 使用不同采集链；日期边界、重试、失败请求、聚合延迟和 model alias 都可能造成数字差异。

## Codex Interactions 历史边界

`CPA-Core-LTS` 保留一个 required downstream patch：旧 Codex Interactions response translator 曾在 streaming completion 中硬编码 `standard`，并在 non-streaming response 中遗漏 tier；`[DONE]` fallback 也需要保存已经观察到的 service tier。

当前 LTS 实现的目标行为：

1. upstream response 有可识别 tier 时优先采用。
2. response 缺失且 final outbound request 可读时，采用 outbound tier。
3. final outbound request 可读但 tier 缺失/不支持时，不能回退到 client intent，结果为 Standard。
4. outbound 数据不可用时，才兼容采用 original request tier。
5. streaming、non-streaming 和 `[DONE]` fallback 都应输出一致结果。

该补丁在 companion Core 的 `docs/lts/downstream-patches.yaml` 中登记为 `codex-interactions-service-tier-response`，implementation commit 为 `be649f04a4a66b952d5210c7cdf74e1d90a12b76`。上游相邻的 Fast/service-tier 修复不等于覆盖了这条独立 translator path；部署排障必须确认实际 Core build 包含该补丁。

源码存在、commit 合并、release 包含、Core 已部署和具体请求经过新版本是五个不同结论。没有 live 版本/readback 时，不得把当前本地源码行为写成现网事实。

## 排障流程

遇到“配置 Fast，但 Panel 显示 Std”时按以下顺序：

1. 确认记录时间、model、source/auth index，避免把不同请求或不同日期聚合混在一起。
2. 展开 tier Tooltip 或导出 request events，读取 request、outbound、response、effective 和 evidence。
3. request 不是 Fast：检查客户端当前配置、model alias 和会话启动时配置。
4. request 是 Fast、outbound 不是 Fast：检查 translator、payload rules、alias scope 和实际 Core version。
5. outbound 是 Fast、response=`default|standard`：按上游明确 Standard 处理，结合流量变化判断是否可能触发 ramp-rate。
6. outbound 是 Fast、response 缺失、effective 是 Fast：按 outbound evidence 解析为 Fast，不应显示 `Fast → Std`。
7. response 非空但未知：保留 raw 值，按 assumed Std 处理，并检查服务商是否新增 tier。
8. 对照 Workspace 日汇总只能判断当天整体是否存在 Fast；不能用它覆盖单条 response evidence。
9. 若行为不符合当前 resolver，核对部署 Core/Panel commit、release asset 和 live `/management.html`，不要只看本地工作区。

## 验证门槛

Usage 变更的最小验证：

```bash
npm run test:usage
npm run check:lts
npm run type-check
npm run build
```

以下情况需要增加验证：

- request-event、filter、pricing、import/export 或 responsive UI 改变：运行 `npm run smoke:lts`。
- Core schema、effective/outbound tier、Management import/export 改变：核对当前 Core source，并在条件具备时运行 `npm run smoke:lts:core -- --no-write-smoke`。
- 跨 usage、provider、auth/quota 或 shared store 的广泛变更：运行 `npm run validate:lts`。
- 只通过 build 不能证明 service-tier runtime、真实 Core compatibility、release 或 deployment。

## 文档更新触发条件

出现以下变化时，同一交付中更新本文档：

- Core 新增、删除或改变 usage/service-tier 字段。
- Panel resolver、evidence、badge、filter 或 export 语义改变。
- canonical export version、migration 或 error code 改变。
- preset pricing、Fast/long-context policy 或 coverage 定义改变。
- Workspace analytics 字段正式纳入 types/parser/UI contract。
- Interactions patch 被上游完整覆盖、retire 或改变最低兼容 Core 边界。
