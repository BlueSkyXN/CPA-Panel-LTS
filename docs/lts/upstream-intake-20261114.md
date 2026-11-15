# 2026-11-14 selective-port intake

本轮为 V8 主线常规上游跟进：Core companion 为 stack PR BlueSkyXN/CPA-Core-LTS #358/#359/#360（merge-base `c2f402b45` → `7cfa267b2`）。

## Scope and provenance

- Panel 起点 `origin/main` `21fc9dda`；候选分支 `codex/upstream-quota-20261114`，PR #150。
- 上游审查范围：`953fb244..3d893ec8`（冻结终点 = v1.28.0 tag），quota/claude grants 相关增量，重点 #555（extra usage 状态合并）与 #554（reset grants 显式选择对话框）。
- selective-port 覆盖，不声明 merge ancestry。

## Ported

| 上游 commit | LTS commit | 内容 | 分类 |
|---|---|---|---|
| `36083b08` (#555) | `3f0ef170` | Claude extra usage 状态合并：`userDisabledSignal` 折入 `extra_usage_disabled`，明细过滤 `user_disabled`，四语言文案改「未开启」语义 | adapt-port（LTS 自包含 quota 组件结构） |
| `d06a1105` (#554) | `f9dcf358` | reset grants 显式选择对话框：radio 选择、`canChooseResetGrant`（pending 只能重试原身份）、`parsePercentUsed` 模型窗口、歧义 claim journal、对话框脚注摘要 | adapt-port（自包含 dialog + hook 架构） |

验证：`validate:lts` 全绿；新增 `resetGrantChoice.test.mjs` 三回归接入 `test:auth-files`（commit `f7a2d4f1`）；交互 smoke 8/8（mock anthropic 端点：显式选择/禁用态/单次提交/原 request ID 重试/连接切换清 journal，零真实 grant）；两仓兼容矩阵 3/3（候选×候选、候选Panel×mainCore、mainPanel×候选Core）。

## Deferred（2026-11-14 逐项复核后）

| 上游 | 内容 | 分类与理由 |
|---|---|---|
| 2da3e263/0011550f | model-sync feedback（SystemPage/catalog refresh UX） | defer：LTS 无 `hooks/useModelCatalogSync`、无 `modelsApi.refreshCatalog`，上游改的是 LTS 不存在的 catalog refresh 基建；移植需先建该链路（非纯文案） |
| 1e29f88f | plugin store 安装与插件变更互斥锁 | **已升级为 2026-11-15 续作批次实施项**：确认 LTS 跨路由在途变更竞态真实可达（非“缺同名 hook”）；续作批次沿 LTS 架构实现跨路由 busy 互斥 |
| 18906172 | Codex credit 超支展示 | defer：依赖上游 quota 页面结构 |
| 28182ef9/a4bad6e3 | plugins 页面族重构 | defer：依赖上游页面结构 |
| 4a605466/b616482b/6cc19fed | 卡片布局/时间线分组 UI 族 | defer：UI 重构族 |
| 6b1b94a7/96ce4e1b | login proxy 字段 | defer：OAuth 页结构差异 |
| 3d893ec8 | AutocompleteInput | defer：通用组件重构 |
| 99a95c4a | modelCatalogSync | defer：同 2da3e263 基建缺失 |
| 7b754b23 | useConnectivityTest 测试 | defer：依赖上游 providers 目录结构 |

`defer` 是可见 backlog，不计为已移植。


## 2026-11-15 续作更新

- **D1 交互 smoke v2 收口**：v1 的 8/8 证据作废（固定下标/空值比较/切换段未真正切换三处弱断言）。v2 脚本 18/18 全过（request_id/grant_id 从真实 payload.data 解析并断言格式、`{"result":"reset"}` 成功形状、未知结果保留 Retry 并复用原 request id、延迟响应下提交禁用且恰好一次 claim、⌘K 命令面板真实登出+重登无 reload、journal 清空、新操作新 id），三项反例检查均按预期失败。归档：Core L1 worktree `local/20261114-d1-grant-smoke/v2/`。dist 由 79597ef9 重建。
- 验证补充：`validate:lts` 复跑绿；`resetGrantChoice.test.mjs` 保持接入 `test:auth-files`。


## 2026-11-15 续作:冻结范围全分类定稿(953fb244..3d893ec8)

| upstream | 内容 | 分类 | 落地/理由 |
|---|---|---|---|
| 36083b08 (#555) | claude extra usage 状态合并 | adapt-port | #150 `3f0ef170` |
| d06a1105 (#554) | reset grants 显式选择对话框 | adapt-port | #150 `f9dcf358` |
| 1e29f88f | store 安装与插件变更互斥 | adapt-port | **#151** `c64ef848`(跨路由共享 busy,LTS 双路由架构) |
| 2da3e263 (#573) | 模型刷新双动作反馈 | adapt-port | **#151** `4578a501`(Core v8 `/models/refresh` 已存在;连接代际守卫用 LTS 惯用法) |
| 99a95c4a | modelCatalogSync(authFiles 目录同步 UI) | defer | 依赖 upstream authFiles VaultHeader/模型目录刷新 UX 链路;LTS auth-files 模型面为 per-file `/auth-files/models/refresh`,无全局目录刷新基建;目录刷新语义已由 #151 SystemPage 动作覆盖主场景 |
| 18906172 (#556) | Codex credit overage 展示 | defer | 2383 行,依赖 upstream stores/apiCall 通道与全新 provider UI 子树;隐式付费探测需产品决策 |
| 28182ef9 / a4bad6e3 | plugins 页面族重构/本地化 | defer | 39 文件 4750 行,与 LTS capability-gated 架构冲突面大;可接纳的修复已由 #151 覆盖 |
| 6b1b94a7 / 96ce4e1b | OAuth login proxy | defer | 大特性,LTS OAuth 登录面自有实现(既有"官方页面整体重写"延期类) |
| 4a605466 / b616482b | quota/auth-files 卡片布局 | defer | UI 重构族;无独立正确性修复可拆 |
| 6cc19fed | quota timeline 独立分组 | defer | 依赖 upstream resetInstants/relativeTime 全套;LTS 已移植所需两助手 |
| 3d893ec8 | AutocompleteInput 归一化 | defer | 通用组件重构,随下轮 |
| f974d570 | model rule saves guard | not-applicable | 上游 modelRules/useModelRulesData 架构 LTS 无对应(LTS 走 oauth.model-policy v8 编辑器,自有保存链路) |
| ae4e74ed | authFiles OAuth 编辑器大重构 | defer | 官方页面整体重写类 |
| 7b754b23 | OpenAI connectivity 测试 | defer | 依赖 upstream providers 目录结构(useConnectivityTest.ts 形态不同) |
| 1c76da26+9c1deb66 | codexAccountSettings+revert | no-op | 上游自行 revert 净零 |
