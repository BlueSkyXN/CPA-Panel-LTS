# 2026-09-07 分支收尾与上游 selective-port

## 范围与基线

- 本仓：`BlueSkyXN/CPA-Panel-LTS`，起始 `main == origin/main == 4560bd9aa7b108be8e36465f28d297e3a4e89201`。
- 上游：`router-for-me/Cli-Proxy-API-Management-Center`，`main = cb917b3111196487549f7a43e3afce4801f5d0f0`（`v1.22.14`），`dev = 5b4d52b38929454491674e130d7368c908353e65`。
- 七天窗口：`2026-08-31T20:50:08+08:00` 至 `2026-09-07T20:50:08+08:00`，按 committer time，main 共 13 个非 merge 提交；另补查上次审计之后、窗口之前的 2 个提交。
- Core 合同核对：本地干净 `CPA-Core-LTS main`，`e3fd3ba28825835f3de744ec8c11bc256b2171f2`；`internal/config/config_types.go` 的 `AntigravityConfig.SensitiveWords` 对应 `antigravity.sensitive-words`。
- 使用 fetch、分支祖先关系、逐提交 diff、文件内容和 patch-id 判断；没有 full-sync，没有 prune、GC、删除分支或恢复整份旧 stash。

## 自有工作盘点

| 对象 | 当前证据 | 处理 |
|---|---|---|
| 当前 usage 工作区 | 27 个文件，包含已有价格/时间范围工作与返回包增量 | `f4a9c26` 完整提交；保留原有 6 个时间范围测试，补入 18 个用例；不覆盖 Core。 |
| 本地与云端 `feat/aurora-themes-tower-only` | head `ba379ed` 是起始 main 的祖先，main 领先 12 个提交 | 已由 `58684fb` 合并，无独立未交付差异，不重复合并。 |
| `cpa-panel-release-20260907` detached worktree | 基线 `259af3c`；两处 dirty diff 是 Flow 恢复观察后刷新策略及其 smoke | 两个文件的内容与 `4560bd9` 完全一致；工作已经进入主线，保留副本不重置。 |
| `cpa-panel-v1-lts-0.0.17` detached worktree | 干净，HEAD 为 `4560bd9` | 发布时的验证副本，无待合并代码；不删除。 |
| 开放 GitHub PR / stash | 起始开放 PR 为 0，stash list 为空 | 无隐藏的开放交付链。 |
| 已关闭未合并 PR #1 | `3cc644e1` 的单凭据 in-flight 防重入 | 当前 `QuotaSection` 和 `66d8964` 已保留 loading、in-flight、reset 排他；不恢复旧版本。 |
| 已关闭未合并 PR #2 | `e4b39fff` | patch-id 对应主线 `92bff0a6`，不重复提交。 |
| 已关闭未合并 PR #67 | `8db71b5` 的空商业隐藏名单 | 维持拒绝：空名单没有当前收益，商业名单不应控制已配置账号可见性。 |

扫描到 41 个 unreachable commit，它们不是 41 项待合并工作。近期对象逐项归类：

| 恢复对象 | 主线对应或差异结论 |
|---|---|
| `c8783dd6`、`3dd4fee1`、`2fb8192a`、`898ccc0b`、`008eaec9`、`5b46d29f` | patch-id 分别对应 `446f604a`、`b6c3eee7`、`ca309599`、`356bf2c8`、`0266bd42`、`2355c2e7`。 |
| `f8b41b30`、`3bb02008` | patch-id 对应 `0ffda737`、`37f1cf21`。 |
| `631eb297`、`b753d7b0` | first-content 工作已进入 `4c9a9b1`；与该成品相比的额外差异仅是后来合入的 release workflow/contract 文件。 |
| `eaaf2e89` | `ttfr_ms` 原型假设与当前 canonical `ttft_ms`/`ttfa_ms` 合同不同；由 `4c9a9b1` 在 Panel 派生 first-content，不恢复错误语义。 |
| `aaae7d1`、`c7529f57`、`fe95695c` | Next/compact-sidebar/usage 原型已被拆分提交和当前 Tower-only/Aurora 实现覆盖；性能公式、身份掩码和对应测试仍在。旧布局与旧主题不恢复。 |
| `291ed93f`、`b472dc02`、`096bc225` | stash index 快照，不含独立业务工作。 |
| `d16315e5`、`1e86ba04` | 已恢复到本轮输入的时间范围/价格工作，现由 `f4a9c26` 与完整测试交付。 |

