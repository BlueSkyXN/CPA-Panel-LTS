# 2026-09-11 分支收尾与上游 selective-port

## 范围与基线

- 本仓起始 `main == origin/main == 4ed903ddc20fa44fbe75617a13d4f4ca7b740144`。
- 上游 `main == dev == ed5f1c48e11ba7335f1e8f676f228c280196af85`（`v1.22.15`）。
- 七天窗口：`2026-09-04T09:05:38Z` 至 `2026-09-11T09:05:38Z`，按 committer time，共 4 个非 merge 提交、0 个 merge 提交。
- 采用 fetch、祖先关系、文件 diff 和 patch-id 核对；不 full-sync、不恢复整份 stash、不删除工作树或分支。Release、tag、部署不在范围内。

## 自有工作去向

| 对象 | 核对结果与处理 |
|---|---|
| `codex/multi-instance-sessions` / `ceb2131` | 本地、远端和第二工作树一致；PR #81 已合并，对起始 main 独有提交为 0，工作树干净，保留副本。 |
| `codex/pat-provider-delivery` / `2c99444` | 本地与远端一致；PR #82 已合并，独有提交为 0。 |
| `codex/usage-query-v1` / `af9e807` | 本地与远端一致；PR #80 已合并，独有提交为 0。 |
| 当前未提交配置与会话工作 | 九域配置目录、字段搜索/定位、错误恢复、统一草稿、四语言帮助与局部主题；独立 iframe 会话、目标实例提示、断开写保护和隐藏实例 SSE 生命周期一起交付。保留完整 usage、源码/未知 YAML、并发保存与回读语义。 |
| 当前未提交价格工作 | Fast 长上下文 `allow/official` 估算假设独立提交，默认不限制；preset/custom 使用同一规则。只改变浏览器估算，不冒充官方支持、账单或 Core 计费。 |
| 当前未提交配额工作 | 通用配额页不渲染没有可用凭据的空提供方区块；保留过滤器、深链及空状态。 |
| 开放自有 PR / stash | 起始均为 0；当前改动在 `codex/panel-closeout-20260911` 集成交付。 |
| 已关闭未合并 PR #1 / #2 / #67 | #1 的 loading/in-flight/reset 排他已在现有 QuotaSection/loader；#2 的 `e4b39fff` 与主线 `92bff0a6` patch-id 相同；#67 为空商业隐藏名单，无须恢复。 |

不可达 commit 从上次 41 个增至 43 个：新增 `2f7a721e` 是 userscript WIP，其 `scripts/chatgpt-quota-helper.js` 与当前 HEAD 完全相同；`dfe97398` 是没有独立 diff 的 index 快照。其余对象沿用 [上次逐项核对](upstream-intake-20260907.md)，不把恢复快照当作新功能，不回退已交付实现。截图仅为本地证据，不纳入源码提交。

## 上游逐提交 / hunk 决策

分类遵循 protected selective-port；人工适配不代表原提交成为 LTS 的祖先。

| 上游 SHA | 分类 | Diff 与当前 LTS 判断 |
|---|---|---|
| `731347988b1f7580c1c2a6730407f1470184e1e4` | `already-equivalent` | 六项俄语请求头文案已由 `9d73e31` 适配；六项 Codex reset 文案在 LTS overlay，Node `russianTranslations.test.mjs` 覆盖。无需复制 Bun 测试或重复 shared key。 |
| `cb917b3111196487549f7a43e3afce4801f5d0f0` | `reject` | 只改上游 AGENTS：Bun、Node 24、普通版本 tag 和不同目录架构。不覆盖本仓 npm、Node 20、router/cards、LTS tag 约定。 |
| `5b4d52b38929454491674e130d7368c908353e65` | `adapt-port` / `defer` | 直接吸收有独立收益的 hunk：已有别名用编辑标题、四语言 provider 插值、两页 provider 的 label 关联和选择按钮 `aria-pressed`。沿用 LTS 现有页面及加载失败、dirty、force-mapping、保存保护；共享 ProviderCard/AliasMappingRow、385 行新样式和旧 SCSS 删除继续暂缓，不把视觉差异判成缺陷。mock smoke 验证新增/编辑标题、label、选中态及无修改返回。 |
| `ed5f1c48e11ba7335f1e8f676f228c280196af85` | `reject` | 移除 Infistar quick-fill、隐藏品牌入口，再用 `infistarHidden || ...` 把其配置放回 generic 协议组。并非删除配置或让凭据不可见；已纠正旧审计的错误描述。保留 LTS 配置检测品牌、商业中立和 sourceIndex/未知字段，不引入 sponsor 名单驱动的重分组。 |

