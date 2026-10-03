# 2026-10-03 v8 development selective-port intake

## Scope and provenance

- Candidate starts at `4613af11dfe3b18ec2dae2ba9ccbaf7bed28a1b5`; PR #98 targets `v8-dev`, not `main`.
- Last audited main: `ed5f1c48e11ba7335f1e8f676f228c280196af85`; previously audited dev: `7aa8618ad2ce1677260c08d9b597377d5661d160`.
- Frozen official main: `752e0ee772220ce49aae1221a3f39f23236590d7`. This is selective-port coverage, not merge ancestry. No claim about a later upstream head or unreviewed dev.
- 92 non-merge commits reviewed, including 5 previously reviewed dev commits (87 newly reviewed). `partial` and `defer` remain visible backlog, never counted as fully ported.
- Core companion PR #290 incorporates official main through `d7914afdedca7af95ee974a42453dc49fc1388ce` with protected full-sync.

## Decision totals

`adapt`: 24, `defer`: 48, `equivalent`: 10, `partial`: 5, `reject`: 5.

## Protected delta review

Full usage, canonical-v3 import/export, request events/timing/tier, local pricing, provider status and credential attribution remain intact. Flow V3, Home logs, PAT accounts, plugin capability/readiness gates, Codex analytics/reset-credit/remote-cloud sidecars, npm/package-lock and `management.html` are retained. No dependencies, release automation or agent instructions are changed.

Legacy configuration keeps v0 writes. Canonical/mixed v8 provider edits use the native family subtree, preserving group names, inherited nulls, sibling keys, policies and unknown model metadata. Ambiguous duplicate key/base URL identities and shared-group base URL row edits fail explicitly instead of flattening groups. Advanced group/policy intent remains YAML-only. Read-before-write conflict checks are **not server-side compare-and-swap**: a last read/PUT race remains. A store refreshed independently while an old form remains open is also not a proven form-snapshot isolation guarantee. This candidate must not be advertised as unrestricted multi-writer-safe editing.

Claude reset grants, clear-cooldown, bulk token refresh and advanced policy editors are intentionally deferred new mutation surfaces, not missing fixes disguised as completed work. Native Devin/Meta provider panels and the large quota/log/card redesign are separate product ports. Existing generic auth/config surfaces and Core execution support are not removed.

## Validation boundary

`npm run validate:lts` includes the new config/provider-group/cache/cooldown/Codex/Kimi/OAuth/log regressions, type check, lint, build and LTS guards. Temporary real v7/v8 Core API checks cover grouped edits/deletes, usage reads and the dangerous v0 raw-write rejection. Synthetic migration/restart/v7 restore is verified independently in the Core evidence. Browser acceptance and precise CI head results are recorded in PR #98 at delivery; build/test alone are not a live deployment claim. No real OAuth refresh, paid quota consumption, UAT/PRO deployment or all-platform/full-plugin migration certification is included.

## Per-commit decisions

