# v8 开发线配置兼容

此候选仅供 `v8-dev` PR 评审，不代表 main 或已发布 management.html 已升级。

## 适用 Core

- v7 CPA-Core-LTS：继续使用 legacy YAML 与 `/v0/management`。
- 配套 v8 CPA-Core-LTS：保留 v0 structured config/usage/Flow/plugin APIs；配置文档可采用 legacy、canonical v8 或 mixed 布局。Provider 写入按当前布局分流：legacy 使用 v0；v8/mixed 使用 `/v8/management/config/api-keys/<family>`，不经 legacy 展平再保存。
- 不承诺可管理已删除 v0 业务 API 的官方原版 Core v8。本改动不是全局切换 API prefix。

## 配置编辑

原始 legacy 文档继续通过 v0 读写，不因为连接到新 Core 自动迁移。

发现 v8/mixed 后，配置域读取 `/v8/management/config.yaml` 的 canonical YAML 视图，视觉编辑器将已支持字段投影到既有 UI，再只把实际改动写回原文档相应 canonical 路径。client keys 始终映射到 `access.api-keys`，provider `api-keys` map 不参与数组写入；未知 provider 配置、插件 opaque YAML、payload AST 和 LTS 扩展保留。

v8/mixed 的保存通过 v8 YAML API。canonical GET 不写盘；确认保存会规范化 mixed/历史别名，差异预览比较 canonical 视图，不能将其解释为磁盘逐字 diff。布局切换不是普通编辑操作，保存中检测到布局变化必须重新加载。

Core 侧必须同时拒绝旧缓存 Panel 的危险 v0 raw 替换；仅发新版 Panel 不能保护尚未刷新的浏览器。失败写入不会自动切换 API 版本重放。

连接 generation 用于拒绝旧配置响应及后续写入，仍复用既有 session write freeze。配置错误形状/读取失败不能当空配置。

## Provider 分组编辑边界

普通行编辑保留组名、共享策略、未编辑 key、显式 null 继承与隐藏模型元数据；删除 key 不拆分剩余组。模型重排/改名通过原始 sourceIndex 绑定元数据，发现同名不同 alias 不合并。

重复 key/base URL 身份、共享组单行修改 base URL 等歧义操作明确拒绝，使用 YAML 编辑器处理。高级策略的显式继承意图、全量原生 group UI 未实现。保存前复读可检测已发生的并发变更，但不是服务端 CAS；最后读取到 PUT 之间仍有竞态，旧表单与独立刷新后的全局 store 也尚未获得完整快照隔离保证。不得把当前候选宣传为无条件多写者安全。

本轮逐提交取舍见 [2026-10-03 intake](upstream-intake-20261003-v8.md)。延期项不属于已移植功能。

## 验证

- `npm run test:config`：包含真实 visual hook 的 legacy/v8/mixed、client-key/provider隔离、false/0优先级、payload AST与注释测试。
- `npm run test:api-client`：包含配置域版本分流、旧连接延迟返回和禁止写入 fallback。
- `npm run validate:lts`：保留完整 usage、Flow、plugins、provider 合同和 single-file 构建。
- 临时配套 Core 分别做 v7/v8 API 读写；实际浏览器确认 v8 可视化保存与独立 readback。未验证的平台/真实部署不能由以上测试推断。

上游参考固定为 `752e0ee772220ce49aae1221a3f39f23236590d7` 的配置分域和写入语义；采用局部适配，不 full-sync 官方 Panel、不替换 LTS usage、quota 或插件页面。