## 七天内更新、尚未进入上游主线的 PR

| PR / 精确 head | 分类 | 当前证据与边界 |
|---|---|---|
| #422 / `0d241d6c5d89a7806ae5f946c8c0e9fe1d959a68` | `already-equivalent`（配套 Core） | 上游 Panel 在兑换成功后额外 POST `/reset-quota`，用内存 Set 暂存待清理状态。LTS Panel 经 `/api-call` 兑换；Core `internal/api/handlers/management/api_tools.go` 已在核验 Codex、POST、chatgpt.com、consume 路径与成功响应后调用 `ClearQuotaState`，无需重复客户端写请求。Core 同时存在 `/reset-quota`，但不是新增调用的理由；旧/第三方 Core 不冒充已验证等效。 |
| #421 / `ee85f0e9cb1aac5c5166c5e2737f14f99eec9a73` | `defer` | 新增 POST `/auth-files/test-model`、`test_kind` 及 text/image 生成探测。当前配套 Core 没有该管理路由；是新增可能收费的探测能力，不在维护中默默打开。等 Core 合同及显式探测 UX 后独立评估。 |
| #416 / `dd909847d4189c63d3b7c2ffa1ecd7442c449834` | `defer` | 与上次精确 head 相同；月度 `spend_control.individual_limit` credit budget 不能用滚动额度、reset credit 或 USD 余额替代。仍缺相应实际响应与 LTS 展示验收。 |
| #376 / `51526bf268c0ed2126d484396c9758a3ea9902c9` | `already-equivalent` | 与上次 head 相同；LTS Codex sidecar 的 `CODEX_BATCH_CONCURRENCY = 1` 及有界 worker 已串行化，不复制另一套 quota hook。 |

## 验证与交付边界

- `npm run validate:lts`：306 项 Node 测试全部通过，contract、type-check、lint、single-file build 通过。
- 构建后的 `python3 scripts/smoke-lts-panel.py`：完整 mock Core smoke 通过，包括 OAuth 本次适配及价格策略开关/覆盖率断言。
- `python3 scripts/smoke-config-editor.py`：键盘、错误恢复、统一草稿、YAML round-trip、SSE 可见性、6 个 viewport、3 套主题、4 种语言和实际渲染对比度通过。
- `python3 scripts/smoke-connections.py` 及 `--file`：独立认证、A-B-A 草稿保留、失败/取消、断开/写入排他、401 隔离、刷新恢复、HTTP/file 和窄屏通过。
- `python3 scripts/smoke-quota-visibility.py`：有内容分组、过滤/深链、禁用/runtime-only 排除、空状态/刷新及桌面/移动端通过。
- `python3 scripts/smoke-lts-panel-core.py`：配套 Core `aa4eef0441fb35021ecb64698d8dd698b6f98371`，临时配置、临时凭据和独立端口的 endpoint/browser smoke 通过；包括源码/可视化保存回读、Flow V3 与 SSE、provider CRUD 和价格估算。

精确 PR head CI 与最终合并状态以本次 PR 记录为准。本轮没有线上配置写入、Release、tag 或部署；测试实例浏览器通过不等同于实际账号全流程 UAT。
