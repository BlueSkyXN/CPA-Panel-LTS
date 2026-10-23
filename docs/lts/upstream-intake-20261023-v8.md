# 2026-10-23 V8 selective-port intake

后续业务功能补齐见 [2026-10-23 功能对齐](v8-feature-alignment-20261023.md)；本文分类保留为当时快照。

本轮从 `ee79a794526a30c03748a8864a9ac6589a31833b` 审查至官方 main `714de0760a3ce86094b178fb46f834d34bc4a2a5`，52 个 first-parent 提交。2026-10-23 fetch 确认目标未漂移。配套 Core 同步至官方 `d946c4fba6fc9a5cfbca1f3d85184d62ad2fb683`。

这是 V8 开发线的 selective-port 审查范围。完整 usage、Flow、四语、插件 gate、精确 If-Match 和未知 YAML 保留仍是现行合同。partial/defer 是可见未交付项，不算全量移植或产品功能对等。没有真实消费 reset credit、第三方授权或付费健康请求。

分类：adapt 21, defer 20, equivalent 5, partial 4, reject 2。

| 官方 SHA | 分类 | 处理与代码依据 |
|---|---|---|
| `dfc1b1cfaa45069da51e301510869e70eceea306` | adapt | 四语框架保留；中文 Free/Pro/Team 计划名对齐。src/i18n/locales。 |
| `fc9b8e2d4042bb0fc2134bde544f2da0f9bb40ae` | defer | vi/ko 新语言及其测试属于未接纳语言扩展；保持 en/zh-CN/zh-TW/ru 四语合同。 |
| `3a71fcf8d5d071761ce7acddff6884abf103f467` | equivalent | 现有 v8VisualProjection 和 config API 已使用 client/upstream canonical paths；V8 projection/roundtrip 测试及真实 Core smoke 覆盖。 |
| `bb324614ff0740dafc462f2b96c8f838131c7694` | equivalent | 现有 v8VisualProjection 和 config API 已使用 client/upstream canonical paths；V8 projection/roundtrip 测试及真实 Core smoke 覆盖。 |
| `936b5eba74f8e6090b42289ce30681ad085cadc6` | defer | vi/ko 新语言及其测试属于未接纳语言扩展；保持 en/zh-CN/zh-TW/ru 四语合同。 |
| `6abace9ffb83a9ac349464ded04bb4e7f7cb309e` | defer | vi/ko 新语言及其测试属于未接纳语言扩展；保持 en/zh-CN/zh-TW/ru 四语合同。 |
| `efe96bff0fa937fef17bee6f36e2b5fdd2d531f7` | adapt | providers.ts 从已知 provider/model 位置移除 test-model；UI 测试模型仍是本地选择，opaque headers/未知字段保留。providersNative.test.mjs。 |
| `66cafd727ce366cc77b9b61c6251867f2f66b414` | equivalent | 只调整上游测试框架；本仓 Node/Vite 的 providerModelOptions 测试自行加载 i18next，不依赖被替换的 Bun suite。 |
| `18ca877f83540feff12da946dda8a2a893f7b6b4` | adapt | 确认 reset/already_redeemed 后才刷新；配套 Core 仅清 quota 冷却，避免第二次通用 ResetQuota 清掉其他故障。v8Followup.test.mjs。 |
| `715cab426f874a77e0574efebf820c56a4ebeeba` | adapt | claudeUsage.ts 归一化 extra_usage 小货币单位和独立 dollar windows，Fable/legacy window 去重；通过现有 quotaConfigs 渲染，不搬入新 quota shell。 |
| `2ce627defa6719a6c09dad9983a1d2f79f5916f9` | defer | Claude cedar_ember grant 领取/消费状态机是前轮仍未接纳的独立操作；本轮未新增该 API/UI，不把只读余额改动计为 grant 完成。 |
| `ebb4289bc689543059cd57862ddcfc1e50be3234` | partial | Core 已支持 server.github-token；Panel Source File Editor 保存/未知 YAML 保留可用。专用可视化输入仍未接入。 |
| `77f10d5949bd7f9fb69b17887dea04e28ddf1533` | adapt | xAI productUsage 作为共享额度的使用组成展示，移除各条独立剩余进度条。保留现有 platform/user/auto-topup 只读逻辑。 |
| `f03160ef438ab49671f759fc96632ecff3c07d70` | defer | vi/ko 新语言及其测试属于未接纳语言扩展；保持 en/zh-CN/zh-TW/ru 四语合同。 |
| `346eaa2367d17e83b3361f5381953ba6ab99d085` | defer | vi/ko 新语言及其测试属于未接纳语言扩展；保持 en/zh-CN/zh-TW/ru 四语合同。 |
| `5aa1ad64a6494e3741e7d7ffec737107400a62b4` | defer | vi/ko 新语言及其测试属于未接纳语言扩展；保持 en/zh-CN/zh-TW/ru 四语合同。 |
| `00bb5a3b225ee591ac556ef79fcc42b68fda60df` | adapt | OAuth callback 接受后恢复已中止的 polling，isPolling 阻止重复并发。oauthAttempts.test.mjs。 |
| `c332bc900e8d28d513eeb907def808cd52cae580` | adapt | ToggleSwitch 接受外部 id/description，键盘 focus 和 reduced-motion 保留。 |
| `8ba200df021824404ee45080496434757c25d861` | defer | 上游新 config/quota shell 的布局样式，保留现有 LTS ConfigEditorWorkspace、卡片及 Codex sidecar；不以零散样式替换布局。 |
| `16f1962e69e75a393b903f898f1cc28af85a2bb2` | equivalent | 当前 Input 已无 topExtra/labelExtra，已有显式 label/id/aria-describedby。 |
| `b1f708d5ccdda8a509cc3d4dd44f8340bc00362a` | defer | 上游新 config/quota shell 的布局样式，保留现有 LTS ConfigEditorWorkspace、卡片及 Codex sidecar；不以零散样式替换布局。 |
| `0c54719159968925512f460210762910a4bef2e9` | defer | 上游新 config/quota shell 的布局样式，保留现有 LTS ConfigEditorWorkspace、卡片及 Codex sidecar；不以零散样式替换布局。 |
| `e70b37a9748084e76f94fe6e04cf9a3555f2954d` | adapt | generic plugin quota 使用原生 V8 /plugins/:id/quota，authoritative quota_plugin_id 优先、built-in 优先、capability gate 与缓存 generation invalidation。pluginQuota.ts、v8Followup.test.mjs。 |
| `350d808cdf10d5330ab5a39e3a79827731f082c9` | defer | 上游新 config/quota shell 的布局样式，保留现有 LTS ConfigEditorWorkspace、卡片及 Codex sidecar；不以零散样式替换布局。 |
| `1f5fd846cbf9aeaeeebabf299e0fc3893f636ec2` | defer | OAuth gallery/新的流程 shell 和 Kimi tile 图标依赖整页重构；保留现有 OAuthPage。SIWC 入口接入 AuthFiles。AGENTS 不变。 |
| `6e77824628407c9870ca1087ad238c7c6529d105` | reject | 商业赞助入口与 SponsorCard 违反现有 commercial-neutral 保护边界。 |
| `c9e2f7cb0b065c13211285d9525bcc8761f17837` | defer | OAuth gallery/新的流程 shell 和 Kimi tile 图标依赖整页重构；保留现有 OAuthPage。SIWC 入口接入 AuthFiles。AGENTS 不变。 |
| `622b011de326a385a83e8f034a0dcca64ca56edc` | partial | V8 canonical projection 已承接 upstream 配置路径；不删除 LTS quota fallback 控件，不搬入上游新的 config 分区。 |
| `fdea9765d2060cca47b31ef672710f259c5fccb6` | adapt | xAI quota 请求 X-Client-Version 对齐 1.0.46；没有加入付费健康 probe。 |
| `ec9fc9745886e4c43b91c611adf7923697a8a52a` | adapt | generic plugin quota 使用原生 V8 /plugins/:id/quota，authoritative quota_plugin_id 优先、built-in 优先、capability gate 与缓存 generation invalidation。pluginQuota.ts、v8Followup.test.mjs。 |
| `390718ecfec90b674fed474862e497522273e129` | adapt | generic plugin quota 使用原生 V8 /plugins/:id/quota，authoritative quota_plugin_id 优先、built-in 优先、capability gate 与缓存 generation invalidation。pluginQuota.ts、v8Followup.test.mjs。 |
| `b41c23890c40e89c2eb446895ae570c026deaf3c` | adapt | claudeUsage.ts 归一化 extra_usage 小货币单位和独立 dollar windows，Fable/legacy window 去重；通过现有 quotaConfigs 渲染，不搬入新 quota shell。 |
| `625bf4f7debf6678879f486e69121c0d1a2b6cf6` | reject | 商业赞助入口与 SponsorCard 违反现有 commercial-neutral 保护边界。 |
| `baa2b6298bc1961d1a0e60739ea71aa8a8d19759` | partial | 刷新与 reset 互斥的 callback guard 已移植；按钮布局沿用 LTS AuthFileQuotaSection/QuotaCard。 |
| `862d2b247a4c48e0b7d77fc9ac698d7721e444ce` | adapt | generic plugin quota 使用原生 V8 /plugins/:id/quota，authoritative quota_plugin_id 优先、built-in 优先、capability gate 与缓存 generation invalidation。pluginQuota.ts、v8Followup.test.mjs。 |
| `e5c7694b096a37c7555365a9089b14b8166ce74b` | adapt | 简繁中文 session affinity 术语更新。 |
| `1d45bef307edf14bb7b915aef19def0e50f21090` | defer | Claude cedar_ember grant 领取/消费状态机是前轮仍未接纳的独立操作；本轮未新增该 API/UI，不把只读余额改动计为 grant 完成。 |
| `27f0965ac375f1804804b59292bd6122a1a27e27` | defer | 这是上游新 AuthFileQuotaSection 刷新操作的两次布局调整；现有 LTS idle 点击加载、reset guard 与额度页单卡刷新保留。 |
| `eaf7201195d8b93d9fdacf98e8e00197e42116b1` | equivalent | 现有 xAI 卡片已有 pay-as-you-go disabled 分支及读取失败状态；只保留自身位置和结构。 |
| `080970ccfcacbb88da7723d2d460689db66278af` | defer | Meta 专用 quota shell 未接纳；本轮没有新增 Meta 小时窗口和订阅 UI。 |
| `e4e9c54112c904d7a1bf6d79240c1e54252c01d3` | defer | Meta 专用 quota shell 未接纳；本轮没有新增 Meta 小时窗口和订阅 UI。 |
| `13f94b47f3400e681dfdede65acf1a1242ee3fce` | defer | 上游新 config/quota shell 的布局样式，保留现有 LTS ConfigEditorWorkspace、卡片及 Codex sidecar；不以零散样式替换布局。 |
| `0b50a93c3aed07392c3e960a8e1f5c5ea7119bdc` | defer | 这是上游新 AuthFileQuotaSection 刷新操作的两次布局调整；现有 LTS idle 点击加载、reset guard 与额度页单卡刷新保留。 |
| `91b47855bf461945411f916a4dab6a8400549828` | adapt | Antigravity UA 以当前 Core fallback 为准，补 Remaining/window 标签、Argon 分组和 weekly exhaustion 约束。upstreamQuotaPort/v8Followup 测试。 |
| `27547a4447740663d8b65a61c5b7d9a2b213c10c` | adapt | Antigravity UA 以当前 Core fallback 为准，补 Remaining/window 标签、Argon 分组和 weekly exhaustion 约束。upstreamQuotaPort/v8Followup 测试。 |
| `c59ab414a814aff183fa2607771e5a5d9beaa925` | adapt | Antigravity UA 以当前 Core fallback 为准，补 Remaining/window 标签、Argon 分组和 weekly exhaustion 约束。upstreamQuotaPort/v8Followup 测试。 |
| `fe2963330f32a933f562282165f62ae52cf57145` | adapt | Antigravity UA 以当前 Core fallback 为准，补 Remaining/window 标签、Argon 分组和 weekly exhaustion 约束。upstreamQuotaPort/v8Followup 测试。 |
| `9a8307ed7048bdce2264f293f3cc5ec1f897e196` | defer | Claude cedar_ember grant 领取/消费状态机是前轮仍未接纳的独立操作；本轮未新增该 API/UI，不把只读余额改动计为 grant 完成。 |
| `efffa1316dbca5b67e58ae24946f603d813ad4b4` | adapt | AuthFiles SIWC bind/start/status/callback/cancel、use_siwc 开关和 readback；captured connection 隔离迟到响应；连接冻结仅允许精确 OAuth session 清理，synthetic unit/browser 验证。 |
| `2f0d6d71f4e3439ea18aa3e0472e216363a163b9` | partial | 绑定流程保留在 AuthFiles 更多操作；未搬入 OAuth gallery/其独立 SIWC tile。状态标签在卡片 header，避免遮挡操作。 |
| `603539ab5c5343f32c3945c6e0cdb8333991c493` | adapt | claudeUsage.ts 归一化 extra_usage 小货币单位和独立 dollar windows，Fable/legacy window 去重；通过现有 quotaConfigs 渲染，不搬入新 quota shell。 |
| `714de0760a3ce86094b178fb46f834d34bc4a2a5` | adapt | AuthFiles SIWC bind/start/status/callback/cancel、use_siwc 开关和 readback；captured connection 隔离迟到响应；连接冻结仅允许精确 OAuth session 清理，synthetic unit/browser 验证。 |

验证入口：`npm run validate:lts`、`scripts/smoke-lts-panel.py`、`scripts/smoke-lts-panel-core.py`、新增 `scripts/smoke-lts-panel-v8.py`。后者使用合成 localhost fixture，覆盖 SIWC 错误回调、poll 恢复、开关回读、迟到取消、插件原生额度路由、Claude 货币单位和桌面/窄屏布局。线上运行态单独验证；本文件不把本地测试视为部署完成。
