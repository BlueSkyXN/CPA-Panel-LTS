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

重复 key/base URL 身份、共享组单行修改 base URL 等歧义操作明确拒绝，使用 YAML 编辑器处理。高级策略的显式继承意图、全量原生 group UI 未实现。

YAML 每次读取返回不可变的 content/generation/layout/revision 快照；其他编辑器的读取不能替换本草稿使用的版本。确认保存仍复读并重建差异，最后 PUT 携带该次读取的 `If-Match`。Provider 分组写入同样携带文档版本，由 Core 在锁内做条件写入（CAS），堵住最后读取到 PUT 的竞态。普通表单保存同时比较打开时的 provider 快照；全局 store 刷新不能使旧表单覆盖新字段。Sponsor 表单在首笔写入前校验最新聚合快照，各现有协议更新继续校验对应记录。

OpenAI-compatible 删除和启停必须传入选中时的原始 provider 快照，检查名称唯一、backend sourceIndex/当前位置和归一化可编辑字段一致；列表重排、目标缺失/改名、同名歧义或字段变化均在写请求前拒绝。工作台、旧 provider 页面、Sponsor 聚合删除/启停及表单移除协议都使用此保护。快照在操作入口复制，其他读取不能替换它。目标未变时基于最新列表只删除目标或修改 disabled，保留其他 provider 的并发更新，再使用最终文档 `If-Match`；不把操作开始时的全局 store 当作原始目标证据。Sponsor 删除/启停额外在首个协议写入前核验聚合快照，多个 OpenAI 目标按原始 sourceIndex 降序删除，逐笔读取新文档版本。

v8 必须有配套 Core 的 `ETag` 支持，否则拒绝保存并提示升级；缺失版本 428、过期版本 412 均不重试、不降级重放。legacy/v7 的 OpenAI 删除/启停也先校验目标快照，再使用已存在的按名称 DELETE/PATCH，避免再次依赖旧下标；但读后写仍没有服务端 CAS，不能保证同时改名、同名重建或新增重名记录等竞态下的事务安全。多协议 sponsor 操作不是整体事务，部分成功仍走既有恢复流程；无条件 v0 客户端和同时写文件的外部进程也不在保护范围内。不得宣传为无条件多写者安全。

本轮逐提交取舍见 [2026-10-03 intake](upstream-intake-20261003-v8.md)。延期项不属于已移植功能。

## 验证

- `npm run test:config`：包含真实 visual hook 的 legacy/v8/mixed、client-key/provider隔离、false/0优先级、payload AST与注释测试。
- `npm run test:api-client`：包含配置域版本分流、旧连接延迟返回、独立 YAML 快照、七类 provider 旧表单、真实 workbench hook 快照传递与启停保护、sponsor 首写校验、正常保存，以及最终读取后的 412 不重试/不 fallback。2026-10-04 补修新增 78 项用例：v8/legacy 的 OpenAI 删除、启用、禁用；旧目标与已刷新 store 遇到重排/插入/删除/改名/字段变化/重名时零写入；正常操作、backend sourceIndex、其他 provider 更新保留、Sponsor 多目标连续操作及跨协议首写拦截。补修前的 API、workbench 和 Sponsor 三条旧目标删除回归均实际失败，补修后通过。
- `npm run validate:lts`：保留完整 usage、Flow、plugins、provider 合同和 single-file 构建。
- 前次 intake 做过临时 v7/v8 API 读写与浏览器可视化保存。本次修复另外使用实际 Panel API modules 对接隔离 Core 的 legacy/v8 配置实例，验证 group 保存、旧表单拒绝、旧 YAML 412、fresh YAML 保存和 legacy 不隐式迁移。
- 2026-10-04 删除/启停补修的 `npm run validate:lts` 通过，lint 仅保留未修改的 `useConnectivityTest.ts:174` 既有 warning。实际 Panel API 模块对接隔离 v8 Core：通过 v8 API 重排后刷新 store，旧目标删除/启停被拒，YAML 原始字节不变；重新读取目标后禁用、启用、删除均成功且 sibling 保留。联调初次将省略的 `disabled: false` 当成显式 false 导致夹具断言失败；核对 Core `omitempty` 后按 false 默认语义重跑通过。
- 浏览器回归仍未完成 authenticated GUI 验收。本次当前构建可打开、可填写合成测试口令；登录 locator 超时，DOM 节点点击也没有页面变化。诊断捕获到点击事件 0、XHR 请求 0、页面错误 0；按钮未禁用且样式可见，但 `document.visibilityState` 为 `hidden`，Core 日志也未出现登录对应请求。证据定位在请求发出前，不据此判定产品登录失败，不通过延长超时或修改客户端绕过。前次 GUI 结果不替代本次回归，API 联调通过也不等于 GUI 通过；保留 Draft，未验证的平台和真实部署不可由本地测试推断。

上游参考固定为 `ee79a794526a30c03748a8864a9ac6589a31833b` 的配置分域和写入语义；采用局部适配，不 full-sync 官方 Panel、不替换 LTS usage、quota 或插件页面。
