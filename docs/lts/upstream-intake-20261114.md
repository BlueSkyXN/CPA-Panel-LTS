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


## 2026-11-15 续作返工：store 互斥与模型刷新（评审后）

上一版把两项 adapt-port 落地后，评审指出三处实现问题，本轮已修正并补回归。
PR #151 的 base 已从 `main` 改为 `codex/upstream-quota-20261114`（即 #150 的分支），
原生 stack `152` = `[#150, #151]`，base `main`。

### 1e29f88f store 安装与插件变更互斥（返工）

原实现把 busy 状态从组件状态发布到共享 store（`setInstalledBusy(...)`、
`setStoreBusy(Boolean(installingKey))`），存在三个可达缺陷：

| 缺陷 | 后果 | 修正 |
|---|---|---|
| 锁由组件状态发布 | 离开 `/plugins` 或 `/plugin-store` 时组件卸载，在途变更的锁被静默释放 | 改为 token 登记，由变更自身取得/释放，锁生命周期等于请求生命周期 |
| 重新进入路由再次发布 `false` | 请求尚未 settle 就已解锁，仍可发起第二笔 | 同上；remount 不再写入锁状态 |
| 锁无连接维度 | 切连接后旧连接的迟到结果仍能锁住新连接 | 登记按 `profileId:apiBase` 归属，连接变化即清空两侧 |
| 启停只判 `deletingID` | 启停可与删除、store 安装并发 | 启停纳入完整互斥判断 |
| **登记不拒绝第二笔** | 同一 JS 任务内两次触发各拿一个 token，各发一次请求；组件里的 busy 判断读的是上一次渲染的闭包，两次都看到「空闲」 | 改为 `tryBeginInstalledMutation()` / `tryBeginStoreMutation()`：**检查与登记同步一步完成**，取得失败返回 `null`，调用方不得发请求 |

第二笔请求的缺口已实测复现并修复：对插件删除确认按钮在同一 task 内同步派发两次 `click`，
修复前 mock 收到 **2 次** `DELETE .../plugins/mock-plugin`，修复后 **1 次**。
`runInstall` 也改为先取锁再设 `installingKey`（原先先设状态，第二笔的 `finally`
会清掉第一笔的 UI 状态）。删除确认回调同样改为先取锁、失败即返回。

四个已装插件入口（删除/启停/打开配置/保存配置）统一经过 `acquireInstalledMutation()`，
取不到锁时直接返回，不设 busy 状态、不发请求。

验证：
- `src/stores/usePluginMutationStore.test.mjs` 四例（锁生命周期跨越组件卸载、
  **同一 task 内第二次取得被拒绝且只登记一个 token**、两路由共用命名空间且互斥双向生效、
  连接切换清空且忽略迟到释放）；
- `scripts/plugin_mutation_lock.test.mjs` 静态契约改为 `tryBegin*` 设计，并断言每个取得点
  都有失败即返回，删除确认必须先取锁再设 busy 状态；
- 浏览器反例 `local/20261115-plugin-delete-double-submit/`：同步双 click 下 mock 只收到一次 DELETE，
  回退到旧实现时收到两次。

### 2da3e263 模型刷新反馈（返工）

`refreshCatalog` 在连接已切换时 resolve 为 `{changedProviders: []}`，与「刷新成功但无变化」
不可区分，于是页面显示成功提示并继续刷新**当前**连接的列表。

- `refreshCatalog` 现返回 `{stale, changedProviders}`，过期响应置 `stale: true`；
- `SystemPage` 对 `stale` 直接返回，不报成功、不触发当前连接的列表刷新；
- `fetchModels` 与目录刷新都用「请求序号 + 连接代际」双门，连接变化时两者一起作废。

验证：`src/services/api/modelsCatalogRefresh.test.mjs` 四例（过期成功、当前成功、
过期失败被吞掉而当前失败仍抛、页面不走进成功分支）。

### D1 交互验收：v2 → v3

v2 的 18/18 被三项评审意见取代；v3 现为 **30/30**（Panel head `bf4f9b59e`，dist 由该树重建）：

1. **未决操作下切换连接**：v2 只在全部 claim 结算后才切换，等于在空 journal 上验证清理。
   v3 扣住一笔 claim 的响应使 journal 留下未决项，关闭对话框、离开路由再返回
   （tab-memory journal 必须同时活过 unmount 与路由往返），再切换连接，
   断言新会话不继承待决身份。

   **范围更正（评审指出）**：v3 并不证明「旧连接的迟到响应不污染新连接」——
   产品在写入在途时拒绝断开（脚本已断言），所以到切换时 claim 已结算成未决 journal 项，
   不存在可释放的迟到响应。正式结论是：**在途写入阻止断开；结果未知的 journal 能跨页面保留，
   并在真实重连后隔离。**
2. **真实重复提交**：v2 单次点击后读 `disabled`，属 UI 状态检查。v3 在同一 task 内同步
   派发两次 click，由产品自身的在途守卫拒绝第二次，mock 必须只看到一笔 claim。
3. **可靠的重建判据**：v2 给 `location.reload` 打补丁计数，而真实重新加载的另一个文档
   根本不会上报。v3 分开报两个事实：**宿主**页面未 reload（`performance.timeOrigin` 不变）、
   **应用 iframe** 已重建（新 `timeOrigin`、哨兵消失、新 iframe 元素上没有 `data-*` 标记）。

v3 还记录了一条 v2 未触及的产品行为：写入在途时断开会被拒绝
（"This instance has an operation in progress. Wait before disconnecting."），
因此切换只在 claim 结算成未决 journal 项之后才可达。

反例（均应失败且已实测）：`request_id` 置空 → 4 条 id 断言失败；成功响应缺 `result`
→ 成功关闭断言失败；用 `reload()` 代替连接切换 → 断开阻塞与 journal 存活两项失败。

归档：Core L1 worktree `local/20261114-d1-grant-smoke/v3/`；v1/v2 在 README 中标注失效。

### 剩余 defer 不变

Codex credit overage、OAuth login proxy、plugins 页面族重构、authFiles model catalog sync、
quota/auth-files 卡片布局与时间线、autocomplete、connectivity 测试、OAuth 编辑器重构：
沿用既有 defer 结论，本轮未移植，仍计入可见 backlog，不计为已更新。
