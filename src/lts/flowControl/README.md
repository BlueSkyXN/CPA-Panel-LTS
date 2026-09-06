# Flow Control Panel V3

通用模型复选、单账号引用、共享摘要和Core解释。

# V3 管理 API

沿用现有 `/v0/management` 和管理认证；没有新写入接口，配置保存沿用 `/config.yaml`。

| 方法/路径 | 用途 |
|---|---|
| GET `/flow-control` | schema3能力、实际策略、轻量汇总、调用方与唯一账号引用、模型目录 |
| GET `/flow-control/summary` | 按需汇总，不扫描目录，不构造请求明细 |
| GET `/flow-control/events` | 开启 realtime 后可订阅共享摘要；关闭返回409，人数满返回503 |
| GET `/flow-control/details` | 手动分页 `offset=0&limit=100`，可加 stage/state/key/account/model |
| POST `/flow-control/preview` | `{config?: <草稿>, targets: [<Identity>...]}`，同版本批量解释 |
| POST `/flow-control/migration-preview` | 直接提交旧 flow-control 配置块，返回 config/issues/ready；只读 |
| GET `/flow-control/explain` | 旧单目标查询保留，条件解释，不替代路由探测；新 Panel 使用 POST preview |

POST 最大1MiB；preview1..24目标，每项字段有长度限制，不能拿前缀作实际目标。details最多200行、offset最多10000；拒绝非整数和未知stage/state。活动明细总数和truncated标志区分输出截断与真实总量。

`schema-version` 是 API 版本；`policy.version` 是运行规则语义，不要混淆。`configured-enabled` 对应文件配置，`policy` 是已经应用的策略，`configuration-error` 表示当前配置未成功应用。Panel 不把未保存草稿显示成实际策略。

`keys[].ref` 是现有调用方引用，`accounts[].ref` 是唯一Auth引用。不要传入原始CPA Key、OAuth Token或AI Key。`model-options` 中的 provider::model 可用于规则复选；preview Identity 则拆为 `provider` 和 `model`。

示例（请用当前接口实际ref，以下用anonymous和泛化模型表达）：

```json
{
  "targets": [
    {"stage":"attempt", "key":"anonymous", "provider":"codex", "model":"model-a"},
    {"stage":"attempt", "key":"anonymous", "provider":"codex", "model":"model-b"}
  ]
}
```

每个结果含 `matches`、`known`/`unresolved`、`active`、`blocked-by`、`delta`、`complete`、`can-start`、`policy-revision`和采样时间。未选账号时涉及账号的约束未知；预览不会申请真实名额，结果可能在返回后变化。详情分页也是即时视图，不是游标冻结快照，活动变化会导致翻页时位置变化。

SSE：初次立即一份汇总，之后按interval更新，所有观察者复用一份缓存；关闭发送 `event: disabled` 后结束。每个连接只顺序写最新汇总，无历史补发；断线客户端拉取最新值。schema3汇总不再含V2全量activity/buckets/policy，外部V2观察程序应升级；不要用字段缺失推断为零。

资源 `filesystem-free-bytes: null` 表示未知；磁盘挂载点为进程工作目录所在文件系统，不是日志目录大小，也不是流控磁盘使用。Go-managed内存不是RSS。

## 本地检查

```sh
npm ci
npm run test:flow-control
npm run test:codex-remote
npm run type-check
npm run lint
npm run build
```

`model.test.mjs` 和 `insights.test.mjs` 可使用实际 TypeScript 独立运行；yaml/view测试必须使用真实yaml/React/Vite依赖。不能以替身渲染宣布页面通过。
