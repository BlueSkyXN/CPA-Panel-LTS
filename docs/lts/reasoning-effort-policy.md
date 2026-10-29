# 推理强度配置

配套 `CPA-Core-LTS v1-lts-0.1.1` 起，配置编辑器的 Payload 分组提供“推理强度”。添加规则后填写客户端模型名或通配符，再选择模式：

- **跟随客户端（follow）**：沿用客户端和模型默认行为，无需指定等级。
- **缺省强度（default）**：仅当客户端没有显式强度、禁用/自动/预算设置或推理后缀时，补充指定等级。
- **强制强度（force）**：覆盖客户端强度和模型后缀。

规则从上到下匹配，最后匹配的规则生效。对 GLM Coding Plan 强制 max，可添加 `glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`，模式选择 force，强度选择 max。保存前可在差异预览中检查：

```yaml
requests:
  reasoning-effort:
    - models: [glm-5.3, glm-5.3-flash, glm-5.3-flashx]
      mode: force
      effort: max
```

专用策略匹配后优先于 Payload 强度字段；迁移时移除旧 Payload 规则中用于 effort 的键，其他参数可保留。未配置该策略的模型保持既有行为。等级支持情况由 Core 根据实际模型检查，选择模型不支持的等级会导致请求报错。

Panel 保存时保留未知 YAML 字段和注释；并发修改规则列表会阻止保存并提示重新加载。连接旧 Core 时，缺少 `X-CPA-REASONING-EFFORT-POLICY: 1` 能力标记，表单只读；升级 Core 后重新连接即可编辑。

协议适配、动态控制、预算映射与统计语义见 [Core 使用说明](https://github.com/BlueSkyXN/CPA-Core-LTS/blob/v8-dev/docs/lts/reasoning-effort-policy.md)。
