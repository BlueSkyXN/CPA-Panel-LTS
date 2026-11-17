# 2026-11-17 配置替换能力 selective-port

本批从 LTS main `f02f39d910cf0e6f3f4b7920d08656115639c131` 出发，审查上游 `3d893ec88938c3ceef200a15be6af8cf972564b3..706c7c6f3308c1b0cceb880eec092be911bf8a80`。Core companion 为 #371 → #372 → #373（原生 stack 374），冻结终点 `7df56074b252384d878ec4fca840552c6fb5236e`。

## 范围分类

| upstream commit | 分类 | 本批处理 |
|---|---|---|
| `15c3220b20ea9816f07277174ce66ed012b12471` | adapt-port | Antigravity/Devin 的 sensitive-words-replace 和 sensitive-patterns-replace；Claude API-key cloak 的同名字段，包含表单、类型和原生 Management API 序列化。 |
| `af75f6539e1a20500ecc1c97f960858fee7884f5` | defer | 用户选择先完成配置功能；118 文件的提示、InfoTip/Tooltip、字段说明和布局族单列评审。 |
| `706c7c6f3308c1b0cceb880eec092be911bf8a80` | adapt-port | requests.payload.replace 编辑器、严格输入校验、有序替换与四套 locale，接入现有 LTS 配置导航。 |

本批为一个自洽 Panel PR，不创建形式上的多层 stack。两项功能共享配置 hook、字段导航、类型和替换编辑器；Core 三层仍保留真实依赖。历史 defer 和独立 #156 不在本批范围。

## 行为与兼容性

- 保留 LTS Source/Visual 配置页、v8 projection、ETag/If-Match、未编辑 YAML、注释和并发 section 冲突检查；完整 usage、provider status、OAuth login proxy 持久化行为不变。
- 字面替换在 UI 中持有完整行草稿。重复 key、空 key 均保留在草稿且阻止保存，避免转成 map 时覆盖或丢弃用户输入；只有保存边界才转换为 Core map。
- 空 replacement 表示删除，匹配文字和 replacement 的空白原样保留。正则规则保持顺序并使用后端 Go RE2 语义；不使用浏览器 RegExp 判断 RE2 兼容性。Core 按其原有行为过滤无效正则。
- payload.replace 仅作用于选定的 user 消息文字。目标为全部 user 消息或从 1 开始的位置列表；替换按行序执行，位于 override 后、filter 前。不把数字、布尔或 null 隐式转换成字面字符串。
- malformed source 保留 invalid 状态，用户可以修 YAML 或显式重置；LTS model scope、auth-kind、request-paths 和未知字段在规则编辑时保留。
- 同一页切换配置分类仍保留草稿；两连接使用各自 runtime，切走/返回不会把另一连接的配置写入当前连接。
- sensitive replacements 在当前 Core main 已可用；新增 payload.replace 需要本批 Core。真实 main 对不支持的新字段返回错误并保留原配置，Panel 沿既有错误反馈流程展示保存失败。

## 验证

- `npm run validate:lts` 通过，包含新配置/Claude 原生 API 回归、原有 33 项 provider-switch 页面门禁，以及新增 23 项 replacement 页面门禁。type-check/build/contract 通过；lint 仅保留既有 useConnectivityTest cleanup warning。
- `scripts/guard-config-replacements.py` 驱动真实页面完成新增、空值、重复 key、非法位置、排序、保存、重载、清空、移动视口、连接切换和 Claude 凭据表单写入回读。保存断言关联实际 PUT 响应，不把请求期间的 disabled 状态当作写入完成。
- 新浏览器门禁接入 `test:config-replacements`、`validate:lts` 和 LTS Panel Contract workflow，复用现有 Python/Playwright 安装步骤。
- 三组真实浏览器 × 临时 Core 矩阵通过：候选 Panel × 候选 Core、候选 Panel × main Core、main Panel × 候选 Core。主线核验坐标分别为 Panel `f02f39d9`、Core `11195efd5`。
- 真实候选 Core 验证有序/空替换持久化、非法小数位置返回 422 且原配置不变；真实 main Core 对不支持的 replace 返回 400 且原配置不变。
- 所有 Core 写入验收只使用临时目录、synthetic credentials 和 localhost。云 CI 结果以 PR 最终 SHA 回读为准；未执行合并、发布或部署。
