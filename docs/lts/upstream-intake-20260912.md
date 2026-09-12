# 2026-09-12 分支复查与上游 selective-port

## 范围与自有工作

- 七天窗口：`2026-09-05T05:40:38Z` 至 `2026-09-12T05:40:38Z`，按 committer time。
- 起始 `main == origin/main == 937aa4acaf9e98e069c75511ad97c109cc9fcb7a`；其精确 main CI `34591903070` 成功。
- 本地和 GitHub 的四个功能分支逐一核对，head 全部已是 main 的祖先，独有提交均为 0。

| 分支 | 精确 head | 主线交付 |
|---|---|---|
| `codex/usage-query-v1` | `af9e807` | PR #80 已合并 |
| `codex/multi-instance-sessions` | `ceb2131` | PR #81 已合并 |
| `codex/pat-provider-delivery` | `2c99444` | PR #82 已合并 |
| `codex/panel-closeout-20260911` | `a697ff7` | PR #83 已合并 |

开放自有 PR、stash、额外 linked worktree 均为 0。唯一未提交差异为 `.gitignore` 的 `/output`，用于本地浏览器产物，随本次收尾保留并提交，不加入目录内产物。

已关闭未合并 PR 仍只有 #1、#2、#67；前两项已由现有 quota 排他/串行化覆盖或 patch-id 等价，#67 的空商业隐藏名单继续拒绝。不可达 commit 仍为 43 个，最新对象仍是上次已核对的 `2f7a721` / `dfe9739`，没有新的恢复候选；逐项去向沿用 [2026-09-11](upstream-intake-20260911.md) 和 [2026-09-07](upstream-intake-20260907.md)。不恢复旧 stash，不删除分支/工作树，不运行 prune/GC。

## 上游 main：4 个提交

`upstream/main = ed5f1c48e11ba7335f1e8f676f228c280196af85`，仍为 `v1.22.15`。本次重新读取 patch 和现有实现；原提交未成为 main 祖先不表示遗漏。

| SHA | 分类 | 当前 LTS 证据与决定 |
|---|---|---|
| `731347988b1f7580c1c2a6730407f1470184e1e4` | `already-equivalent` | `9d73e31` / PR #78 已适配俄语 headers；reset 文案在 LTS overlay，`russianTranslations.test.mjs` 覆盖，不复制 Bun 测试或重复 key。 |
| `cb917b3111196487549f7a43e3afce4801f5d0f0` | `reject` | 上游 AGENTS 的 Bun、Node 24、普通 tag 和目录结构与 LTS 不同；保留 npm、Node 20、router/cards 和 LTS 发布合同。 |
| `5b4d52b38929454491674e130d7368c908353e65` | `already-equivalent` / `defer` | 可独立收益的标题、provider 插值、label 与选中态已由 `a697ff7` / PR #83 适配；共享 ProviderCard、映射行和整页样式迁移继续暂缓。 |
| `ed5f1c48e11ba7335f1e8f676f228c280196af85` | `reject` | sponsor 名单驱动的 Infistar 品牌隐藏与 generic 重分组不是 LTS 需求；保留配置检测、sourceIndex 和未知字段，不错误描述为删除凭据。 |

## 上游 dev：5 个新增提交

`upstream/dev = 7aa8618ad2ce1677260c08d9b597377d5661d160`。这些提交尚未进入上游 main；是否接纳取决于具体 diff 和本地验证，不等待或冒充上游正式 Release。

| SHA | 分类 | Diff 与 LTS 适配 |
|---|---|---|
| `3be19dfbd15acd28087ce98411be9e6abe5f07ec` | `adapt-port` | 现有 `useModelsStore` 清空后仍可能被旧请求回写。保留 API/cache scope，在 clear、新 fetch、cache hit 时推进 request token，旧成功只返回调用者、旧失败不清新 loading。使用 Node/Vite 测试替代 Bun。 |
| `d3cdc4687584b15ed7bda207968b750c7c391ac2` | `adapt-port` | 当前 ConfigPage 同样把 visual→source 物化记为源码编辑，往返后丢失字段 dirty。只在用户真正编辑源码时保留完整草稿；纯查看源码仍合并最新服务端 YAML，确认前服务端再次变化仍重新预览。保留九域目录、错误恢复、连接目标和草稿保护，不搬 `features/config`。 |
| `7b93570b764d45bc8a4cf0bd8189bf31fe322d7d` | `adapt-port` | 现有 payload 编辑整段序列化会删除规则/模型的未知字段及注释。按稳定编辑 ID 复用 YAML AST 节点、保留 scalar 类型及注释，并覆盖删除/重排；额外保留上游没有的 LTS `model.scope` 写入/清除。纯 visual 多次查看源码从未物化基底生成，避免对已删/重排的节点再次套用旧索引。 |
| `40513fc80d9a11712187d7582ebd8c608a18348f` | `defer` | 只删除 dashboard 无消费者的 `activeBuckets`、`authFilesLoading`、`initialLoading`；没有用户可见修复，不为形式一致混入清理。 |
| `7aa8618ad2ce1677260c08d9b597377d5661d160` | `adapt-port` | 原 setInterval 可以重叠，清 timer 无法阻止已发 start/status/callback 响应写回。每个 provider 独立 attempt 和一个 setTimeout，响应完成后再轮询；重试、卸载、连接身份改变使旧响应失效。保留 Gemini project ID、xAI code→callback、固定 provider 和独立 iframe 会话；以 store subscription 适配 LTS lint，不复制 effect 同步 setState。 |

