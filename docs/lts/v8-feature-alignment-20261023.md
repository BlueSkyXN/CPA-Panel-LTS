# V8 功能补齐

本轮在 `b4afed76` 上接入此前延期的操作和 provider 页面，配套 Core 为
`afc1f234`；官方 Panel 参考源码为 `714de076`。保留现有 LTS 页面结构、完整 usage、Flow、插件门控和配置条件写入。

| 功能 | 入口与行为 |
|---|---|
| 凭据 token 刷新 | Auth Files 单卡“更多操作”、所选凭据批量操作、页头“刷新全部 token”。执行前确认，按 name/auth_index 定位；批量结果只保留标识和成功状态，操作后失效凭据派生缓存并回读。结果未知时提示核对，不自动重试。 |
| 清除冷却 | Auth Files 单卡“更多操作”。确认后调用 `/v8/management/routing/cooldown/reset`，核对响应 auth_index；这是用户主动的账号/模型冷却清除，不混入额度刷新。 |
| GitHub token | 配置页服务管理中的密码输入框，映射 `server.github-token`；沿用 YAML、同源 ETag/If-Match、差异确认与保存后回读。 |
| Devin | OAuth 登录、完整回调 URL/state 校验、取消会话；凭据和额度页的每日/每周额度、计划和重置时间；配置页 Devin sensitive-words。额度请求合并同一凭据的并发读取，最多三个上游请求，排队和返回时核对连接与文件代际。 |
| Meta | OAuth 设备码及取消、API-key Workbench 新建/编辑/禁用/删除和模型测试、额度页的窗口/每周余量及订阅状态。DCA token 仅存在于一次额度请求内；不回退为模型 API key，不进入 quota store、提示或存储。 |
| Claude reset grants | Auth Files 的“更多操作”和 Claude 额度卡中的重置次数窗口。读取 cedar_ember 状态，使用前确认并重新读取组织与资格；结果未知时只允许在有效期内手动复用同一 request_id。不开启自动消费，不调用通用冷却清除。 |

共享文案覆盖 en、zh-CN、zh-TW、ru。新的额度页面复用现有 quota cards，
没有引入官方整套页面重写、额外语言或商业推广入口。

## 验证入口

- `npm run validate:lts`：包含 `v8Alignment.test.mjs` 的凭据身份、回执脱敏、
  配置往返、额度解析、请求代际、Meta 条件写入与 Claude 幂等重试回归。
- `npm run smoke:v8-alignment`：使用合成 localhost 数据，检查刷新/冷却确认、
  Devin/Meta 额度和 OAuth、Claude 未知结果恢复、Meta 原生配置与 GitHub token 保存。
- `npm run smoke:lts`、`npm run smoke:lts:core -- --core-dir <Core v8 checkout>`：
  保留完整 LTS 页面及临时真实 Core 的回归入口。

以上测试不执行真实第三方授权、真实模型推理或额度消费。真实账号验收和线上
已登录态全流程需要单独记录；构建与合成流程通过不能替代这些结果。

## 仍保留的差异

本记录补齐具体业务能力，不改变此前所有 selective-port 决策。官方页面整体重写、
vi/ko、多项新增配置控件与 credential policy 编辑、API-key 名称存储等未在本轮接入。
商业推广入口继续按 LTS 约定排除；V8-only 支持边界保持不变。

前两轮逐提交记录分别见 [10 月 3 日 intake](upstream-intake-20261003-v8.md)
与 [10 月 23 日 intake](upstream-intake-20261023-v8.md)。其中本表列出的延期项由本轮
实现接替，历史提交分类数量保持原始记录，不作为当前总功能完成率。
