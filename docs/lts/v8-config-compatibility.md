# v8 配置契约（V8-only）

自 2026-10-05 起，Panel 只配套 CPA-Core-LTS v8 版本线。用户按 v8 教程重新配置 Core；Panel 不再兼容 v7/v0 配置、不检测 legacy/mixed 布局、不通过 `/v0/management` 写任何配置。此前 2026-10-03/04 的“按布局分流”方案已被本文件取代（历史见 git 记录与 [2026-10-03 intake](upstream-intake-20261003-v8.md)）。

端点归属见 [v8 endpoint map](v8-endpoint-map.md)。

## 连接与客户端

- `apiClient` 固定访问 `/v8/management`；`ltsExtensionClient` 只承载 Core 没有 v8 等价路由的 LTS 扩展（完整 usage、usage query、Flow、插件 readiness 与插件自有路由、单凭证模型刷新、Home `/nodes`），访问 `/v0/management`。两者共享同一 transport：base URL、management key、connection generation、session write freeze、能力响应头与 401 处理。
- 登录、恢复会话和连接测试以 `GET /v8/management/config.yaml` 的合法 V8 文档及 ETag 验证连接，不依赖插件私有配置能否转成 JSON。只有该 V8 路由返回 404 且同一凭据能读到 `/v0/management/config` 时才诊断旧后端（`LegacyBackendError`）；v0 响应绝不作为数据或登录回退。
- 结构化配置保留 `/config` JSON 快路径。仅 `422 config_not_json_compatible` 启用所需配置子节点读取；所有响应（含缺失节点的 404）必须与原读取具有相同 ETag，且连接代际未变化。投影视图不带 `raw`，不能作为完整配置回写。其他错误仍由配置 store 保留并显示。

## 配置写入：ETag + If-Match

Core 对 `/v8/management/config*` 的每个 PUT/PATCH/DELETE 都要求恰好一个强 `If-Match`，值等于当前持久化文件的 sha256 ETag；缺失返回 `428 config_revision_required`，过期返回 `412 config_revision_conflict`。写成功后响应 ETag 为空。Panel 的规则：

- 由读取数据推导出的写入（provider 分组、client API keys、OAuth excluded/alias map、Ampcode 节点、插件配置、YAML 编辑器）必须携带**同一次读取**响应里的 ETag。
- 独立标量（请求日志开关、插件 enabled）写入前读取当前 revision（`GET /config.yaml`）再提交。
- 412/428 以冲突形式交给调用方（`isConfigRevisionConflict`），不盲目重试、不降级到 v0。
- 每次写入后都重新读取；ETag 不跨写入复用。
- `GET /v8/management/config` 及子路径在 404 时同样返回 ETag，缺失字段也有版本。

## Provider（Workbench）

- 读：页面使用结构化配置视图；写操作直接读 `GET /v8/management/config/api-keys/{family}`，sponsor 快照读 `/config/api-keys`。Core 在子节点 JSON 视图同样注入 `auth_index`（官方拼写为 `auth-index`，两者都读），不再合并独立运行时列表；插件非 JSON YAML 不阻断 provider 管理。
- 写：`PUT /v8/management/config/api-keys/{family}`，按官方原生层（ee79a794）以持久化组快照（`ProviderSource`）和 `sourceIndex` 定位目标，只写变化字段，保留组名、共享策略、显式 null 继承、未知字段与模型元数据；模型改名按 `sourceIndex` 保留 force-mapping 等元数据（F23）。写前剥离 `auth_index`/`auth-index`。
- 目标已被他人修改时，基于旧快照的更新/删除在写请求前拒绝；读取与 PUT 之间的并发写由 Core 412 拒绝（F22）。
- 凭据编辑不能修改组级 `base-url`；从详情/编辑页的「编辑配置分组」入口修改组名、共享地址和重试/冷却/错误规则默认策略。提交前确认影响数量，写前核对整个组及成员快照，写后读回核对。分组重排可按唯一快照定位；成员变化、重复快照和 412 均拒绝继续。key 的已有覆盖值与未知字段保留，不自动拆组。OpenAI 原有整组编辑保持不变，sponsor 的非 OpenAI key 走相同组级边界。
- 不再存在布局分类代码与 legacy 反向适配器（F21，`npm run check:lts` 守护）。

## 配置编辑器

- 源码与可视编辑统一使用 `GET`/`PUT /v8/management/config.yaml`；保存前复读并比较内容，确认无变化后以该次读取的 ETag 提交，成功后复读。
- `/config.yaml` 总是返回 canonical v8 树。可视编辑器仍以历史字段名组织界面，`src/utils/v8VisualProjection.ts` 把 canonical 节点投影到这些字段，并把改动映射回 canonical 路径；不再判断或接受其他布局。client keys 只映射到 `access.api-keys`，provider `api-keys` map 不参与；未知 YAML、插件 opaque 配置、payload AST 与注释保留。

## LTS 能力保留

完整 usage（导入/导出、事件、定价）、Flow V3、插件能力门控与 readiness、PAT 账号、Codex quota/reset credits/remote cloud、Ampcode（`/ai-providers/ampcode`，单次 `PUT /config/ampcode`）、赞助商 code0/infistar/fennoAI/qiniuCloud（及仅按配置识别、无推广链接的 Kimi）、provider 状态条（Workbench 中以完整 usage 的 auth-index 归因为主，recent requests 仅在 usage 关闭时回退）、主题/导航与多实例连接均保留。

## 已知边界

- 连接不提供 `/v8/management` 的 Home 控制面无法使用本 Panel。
- 插件配置的非字符串 map key 返回 `422 config_not_json_compatible`；普通结构化页面读取所需子节点，插件 JSON 表单提示转到 YAML 源码编辑。YAML 保存保留原有节点语义，未将插件配置转成 JSON 后回写。
- `configPatch.applyConfigPatch` 的多步计划只把第一步绑定调用方 revision，后续步骤复读 revision；需要原子性时使用单次 PUT。
- 多协议 sponsor 操作不是整体事务，部分成功走既有恢复流程。
- Core v8 对 provider/model/thinking 配置做严格 schema 解码：未知字段（如 `x-*` 扩展字段）会被 `400 invalid_config` 拒绝。Panel 的“保留未知字段”只对 Core 接受的字段有意义；高级 thinking JSON 中的自定义字段会在表单中显示 Core 的拒绝信息，不会落盘。
- 整文档 YAML PUT 丢文档尾注释的问题已由 Core `4ce50920` 修复；仍由真实 Core smoke 保留回归覆盖。

## 验证

- `npm run test:api-client` / `test:providers`：client 共享状态与 scope、v8-only `config.yaml` 修订写入、合成 v8 Core 下的 If-Match 同源、412/428 不重试、写后重读、F22/F23/F24、运行时策略继承意图、configPatch 修订绑定、Workbench 完整 usage 状态条。
- `npm run test:config`：canonical v8 可视投影、payload AST、cache affinity、敏感词等。
- `npm run validate:lts`、`npm run check:lts`。
- `npm run smoke:lts`：mock v8 Core（强制 If-Match、412/428、`auth_index` 注入、v0 仅限扩展路由）下的浏览器全流程。
- `npm run smoke:lts:core -- --core-dir <CPA-Core-LTS v8>`：真实 Core（临时目录构建、纯 v8 临时配置）下的登录、配置页 If-Match 保存回读、Workbench 继承/覆盖策略与磁盘 YAML/`auth_index` 回读、完整 usage 状态条、usage/Flow/插件页面；Core 缺陷会单独列出并使 smoke 失败。
- 本地 smoke 不代表部署、发布或线上验收。