上述接纳项在本次 `codex/panel-intake-20260912` 同一维护提交中交付，最终 commit/PR 由 Git 历史及对应 PR 记录。没有新增 Core endpoint、依赖、locale、provider 产品面或收费探测。完整 usage、Flow V3、Codex sidecar、plugin capability gate、npm/package-lock 和 `management.html` 不变。

## 窗口内更新的开放上游 PR

| PR / head | 分类 | 复核结论 |
|---|---|---|
| #427 / `859e2b61c272c2ecce6c58419e08f44196d69898` | `defer` | 新增插件 provider label/logo fallback、branding store 和跨布局/AuthFiles/editor 接线。并非内置 provider 标签错误，当前 LTS OAuth 页也不是上游动态 plugin 卡片。需要现有插件能力门禁、连接隔离、资产 URL 和 fallback 的独立适配，不能为品牌显示搬 Vault/OAuth 架构。 |
| #422 / `0d241d6c5d89a7806ae5f946c8c0e9fe1d959a68` | `already-equivalent`（配套 Core） | 配套 Core main `a215f40c17e30230f976e2df6f43d0b4fd6440d9` 的 `api_tools.go` 在核验成功 consume 后清 `ClearQuotaState`，不增加重复客户端 POST。旧/第三方 Core 不在等效保证内。 |
| #421 / `ee85f0e9cb1aac5c5166c5e2737f14f99eec9a73` | `defer` | 新增 `/auth-files/test-model` 与 text/image 推理探测；配套 Core 尚无该管理路由，且可能收费，不能默默加入维护。 |
| #416 / `dd909847d4189c63d3b7c2ffa1ecd7442c449834` | `defer` | 月度 `spend_control.individual_limit` 不能等同于滚动额度、USD 或 reset credit；没有新的 payload/展示验收证据，维持原结论。 |
| #376 / `51526bf268c0ed2126d484396c9758a3ea9902c9` | `already-equivalent` | LTS Codex sidecar 的 `CODEX_BATCH_CONCURRENCY = 1` 和有界 worker 已实现串行刷新，不复制另一套 quota hook。 |

## 验证边界

- `npm run validate:lts`：321 项 Node 测试，0 失败；contract、type-check、lint、single-file build 全部通过。新增 15 项模型缓存、OAuth attempt 和 payload AST 回归。首次 lint 的 effect 同步 setState 错误已通过 store subscription 适配修复，未降低规则。
- `python3 scripts/smoke-lts-panel.py`：完整 mock Core browser smoke 通过，包含 OAuth 成功后晚到 callback 失败不可覆盖成功状态。
- `python3 scripts/smoke-config-editor.py`：模式往返保留字段 dirty、在源码模式按字段合并、确认前服务端再次变化后二次预览、未知 YAML 保留通过；原有键盘/错误恢复/草稿/Flow SSE、6 个 viewport、3 个主题、4 种语言及实际对比度通过。新增源码模式检查暴露了测试工具的双层 iframe 定位问题，已修正 helper 后完整通过，没有降低产品断言。
- `python3 scripts/smoke-lts-panel-core.py --no-write-smoke`：配套 Core `a215f40c17e30230f976e2df6f43d0b4fd6440d9` 的真实 endpoint/browser smoke 通过。该参数跳过额外 API 写测试，浏览器仍在临时配置和独立进程中做保存/CRUD 回读；没有访问或写入线上配置，Core checkout 保持干净。
- `git diff --check` 通过。精确 PR head 与合并后 main CI 由交付 PR 记录。

以上不等同于真实账号 UAT；无 tag、Release、部署或线上配置修改。
