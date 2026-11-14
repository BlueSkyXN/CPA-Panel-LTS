# 2026-11-14 selective-port intake

本轮为 V8 主线常规上游跟进：Core companion 为 stack PR BlueSkyXN/CPA-Core-LTS #358/#359/#360（merge-base `c2f402b45` → `7cfa267b2`）。

## Scope and provenance

- Panel 起点 `origin/main` `21fc9dda`；候选分支 `codex/upstream-quota-20261114`，PR #150。
- 上游审查范围：9 月末基线后的 quota/claude grants 相关增量，重点 #555（extra usage 状态合并）与 #554（reset grants 显式选择对话框）。
- selective-port 覆盖，不声明 merge ancestry。

## Ported

| 上游 | 内容 | 分类 |
|---|---|---|
| #555 | Claude extra usage 状态合并：`userDisabledSignal` 折入 `extra_usage_disabled`，明细过滤 `user_disabled`，四语言文案改「未开启」语义 | adapt-port（LTS 自包含 quota 组件结构） |
| #554 | reset grants 显式选择对话框：radio 选择、`canChooseResetGrant`（pending 只能重试原身份）、`parsePercentUsed` 模型窗口、歧义 claim journal、对话框脚注摘要 | adapt-port（自包含 dialog + hook 架构） |

验证：`validate:lts` 全绿；新增 `resetGrantChoice.test.mjs` 三回归接入 `test:auth-files`（commit `f7a2d4f1`）；交互 smoke 8/8（mock anthropic 端点：显式选择/禁用态/单次提交/原 request ID 重试/连接切换清 journal，零真实 grant）；两仓兼容矩阵 3/3（候选×候选、候选Panel×mainCore、mainPanel×候选Core）。

## Deferred（2026-11-14 逐项复核后）

| 上游 | 内容 | 分类与理由 |
|---|---|---|
| 2da3e263/0011550f | model-sync feedback（SystemPage/catalog refresh UX） | defer：LTS 无 `hooks/useModelCatalogSync`、无 `modelsApi.refreshCatalog`，上游改的是 LTS 不存在的 catalog refresh 基建；移植需先建该链路（非纯文案） |
| 1e29f88f | plugin store 安装与插件变更互斥锁 | **下轮 adapt-port 候选**：LTS /plugins 与 /plugin-store 为独立路由，但路由切换不中断在途请求，「删除中转 store 安装」竞态真实可达；需跨路由共享 busy 信号 |
| 18906172 | Codex credit 超支展示 | defer：依赖上游 quota 页面结构 |
| 28182ef9/a4bad6e3 | plugins 页面族重构 | defer：依赖上游页面结构 |
| 4a605466/b616482b/6cc19fed | 卡片布局/时间线分组 UI 族 | defer：UI 重构族 |
| 6b1b94a7/96ce4e1b | login proxy 字段 | defer：OAuth 页结构差异 |
| 3d893ec8 | AutocompleteInput | defer：通用组件重构 |
| 99a95c4a | modelCatalogSync | defer：同 2da3e263 基建缺失 |
| 7b754b23 | useConnectivityTest 测试 | defer：依赖上游 providers 目录结构 |

`defer` 是可见 backlog，不计为已移植。
