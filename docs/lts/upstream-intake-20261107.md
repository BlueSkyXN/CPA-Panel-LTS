# V8 上游增量审查（2026-11-07）

Panel 从官方 main `64b4f5aed19b8f791eb21eb9e785ea379ea05b44`（2026-10-28 intake 终点）
之后继续审查，到 `953fb2444350c6c36052dda46cac0abce6b23ea6`，共 30 个 first-parent
提交，跨上游 v1.26.x → v1.27.3。配套 Core 同步目标为 CPA-Core-LTS 堆叠 PR
（#338/#340/#341）所到 `c2f402b45643f0740d70b9010fd7d8d0aab7ef65`。

## 分类总表

| 上游提交 | 分类 | 处理与依据 |
|---|---|---|
| `38990aec` | direct-port | Panel commit `7263bdb2`：Grok client 版本 1.0.46 → 1.0.70，常量与 xAI header 断言同步。 |
| `94a5b84d` | adapt-port | Panel commit `14dfc71d`：`crypto.randomUUID` 在纯 HTTP 部署不可用，reset grant 请求 ID 改为 `getRandomValues` 16 字节回退，native UUID 优先。落地在 LTS 自有 `src/components/quota/claudeGrants/`。 |
| `82f6abbb` | direct-port，部分延期 | Panel commit `845455ed`：GPT 家族吸收 `codex-*` 模式，新增 xiaomi/stepfun 家族与亮色图标、测试。upstream 的 light/dark 双图标渲染属更早未接入族，dark 变体随该族延期。 |
| `953fb244` | reject | aiCodeMirror 是带 `AI_CODE_MIRROR_AFFILIATE_URL` 的返利/推广型第三方中转 provider；商业推广入口按 LTS 约定排除。 |
| `18f88de6` | reject | Double 11 campaign card，商业推广。 |
| `e1295b5a` | reject | tr locale 引入新语言基建并改写 upstream `AGENTS.md`；LTS 保持四套 shared locale + `*.lts.json` overlay 契约。 |
| `eea7482e` | reject | AuthFilesToolbar 样式修复在 LTS 无落点（authFiles 工具栏结构不同）。 |
| `fe07ee8e` + `24f78e86` | defer | plugin OAuth multi-entry 特性从未接入 LTS（`plugins.ts` 无对应 normalize 链）；decode 修复随特性族一起延期。 |
| `c582a21a` | defer | 成功消费 reset grant 后自动调用通用冷却清除，与 10-23 功能对齐记录的「不开启自动消费，不调用通用冷却清除」决策冲突；是否翻案由用户决定。 |
| `fe01421b` / `24057044` / `46400473` | defer | quota timeline（DST、used-fill、weekly window）是官方 timeline 组件族；LTS 复用现有 quota cards，无 timeline 落点。 |
| `cef297bf` / `40be748f` / `dad572d3` / `d1a8e91f` / `0fc9aa68` / `f154fa93` | defer | PlanBadge、QuotaTierPreview、plan tier 重构、Kimi plan 名称、elite 玉质样式均为官方 quota 卡重写族；LTS 维持现有 quota cards（10-23 记录）。 |
| `4772bd43` / `bc470e10` / `8bfe68e7` / `3432360b` / `5c57cc00` / `e0d229c2` / `eb044d87` / `4e4aeff2` | defer | 登录页整体重写（DotMatrixHero、login transition、auto-login、移动端 banner），属既有「官方页面整体重写」延期类。 |
| `1650cf2f` | defer | storage encryption v2 + legacy key 迁移与登录 wave 绑定，触碰 protected storage 域且有存量数据迁移风险；安全相关性单独提请用户留意。 |
| `b87cc2d1` | defer | 新增 routing 管理页 + 481 行 `services/api/routing.ts`；大型新特性，另行安排专项接入轮。 |
| `34195628` | defer | quota-limit-labels 为 locale-only 修复，依赖官方 quota 卡族文案结构；LTS quota 卡无对应键。 |
| 合并提交 `fe07ee8e` `34195628` `fe01421b` `24057044` `46400473` `c582a21a` `94a5b84d` `82f6abbb` `e1295b5a` | — | 分类以上表各行为准，不单独重复计数。 |

## Protected delta review

- 完整 usage 页面、导入导出、事件、定价和 provider 状态条未触碰；本轮三个移植项均在 usage 保护面之外。
- `claudeGrants` 是 LTS 自有实现：request-id 回退只替换本地随机源，不改变「结果未知不自动重试、不自动消费」语义；`ANTHROPIC_RESET_REQUEST_ID_RE` 校验保持。
- xiaomi/stepfun 是 SystemPage 展示族分类，不触碰 API client、auth-file 统计或 Core 契约。
- Grok 版本号仅影响面板发起的 xAI 额度请求头，与 Core 的 xAI 执行器无关。
- 四套语言、`management.html` 单文件产物、插件能力门控、npm/lockfile 均未改变。

## 验证

`npm run validate:lts` 通过（结果见 PR）。新增 `resetGrantRequestId.test.mjs`（7 项）与
`src/utils/models.test.mjs`（4 项）分别接入 `test:auth-files`、`test:ui`。

`npm run smoke:lts`、真实 Core smoke 未运行；本轮无交互/路由变更，构建与单测按
AGENTS 验证标准视为最小充分集合。

此前延期项（登录重写、quota tier 族、routing 页、plugin OAuth entries、storage
encryption v2、tr locale）如需接入，请单独立项并明确授权。