| Official commit | Decision | LTS disposition |
|---|---|---|
| `3be19dfbd15acd28087ce98411be9e6abe5f07ec` | equivalent | 模型缓存失效已由 LTS 既有实现覆盖。 |
| `d3cdc4687584b15ed7bda207968b750c7c391ac2` | equivalent | source/visual 模式保留合并策略的既有实现。 |
| `7b93570b764d45bc8a4cf0bd8189bf31fe322d7d` | equivalent | 既有 payload AST 保留；084f4292 的多键条件后续修复另行适配。 |
| `40513fc80d9a11712187d7582ebd8c608a18348f` | defer | 仅 dashboard 类型清理，LTS dashboard 仍有独立完整统计消费者。 |
| `7aa8618ad2ce1677260c08d9b597377d5661d160` | equivalent | OAuth attempt 隔离已存在，本轮补后续 abort。 |
| `8a1d36c8235a5f6474f4d1a9892e6ad8e90e62bb` | reject | 不按商业名单删除现有 config-detected provider。 |
| `9b2ab8ef5f0e76205203f4646b5aaea1073d71eb` | reject | 不引 sponsor 注册链接变更。 |
| `dc1dc01c21d57e0e035f5799e41071d2c98ee984` | adapt | 日志请求所有权、clear/read 竞态与旧响应隔离；保留 Home 日志。 |
| `9320c87ae73886c5caac725186fed31f1ec9cf3a` | defer | error viewer reducer 重构非协议修复；现有状态机加 generation guard。 |
| `f0c229d9421954c9b87a6dcbc3b9174ce981aaa8` | adapt | 显式 false 写入及 Core 默认值；quota absent=false、ws-auth absent=true。 |
| `ef7997e031c7f693c4759244672527a97d8f4d05` | adapt | 接受 Core 支持的负数 sentinel，不放宽必须非负的字段。 |
| `67b4b3cec54ed12a1d04fc5b75c0812f309f9a64` | defer | 文档 hint 随后撤回；LTS 保留自身 canonical 视图差异说明。 |
| `ad1da9240ff8a0eab133c1526b9c0f6888e5511e` | defer | notification 外观与计时器重构另行验收，不替换 LTS 交互。 |
| `38ea35ceae097bfdcf11ca4364035b7ad6e7f350` | adapt | 安全整数验证，拒绝精度丢失。 |
| `f4b304365142bc9dd151e79539a409b9a05bfa70` | equivalent | 未引入已撤回的 document hint。 |
| `12c391f7cf2d734088123d46845dbf1d6b60b9ea` | defer | Devin 品牌资源随新 provider UI 一起评审。 |
| `7a562f49a17153efc53191d4e93e7f0f43d3701e` | adapt | 四语言 WRR 权重生效条件文案。 |
| `93342c1885502bbbbdd2d4911ed6fc835c2fbc46` | defer | 依赖官方新字段导航结构；保留准确纯文本 hint。 |
| `1c63f21b1cc0d470aecdf06f76905715fb83ad03` | defer | 新的 all-provider quota 交互，LTS 现有筛选不回退。 |
| `61be1dbad0cea4b2ff4010dcaa258991c154d7bc` | defer | credential card 层级重写会碰 PAT/usage/remote-cloud 集成。 |
| `e32aca42a9dbf12d27e524c937ea299a609cdea2` | adapt | 只读冷却快照，未知/空/旧后端区分、时钟偏差与 shared timer。 |
| `7fed8575d15fd1e506a490b4e4961d1940007ec6` | adapt | SelectionCheckbox 使用真实 ariaLabel prop 并带文件名。 |
| `6b8cedabca96d5f764a831747ded0c46b65a7072` | defer | prefix pill 外观，非当前 LTS 数据正确性缺陷。 |
| `bf2645b5d9136ffe9ebcd473b9d702b51430eae9` | equivalent | 现有卡片 footer 保留 enable toggle。 |
| `ef4c8b4f6013ba679b76e32c41bc64235e687331` | defer | 依赖上游卡片重写的对齐样式。 |
| `80bcee68860540141111e5e44b9521848b41e5da` | partial | 按文件 generation 失效、batch/单账号隔离已适配；手动 token refresh 新写操作未启用。 |
| `2e57e6486b18b1e7c546e1197ff999eb1767cc98` | defer | Devin 专属编辑器新增面，未知 YAML 原样保留。 |
| `5254acefbd96fed04ccd4ec93856f5a56acb1ea1` | defer | Devin 品牌/provider UI 新增面；Core 执行能力不受影响。 |
| `03bd480835c5e9a5d34866ef474849fa6507dfcf` | defer | Devin quota 新流水线需单独安全/真实服务验收。 |
| `eae55a6f92207aa394d25f87d0cc1ea6e2cb5399` | defer | 依赖尚未引入的 Devin quota 流水线。 |
| `8d7b869fc2259759e9bd7a24cb37ffc8c53335b7` | defer | Devin cards/timeline 依赖新 quota 架构。 |
| `cca3088745ea05f3fb0ad5be74ba95858b5aecf1` | defer | Devin OAuth 新登录流程需专项验收。 |
| `217bc06857698dd23b5adc9e1b69e09697bd2358` | defer | 依赖 Devin browser-login 新流程。 |
| `35949c1083198cbfbd5447177709f96b0b2123cf` | defer | 依赖 Devin session cancel 新流程。 |
| `e8e73b679de9ec851c525880dcfc1e64812ae85c` | adapt | OAuth attempt 失效 abort 请求；不同 provider 互不取消。 |
| `c98751140127a39985df565b827eec0c20d131d3` | defer | 依赖未引入 Devin quota request pool。 |
| `96c25117ee4ebe2efff685cf49c35ffbbda1036e` | defer | 依赖 Devin quota 文案/解析器。 |
| `75270371067408f4ed7dc056f6a7d46ec18117df` | defer | 尚无 Devin observation UI，不能当已修复。 |
| `71519802950e1dd43f14d0007604858fff8eec08` | defer | 新 quota action 的 spacing；LTS 现有控件保持。 |
| `c12997e1a544374336ea385d5e9a9bbabe1e4767` | reject | 不删除 LTS 仍有效的并发/配额回归测试。 |
| `0a1a7f1a2bc21e26ba0a1ccfd2ad82274ca3b28d` | defer | Meta OAuth/quota 是新产品面，不与 v8 配置迁移耦合。 |
| `048cd49ae9c72c1b3ffc7e4cea25a2aa2a32adea` | defer | 依赖 Meta quota/DCA 新产品面。 |
| `120d2310921756f3d6434d2f61a772a7c0b9e08a` | defer | 依赖 Meta quota parser。 |
| `23564214a2061e2430d3e734f0586ba294e367a6` | adapt | 插件资源页使用 theme background tokens，保留 capability gate。 |
| `9f5045d0bb5dc0f2e5e8434b251d79fd59c1c027` | adapt | active Claude Team 优先于账号 Max/Pro 标志。 |
| `6869fd2c3f5588f46d2805d172ae58a46c1f3040` | defer | quota account search 新交互，现有筛选可用。 |
| `b5267ec619624022d79730f21a92c1b5f0d70119` | adapt | LTS Codex sidecar 识别 Business Premium 显示，不推断计费/额度。 |
| `6c972560307e7e5bd016efea876b320bd511aa07` | adapt | 未知 xAI 周用量显示不可用而非假百分比。 |
| `df9fdb7783a0a6699e2e7005df4fa7ab6e9df296` | adapt | xAI usagePercent 与 billing period 原子绑定。 |
| `aa7029a301989942ef912a8d36b122efadc49beb` | equivalent | weight tooltip 已使用纯文本。 |
| `bbac79d2222a0f345458203a5ab92d859f30ff30` | adapt | Codex subscription GET best-effort，失败回退文件信息，保留 LTS analytics。 |
| `c3e6b0b649748bbeef9784ba653f55bdc12709e1` | adapt | Kimi international OAuth 入口及真实 Core v0 endpoint，未触发真实登录。 |
| `7de67fc48f011829d0dea60321ca6d4e0084109f` | defer | 上游 ProviderTabs 新外观，不覆盖 LTS navigation。 |
| `b9d3f21f3beb7ca18f086a9f36795144341ec00f` | defer | 依赖 ProviderTabs wheel-scrolling 新交互。 |
| `4530da271ba2e89810d4dccebc57f3091afa590a` | defer | quota toolbar 重排与搜索新交互。 |
| `ee27516e7cb230ef8687bb04e700984e8c78fec5` | adapt | Autocomplete dropdown portal 定位、scroll/resize 清理。 |
| `ebb5b7d0c0453571736919eaa0d1f488c23ef903` | partial | native v8 family 子树写入与分组保留已适配；不是上游全量原生 group UI。 |
| `88d1867df7b9f598f903aa8f55c5af47a30247e6` | partial | null 父节点、组身份、继承与隐藏模型元数据保护；高级共享组编辑仍由 YAML 完成。 |
| `b8ed42ae464ea7d144e37cf27b34a478f53c2b8a` | adapt | discovery/connectivity proxy_url、连接/表单 generation 与 late-result 隔离。 |
| `084f42928acf56f42395e0c64d7df59a337d509f` | adapt | 保留同名别名、模型 sourceIndex/隐藏元数据；payload 多键 match AST 精确编辑。 |
| `2c234bc3173c9ee55aa9e7973138f61a083352f2` | defer | 清除冷却会使凭据立即参与调度，是新写操作；只读快照已接入，清除按钮另验。 |
| `59228ead028ec8117cf501d08dceebffb084da30` | equivalent | LTS 已有 disabled card class。 |
| `deab4d6055f784ecc87b84412b613a0ef40a8680` | partial | empty cursor、Blob error、signal API、错误列表校验已适配；不搬迁日志架构，页面以 generation guard 防旧结果。 |
| `d82d95465b99bee8b4ffe33a54faae0fa573211f` | defer | 日志 wrap/filter modal 是 UI 重构，保留 Home 与现有 LTS log controls。 |
| `edc10b44e76b57488087cb006986e4fc693dae03` | defer | 依赖日志 toolbar 重排。 |
| `81828925670464e21b700e32e229de208ebf3465` | reject | 拒绝仅 v8 登录和全局 API prefix 切换；保留 v7/v0，配置域按布局选版本。 |
| `9d5c0d971f5e8e473800472bbf9367f8d52dc62e` | defer | 官方多 PATCH 的部分成功恢复不适用于 LTS 单 YAML PUT；不宣称等价。 |
| `5521c4ba5477952e16b23f3023f79b0e71532dd6` | adapt | 确认保存前检测修改列表的并发冲突，失败保留草稿；不声称服务端 CAS。 |
| `b87b9487f63e08ad97b1fb4e7c17b4adb811b922` | adapt | 已处理 Escape 不再触发 Logs fullscreen 操作。 |
| `45181b4fae6286b870c6912a4f2cae538a5901f6` | adapt | Codex credit balance/unlimited 展示，保留 LTS reset credits 和分析。 |
| `254594aa5c335836529b457759b78f25d217dca1` | defer | 新 OAuth/shared/relay 可视字段另批；未知 YAML 不丢失。 |
| `9247abd9447c816b520d4d4c71dc5069db63fde0` | defer | trusted-proxy/discovery 新 UI，不隐式开启信任代理。 |
| `d78fcecda11a0cb91d989ab412679abb5ca7bd20` | defer | 高级 credential runtime policy editor 新产品面。 |
| `5be3afe9eab1c68fafa8669e6fadfb58158ab439` | defer | 高级模型 capabilities 表单新产品面，现有隐藏字段保留。 |
| `2819fd7950c1bf5381afc08032c13e758d269a37` | defer | 依赖高级 policy intent UI；未实现显式等于继承值的完整意图编辑。 |
| `a60586e2e1d7f13f2ec553dd762b5ae7412e4c31` | defer | provider-specific request controls 新 UI，原始字段保留。 |
| `698dcb1928af9bc9d50b4995308af6bcc6a744f1` | defer | 依赖尚未引入高级 thinking budget 控件。 |
| `587a37eaa8b4a97cb7f18422f17b3a6036e18813` | defer | 未引入该原生 group 解释文案。 |
| `62756362852d09114923369fa65f529e67876ac4` | defer | error-rule 行编辑器新 UI，原始规则保留。 |
| `dab7cbc9da37c8017b60bb913ec8f0f14d32c2b8` | defer | 依赖高级编辑器 shared selects。 |
| `326cb6da134b371dc01b4f0d55c28521beade5f3` | partial | auth status 带稳定 auth_index；批量 token refresh、结果面板和 credential policy 新写面延期。 |
| `556a2b25bb5409310706a390e0f46b35a12b51ac` | defer | API key names 新存储/搜索产品面未引入，拒绝原文 key 持久化方案。 |
| `32e7eb9f46506209e53ed85436bf5fb66263021e` | adapt | Kimi 月额度 ratio 与 kimi.ai 账号识别，不伪造未知值为零。 |
| `33af96657f3dad761f03e7f5671fef610ffc30ae` | adapt | 固定 Kimi com/ai 目标，domain/canonical 优先，下载后连接 fencing。 |
| `69ebed4f3f31575eedae9c2713bd508dc4c2344d` | defer | 额外 xAI settings/user enrichment 网络读取非兼容必需；不引入付费 chat probe。 |
| `20b2372acf0f7917456549207e20db60f3ff80a1` | equivalent | 未引入 names store，因此不存在其原始 key 持久化缺口；未来实现须 fingerprint。 |
| `82711432b343b075881197fc4ab46f13e33c0a31` | adapt | YAML1.1 typed bool 与 Core yaml.v3 对齐，不用字符串 truthiness。 |
| `f1ee52cfe5f1af5983bd1ca038a80fc6d9033f0f` | defer | 新增 duration editor 依赖未接入；LTS 已有字段只在 dirty 时写回。 |
| `a7ec312fbbb0a13f3a580ee0c7e29228a07c8867` | reject | 不以官方 README 覆盖 LTS 产品/部署/usage 文档。 |
| `d554bb0983c167beb5945528503839cdb2b0b316` | defer | Claude reset grants 涉及外部额度消耗，须显式确认/幂等/未知结果恢复专项。 |
| `e5fb14c8763d1b92e2449e9440cd986fc0dba7cc` | defer | 同上，未引 demo 或自动消耗；不能用合成测试代替消费验收。 |
| `752e0ee772220ce49aae1221a3f39f23236590d7` | equivalent | 未引入 demo 文件，无需执行删除。 |
