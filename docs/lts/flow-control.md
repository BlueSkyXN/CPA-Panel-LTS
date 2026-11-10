# 本地流控：Panel 使用与发布指南

Flow V3 是 Core 的可选单进程流控，Panel 只负责编辑与观察，不在浏览器执行放行算法。完整后端语义见 [Core 流控指南](https://github.com/BlueSkyXN/CPA-Core-LTS/blob/main/docs/lts/flow-control.md)，前端维护入口见 [sidecar README](../../src/lts/flowControl/README.md)。

## 配套版本与范围

- 按需分组观察与单维度趋势拆线的首个配套发布目标：Core `v1-lts-0.1.9`、Panel `v1-lts-0.1.5`。发布状态以 Release、`management.html` 资产和运行实例分别回读为准。
- 运行时以 `GET /v0/management/flow-control` 的 `schema-version: 3` 和 `supported` 为准，不以版本字符串猜能力。缺失接口、旧 schema、Home 模式不得误显示为可编辑。
- attempt 模型选择还要求 `resolved-model-options` 特性，不能把公开别名当成上游实际模型。旧 Core 仍可使用其他管理功能。
- 不改变 Codex UA、client metadata、usage v3、provider 协议或定价统计；流控摘要不是完整 usage 的替代品。

## 操作与生效

1. 在左侧导航「观测 → 高级分析」打开「流控配置」（`/analytics/flow/config`，按 Core 能力门控显示；旧 `/flow-control` 和 `#/config?section=flow-control` 深链会重定向到配置页）。执行、实时观察、资源采样三个服务端开关默认关闭；仅打开页面不创建配置。
2. 新规则使用 `version: 3`。同一字段的复选项为 OR，不同字段及所有命中规则为 AND；省略表示全部，空数组不表示全部。账号对应一条 Auth 记录，不自动合并邮箱或远程账号。
3. request 层按逻辑请求和公开别名计数；attempt 层按实际 Executor 目标计数。是否按 model 分组决定多个已选模型共享总量还是独立计数。
4. 先使用只读预览，再通过 Flow 页面自带的差异确认和 `PUT /v0/management/config.yaml` 保存；保存只合并 flow-control 相关键，不回写其他可视化字段。预览不占位，也不证明路由或套餐可用。
5. 保存后自动重新读取流控状态；必要时重新加载，核对草稿、文件期望配置、实际策略与失败提示。保存返回409不写文件；watcher 竞争或策略不能应用时保留最后有效策略，不全局阻止新请求，也不绕过旧限流。

「流控看板」（`/analytics/flow`）不读取或保存 YAML，只展示运行状态、活动明细和实际策略容量检查。“开始/停止实时”只控制当前页面订阅；离开看板即取消订阅；后台标签暂停，断线只重连观察，服务端关闭实时后不自动改为轮询。关闭流控不取消已有模型执行；draining 仍计实际生产者名额。关闭期间的新调用不计入受控摘要，不能把它当全站并发。

看板默认未开始观察，总量视图读取状态时不构造分组。点击「开始实时」才建立 SSE 订阅。Core 支持 `on-demand-grouped-summary` 时，可选择模型、上游凭据、调用方 Key 或 Provider 视图；一次只订阅一个维度，切换视图取消旧订阅、清空本段历史并重新采样。切换指标和选线在当前样本上完成，不重建订阅。用户调用指标仅支持总量、模型与 Key。自动显示最活跃的 8 组与“其他”，展开选线后可搜索和手动选择；停止后保留曲线，最多保留 60 个样本，暂停、缺失或截断处留断点。旧 Core（包括仅声明旧 `grouped-summary` 的版本）保留总量视图。完整观察范围见 [高级分析工作区](advanced-analytics.md#流控边界)。

模型、Key、账号选择保留未列出的既有引用。Flow 页面的可视化修改保留未管理 YAML 字段与注释；畸形已知字段显示错误，不把未知或非法规则替换为空规则。需要手工修复 YAML 结构时使用配置面板的源码编辑器，停用仍可保留原草稿。

## 迁移与回退

- 真实 V1/V2 策略先调用 migration-preview，确认引用映射后显式保存版本3；歧义账号不能自动拆分。没有旧规则不需要迁移。
- 切换 legacy/V3 前排空活动调用与等待项。频率历史仍存在时，不可沿用同一规则 ID 改变筛选或分组；等待历史到期或显式新建 ID 后重新提交。
- 升级前保留配置副本。回退旧 Core 前先停止新增调用并排空，再恢复旧配置；不要直接让不支持 Flow 的旧版本读取启用的 V3 配置并假设限制继续有效。回退 Panel 不改变 Core 正在执行的策略。
- 多进程不共享名额；不覆盖绕过 Manager 的调用、后台异步任务完整生命周期，也不代表服务商官方额度。

## 验证与发布

`npm run validate:lts` 包含 Flow 的模型、YAML、React 渲染和 locale 检查；`npm run smoke:lts` 验证 mock 浏览器，`npm run smoke:lts:core` 使用临时 Core 配置验证真实管理接口和浏览器。它们不代表生产部署或真实 Provider UAT。

发布必须使用新 annotated tag，正文包含有意义的变更摘要和唯一 `Companion-Core` trailer。精确 SHA 的 CI 通过后推送精确 tag，确认 Actions 成功且 Release 资产名称仍为 `management.html`。不移动旧 tag，不把 tag 存在当作 Release 完成。
