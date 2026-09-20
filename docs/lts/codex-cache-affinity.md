# Codex 缓存优化设置

在现有配置页中打开「Codex 优化 → 缓存优化」。该设置帮助连续对话复用上游缓存，适配 ZCode 等客户端，仅适用于通过 ChatGPT 账号登录接入的 Codex。API Key 接入的模型不受影响。

| 显示选项 | 配置值 | 含义 |
| --- | --- | --- |
| 自动优化（推荐） | `client-aware` | 修复客户端会话信息的兼容问题，并根据连续的对话内容帮助复用缓存。 |
| 仅修复会话兼容 | `stable-id` | 修复客户端会话信息的兼容问题，不根据历史对话内容匹配缓存。 |
| 关闭增强优化 | `legacy` | 关闭会话兼容修复和历史内容匹配，保留常规请求处理。上游自身的缓存仍可能生效。 |

关闭增强优化可用于对比排查缓存优化是否影响请求；它不会关闭 ChatGPT 自身的缓存。实际缓存命中由上游决定，Panel 不根据选项显示「缓存正常」或承诺费用降低。

## 与 Core 的配置契约

复用现有 `GET/PUT /v0/management/config.yaml`，不新增接口或独立页面：

```yaml
codex:
  cache-affinity:
    strategy: client-aware
```

该设置要求 Core 已支持 `codex.cache-affinity.strategy`；旧版 Core 不会因为 Panel 展示该控件而自动具备缓存优化能力。字段缺失或为空时，支持该功能的 Core 默认使用 `client-aware`。

Panel 将缺失/空值显示为「当前使用默认设置：自动优化」，加载页面及保存其他字段不写入此项。显式选择后只更新策略叶子字段，保留同级扩展字段与注释。未知策略显示提示，未编辑该项时保留原 YAML，不误显示成自动优化；无法安全编辑的 YAML alias 显式报错，避免丢失其他字段。

缓存优化与异常推理重试的开关独立。Codex 配置分组统一显示为「Codex 优化」，其余异常重试、对冲及用量策略保持原有行为。

## 本地验证

- `npm run test:config`：真实配置 hook 的缺省、三档选择、未知值、注释、同级字段、最新服务端值与 alias 回归。
- `npm run type-check`、`npm run lint`、`npm run build`。
- `npm run check:lts`：配置、sidecar、四套语言与 feature registry 保持一致。
- `npm run smoke:config`：假 Core 下的实际保存回读、默认提示、三档 radio、四套语言及 320/1440 px 布局。
- `npm run smoke:lts`：既有 Panel 功能回归。
- `npm run smoke:lts:core -- --core-dir <Core源码目录>`：启动临时 Core 实例，验证三档策略的浏览器保存、YAML 落盘、Core 热更新与 Panel 重新加载。

这些验证不替代真实 ChatGPT 缓存效果实验，也不代表发布或部署已经完成。
