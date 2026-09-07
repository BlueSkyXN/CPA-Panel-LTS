# 本地流控：Panel 使用与发布指南

Flow V3 是 Core 的可选单进程流控，Panel 只负责编辑与观察，不在浏览器执行放行算法。完整后端语义见 [Core 流控指南](https://github.com/BlueSkyXN/CPA-Core-LTS/blob/main/docs/lts/flow-control.md)，前端维护入口见 [sidecar README](../../src/lts/flowControl/README.md)。

## 配套版本与范围

- 首个包含本次 Flow V3 的配套版本目标：Core `v1-lts-0.0.25`、Panel `v1-lts-0.0.17`，包含恢复实时观察时重新加载最新策略的修复。旧 Core `v1-lts-0.0.23`、Panel `v1-lts-0.0.15` tag 不包含该功能，且这两个旧 tag 的 Release 任务未成功。
- 运行时以 `GET /v0/management/flow-control` 的 `schema-version: 3` 和 `supported` 为准，不以版本字符串猜能力。缺失接口、旧 schema、Home 模式不得误显示为可编辑。
- attempt 模型选择还要求 `resolved-model-options` 特性，不能把公开别名当成上游实际模型。旧 Core 仍可使用其他管理功能。
- 不改变 Codex UA、client metadata、usage v3、provider 协议或定价统计；流控摘要不是完整 usage 的替代品。

## 操作与生效

1. 在配置页可视化编辑器找到本地流控。执行、实时观察、资源采样三个服务端开关默认关闭；仅打开页面不创建配置。
2. 新规则使用 `version: 3`。同一字段的复选项为 OR，不同字段及所有命中规则为 AND；省略表示全部，空数组不表示全部。账号对应一条 Auth 记录，不自动合并邮箱或远程账号。
3. request 层按逻辑请求和公开别名计数；attempt 层按实际 Executor 目标计数。是否按 model 分组决定多个已选模型共享总量还是独立计数。
4. 先使用只读预览，再通过现有配置差异确认和 `PUT /v0/management/config.yaml` 保存。预览不占位，也不证明路由或套餐可用。
5. 保存后手动刷新，核对草稿、文件期望配置、实际策略与失败提示。保存返回409不写文件；watcher 竞争或策略不能应用时保留最后有效策略，不全局阻止新请求，也不绕过旧限流。

页面“开始/停止实时”只控制当前页面订阅；后台标签暂停，断线只重连观察，服务端关闭实时后不自动改为轮询。关闭流控不取消已有模型执行；draining 仍计实际生产者名额。关闭期间的新调用不计入受控摘要，不能把它当全站并发。

模型、Key、账号选择保留未列出的既有引用。可视化修改保留未管理 YAML 字段与注释；畸形已知字段显示错误，不把未知或非法规则替换为空规则。需要修复结构时使用源码编辑器，停用仍可保留原草稿。

## 迁移与回退

- 真实 V1/V2 策略先调用 migration-preview，确认引用映射后显式保存版本3；歧义账号不能自动拆分。没有旧规则不需要迁移。
- 切换 legacy/V3 前排空活动调用与等待项。频率历史仍存在时，不可沿用同一规则 ID 改变筛选或分组；等待历史到期或显式新建 ID 后重新提交。
- 升级前保留配置副本。回退旧 Core 前先停止新增调用并排空，再恢复旧配置；不要直接让不支持 Flow 的旧版本读取启用的 V3 配置并假设限制继续有效。回退 Panel 不改变 Core 正在执行的策略。
- 多进程不共享名额；不覆盖绕过 Manager 的调用、后台异步任务完整生命周期，也不代表服务商官方额度。

## 验证与发布

`npm run validate:lts` 包含 Flow 的模型、YAML、React 渲染和 locale 检查；`npm run smoke:lts` 验证 mock 浏览器，`npm run smoke:lts:core` 使用临时 Core 配置验证真实管理接口和浏览器。它们不代表生产部署或真实 Provider UAT。

发布必须使用新 annotated tag，正文包含有意义的变更摘要和唯一 `Companion-Core` trailer。精确 SHA 的 CI 通过后推送精确 tag，确认 Actions 成功且 Release 资产名称仍为 `management.html`。不移动旧 tag，不把 tag 存在当作 Release 完成。