更早的恢复对象延续 2026-08-29 审计结论，并回查当前代码：单凭据刷新由 `66d8964` 保护；GLM 定价对应 `cfac804f`；service-tier 对应 `51fbec3c`；OAuth force mapping、自定义排除和 dirty-state 测试仍在 `oauthConfigLoadGuard.test.mjs`；官方插件必须同时满足 source 与 repository 的测试仍在 `pluginResources.test.mjs`。不恢复旧 usage token/import 原型以覆盖 canonical v3。

## 上游七天逐提交决策

接受的代码位于 `9d73e31`；这是人工适配，不表示上游提交成为 main 的祖先。合并和精确 head CI 由对应 GitHub PR 记录，发布/部署不属于本次范围。

| 上游 SHA | 分类 | Diff 与 LTS 决策 |
|---|---|---|
| `97fbadd7f51edcd899870cca3e7956f3cb35bb81` | `adapt-port` | 接纳 Cmd+B/Ctrl+B；复用 Tower 现有键盘监听器，保留 Cmd+K；增加输入区、组合键、连发、输入法及 dialog 防误触。不复制上游侧栏/tooltip 布局；Bun 测试改为 Node。 |
| `c4bb60dc66500df24e4edc9860ce6b5eae3215cc` | `reject` | 只将 System 链接图标统一硬编码为深灰，没有接口或交互修复。保留现有 GitHub 深灰、文档绿色和 LTS 主题语义色，不把不同视觉方案判成缺陷。 |
| `9731ca4de08867d8920b6312df985291ae727c40` | `defer` | 只修改替代架构中的 AuthFilesToolbar/ModeSwitch；LTS 使用现有 Config/凭据页面和自己的选中态。不能为复制两段样式引入未接纳的整套 Config/Vault 重构。 |
| `e5d462646e1cdc7464448010c6c953fa2aa31ce0` | `adapt-port` | Sheet 挂载时原 transition 缺少可保证的初始帧。接纳 keyframe 进出与 reduced-motion，退出仍为 280ms，匹配现有组件卸载时钟；保留 LTS 背景/阴影，不复制额外 blur 与硬编码阴影。 |
| `edd3ea2733b515fe241dc912857945c324d8b32c` | `reject` | Kimi 按语言选择 affiliate 注册链接，违反商业中立约束。 |
| `49d51030cfcbaeefb83a2781908085a23dd287a3` | `reject` | Kimi 注册按钮、推广徽章及充值返利文案，无独立维护修复。 |
| `af4eb92eb7291ca8865a3103e4a92fa7f3b3656d` | `defer` | 真正功能增量是 Kimi 专属品牌聚合 Codex/Responses 配置，并非普通 Codex 协议支持缺失。LTS 未接纳该专属品牌；现有 generic Codex 可保留自定义 base URL。需未来连同品牌识别/索引/CRUD/端点验收适配，附带推广样式不接纳。 |
| `1bcef173ebf7a47a3a9bd41a52151dde258e4b9d` | `reject` | 仅为已拒绝的返利活动增加到期日。 |
| `ad262411c17859279019d73e5a6378d5218c99e6` | `adapt-port` | Core 已支持 `antigravity.sensitive-words`。在现有 VisualConfigEditor 增加列表、类型、dirty tracking、YAML 读写、四语言及合同/smoke；保留未知同级字段、注释和独立签名开关，不复制新 Config shell/search-index。 |
| `451f1868207484fd270ef1eb9aaaf5ceb457dfd6` | `reject` | 上游 README 将最低 Core 版本改为 7.2.147 并移除远程示例；LTS 使用自己的 companion Core/基线和本地示例。不能未经兼容性判定照搬最低版本声明。 |
| `87b7ce149194722edeedc359547e536608f48d5f` | `already-equivalent` | 上游移除 code0/claudeApi 快捷品牌并改写协议分流；LTS 的 `CONFIG_DETECTED_BRANDS` 已无空配置推荐，且保留已配置品牌及 sourceIndex/未知字段。无需商业名单驱动的隐藏/重新分组。 |
| `731347988b1f7580c1c2a6730407f1470184e1e4` | `adapt-port` | 补入确实缺失的 6 项俄语 auth-file headers 文案。6 项 Codex reset 文案已在 `ru.lts.json`，不复制到 shared locale；新增 Node 测试验证两部分均不回退中文并正确插值。 |
| `cb917b3111196487549f7a43e3afce4801f5d0f0` | `reject` | 上游 AGENTS 文档要求 Bun、Node 24、普通版本 tag 和不同目录架构；本仓已有更具体 LTS router/cards，不能覆盖 npm、Node 20 与 `v*-lts-*`。 |

窗口内 merge commit 只承载上述代码；没有独立需要移植的 conflict-resolution hunk。额外补查：

| 上游 SHA | 分类 | 理由 |
|---|---|---|
| `335bb20143edeb72a21725d331fe3f7fed6b9bb8` | `reject` | 窗口前的 lmuAI 商业名单隐藏，不属于已配置账号管理需求。 |
| `e0ee7123dfb5aa89a14ff73ac5a5c3bf4db658e0` | `already-equivalent` | 窗口前的 quickFill 文案修改；LTS 无该推广入口或对应 key，不新增无消费者文案。 |

## 未进入上游 main 的观察项

| 对象 / 精确 head | 分类 | Diff 判断与重新评估条件 |
|---|---|---|
| `dev` / `5b4d52b38929454491674e130d7368c908353e65` | `defer` | OAuth provider card、alias row、共享 shell 和两套页面 SCSS 重构（14 文件），不更改当前认证协议。等待 main 接纳后，连同 LTS load/dirty/force mapping/排除规则验证整体评估。 |
| PR #416 / `dd909847d4189c63d3b7c2ffa1ecd7442c449834` | `defer` | 新增 `spend_control.individual_limit` 月度 credit budget，区别于滚动窗口、reset credit、USD 余额。没有本轮真实账户 payload 验证，且目标是上游 quota timeline；不得套用 USD 或重置窗口语义。 |
| PR #413 / `2aab1612fe8f1e010abd5298f0b68a628ea972e2` | `defer` | iframe postMessage → 带管理权限的 scoped API bridge，允许 POST/PUT/PATCH/DELETE。属于新增信任/权限边界，需 plugin scope、连接切换和请求竞态的独立审查，不因是官方 PR 就先放行。 |
| PR #376 / `51526bf268c0ed2126d484396c9758a3ea9902c9` | `already-equivalent` | 上游批量 Codex 串行化；LTS `codexQuota/config.ts` 已设置 `CODEX_BATCH_CONCURRENCY = 1`，`useQuotaLoader` 使用有界 worker；不复制新 quota hook 或夹带 AGENTS 改动。 |
| PR #366 / `4b9aea672d2682827954dd73d0a2baa6c271ed7b` | `defer` | 引入 `/plugin-proxy`、`/plugin-proxy/validate` 以及 plugin store API 重组；本轮 Core 未发现对应路由。先等 Core 合同，不能新增不可用配置页。 |
| PR #382 / `d6298ef62255c807fd97ab638d8a28942cb2140e` | `defer` | 新增第五种语言 vi，涉及 language type/初始化/全部目录；当前 LTS 约定四套 shared+overlay，需完整 locale 交付而非复制一个翻译文件。 |

## 验证边界

- `npm run validate:lts`：260 项 Node 测试及 contract、type-check、lint、single-file build 通过。`eslint` 排除已由 Git 忽略的 `local/**` 交付材料，避免把包内其他仓库源码当 Panel 交付物。
- 浏览器验收覆盖 `/usage/events` 的 625 条翻页/全量导出/固定表头/窄屏，旧 Sol 自定义价格保留，Ctrl/Cmd+B、输入区不拦截、Sheet reduced-motion，以及 Antigravity Visual → YAML 保存。
- 真实 Core 使用临时配置、临时凭据和独立端口；`--no-write-smoke` 跳过额外 API 写测试，但保留浏览器在临时配置上的保存/回读，不连接生产实例。
- 浏览器执行结果与 GitHub 精确 head CI 以本轮 PR 的最终验证记录为准；本文件不将测试程序存在等同于已通过。
- 未创建 Release、未推送 tag、未部署。完整 usage 下载仍是 Core 全量快照，前端分页不冒充服务端分页。
