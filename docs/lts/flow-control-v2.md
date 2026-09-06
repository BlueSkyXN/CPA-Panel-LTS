> 历史 V2 说明，不用于 V3 新配置。V3 使用一个 Auth 记录作为账号，模型集合与首次联合许可见 [V3 指南](flow-control-v3.md)。实时默认关闭，升级请同时更新 Core 与 Panel。

# CPA 多维并发控制 V2：用户规则、流结束与实时观察

## 1. 本次交付目标

历史 V2 的描述仅用于解释旧 Flow 配置。本次累计移植基于 2026-09-06 发布基线，不依赖 Codex Identity 批次；新配置以 flow-control-v3.md 为准。默认仍关闭，不改 UA 或认证行为，不升级依赖。

用户给出的五个限制被实现为五条独立规则，并且全部同时生效：

|规则|阶段|计数|上限|
|---|---|---|---:|
|指定用户的特殊模型|request|所选 CPA Key 对该模型的逻辑调用|1|
|GPT-6 模型/家族合计|attempt|所有调用方对实际模型名称或明确前缀的执行|5|
|每个 Codex 上游账号|attempt|一个账号的所有模型、所有凭据合计|5|
|指定用户的 GPT-6 合计|request|所选 CPA Key 对请求模型/别名的调用|3|
|指定用户全部调用|request|所选 CPA Key 所有模型合计|4|

“泰勒”不是确认过的模型 ID。本包不会猜成 terra、taylor 或其他名称。Panel 场景向导要求选择/输入真实模型 ID；若路由别名与实际模型不同，两个名称分别填写。

三项身份必须分开：
- key：调用方用来访问 CPA 的已认证 Key 引用，沿用 CallerScope；不是客户端自报任意 Header，也不是 AI 上游密钥。
- account：上游账号组。明确 flow_control_group 优先，其次 Provider+account_id，再上游 API Key，最后 Auth.ID。能识别为同一账号的多个 OAuth 文件共享计数。
- credential：一个具体 Auth 条目，Provider+Auth.ID 的稳定引用，对应一份认证文件或一条配置的 AI API Key。同一账号的两个文件可分别设 credential 限制，同时仍共享 account 总量。重命名/重新生成 Auth.ID 会改变这个引用；仅 Token 刷新不会。

例如两个不同 OpenAI API Key 是否共用组织额度，程序不能凭字符串推断。需要显式账号分组，不能声称已自动识别所有厂商所有账户关系。管理接口只返回引用和现有标签，不返回原始 Token。

## 2. 调度和生命周期

```text
已认证模型请求
  └─ request：Key / 请求模型 / 组合 / 全局
      ├─ 一次原子检查所有命中并发与可选窗口
      └─ 获准后持有逻辑操作名额
          └─ 现有账号选择、模型路由、会话约束
              └─ attempt：实际模型 / Provider / 账号 / 凭据 / 任意组合
                  ├─ 没有容量：有限等待，不占本层执行名额
                  └─ 全部满足：一次性占用所有相关名额
                      └─ 再检查账号状态、激活既有连续性逻辑
                          └─ 原 Executor 执行 / 思考 / 流输出
                              └─ 生产端真正结束后释放
```

本版的“一个对话完成”指一轮模型响应结束，不是用户关闭整个聊天窗口。模型返回工具调用、响应流已经结束后，本轮释放；客户端执行工具的空闲阶段不占模型执行名额，下一轮重新申请。

request 对应一次 Manager 操作，包含内部重试；attempt 对应一次 Manager 调用 Executor。五条流已输出首个 Token 但仍未结束时，五个名额仍被占用，第六条排队。HTTP 200、首个 Token、ExecuteStream 返回均不是释放点。

正常完成、错误结束释放一次；取消消费方后，继续等待生产端响应取消并结束。生产端迟迟不结束时标为 draining，仍占名额，不用固定 TTL 提前假装工作已经停止。这里统计的是本地可观察执行，不是上游服务器内部 GPU 任务。

请求层与执行层不是一个大事务。等待 attempt 时仍占已获准的 request 名额，表示 CPA 正在承接这一逻辑操作；没有占任何 attempt 名额。两种计数不能相加当作用户请求数，同一 request-id 可有 request 行和一个或多个 attempt 行。

## 3. 规则与组合

所有命中规则取交集，不采用“具体规则覆盖公共上限”。`max-concurrent: 0` 表示不设此项并发上限，不是禁止；规则至少需要正的并发限制或频率窗口。并发不依赖令牌桶，不随时间自动补充；原有可选 windows 是滑动请求计数，V2 场景向导不添加 windows。

scope 沿用 global/key/model/key-model/provider/account/account-model，新增 credential/credential-model/key-account/key-credential/key-account-model/key-credential-model/custom。

custom 的 group-by 可选 key、model、provider、account、credential、auth-kind，1～6 个不重复维度。顺序不影响同一个组合的计数。request 阶段只允许 key、model；上游身份尚未确定，不允许虚构账号维度。attempt 支持全部维度。

筛选和分组不同：
- `scope: model, model: gpt-*`：每个具体匹配模型分别计数。
- `scope: global, model: gpt-*`：所有匹配模型共享一个合计数。
- `scope: key, key: <ref>, model: gpt-*`：该用户的所有匹配模型合计。
- `scope: custom, group-by: [key, model, credential]`：每个用户×模型×上游凭据组合分别计数；可再加独立 account 规则限制账号合计。

模型/Provider 使用归一化精确比较，模型可使用一个明确的末尾 `*`；不按昵称或模糊子串猜测。auth-kind 只筛选 oauth/apikey，与 Key 是谁无关。

## 4. 队列

总等待数、每 Key 等待数、登记的等待 payload 字节数、最长等待时间都有边界。每次申请取队列截止与原请求 deadline 的较早者；本版是每次申请的等待预算，不宣称跨 Handler、所有重试的统一累计预算。

释放和配置更新唤醒调度；一个定时器处理等待截止及可选速率窗口。优先最近较少得到放行的 Key，再选择该 Key 最早可执行的等待项，允许绕过暂时不能执行的队头。它不是严格全局 FIFO、加权调度或任务时长预测。

现有会话固定、previous_response_id、必须沿用的 WS 和自定义调度器仍保留原行为。不受固定约束时可以优先考虑空闲账号；入队后不在等待中自动换账号。

执行名额没有 TTL，不代表网关也没有超时。外部网关的 idle/read/总请求 timeout 仍然有效；排队阶段不提前发送假成功 HTTP 200，等待上限应低于允许的首响应等待。这里不能保证避免 Cloudflare 或其他网关超时。

## 5. 实时 API

全部复用现有管理接口认证：

|接口|用途|
|---|---|
|GET /v0/management/flow-control|schema 2；能力、实际策略、Key/账号/凭据引用、模型列表、计数和活动明细|
|GET /v0/management/flow-control/events|SSE event=snapshot；立即一份、之后约每秒一份；不是持久事件回放|
|GET /v0/management/flow-control/explain|只读规则效果解释，不消耗并发或频率名额|

explain 参数：stage(request/attempt)、key、model、provider、account、credential、auth-kind。不要把管理 Key 放 URL 中；Panel 用 Authorization Header 建立流。

返回解释列出所有可能命中的规则、分组值、active/remaining、窗口用量、阻塞原因。未提供需要的账号/凭据时 complete=false、unresolved 指出缺项、对应行 known=false，不能把缺项当成空闲账号。即使 can-start=true 也只是当前约束快照，不是预留，其他请求及公平队列可以先获得容量。

实时状态区分 running/waiting/draining，带 request-id、模型、用户引用、账号/凭据、执行时长、队列剩余时间及所有可识别阻塞规则。不输出请求正文、提示词、生成文本、Token。

总计数不截断；活动列表最多200条、规则分组最多1000条，返回总量与截断标识。Panel 明细可筛状态和文本，规则表最多先显示80条并明确提示。累计计数是本进程观测量，重启重新开始。

SSE 限16个观察连接，写入设置5秒期限并每次刷新；观察连接不占模型名额。Panel 手动开关实时，保留最近60个采样点；隐藏页面暂停、断线退避重连、旧 schema 1 退回有界轮询。模型请求与监控重连完全分开。元数据引用改变时可手动重新读取。

## 6. Panel 的解释设计

设置工作区分为：实时运行区 → 五规则场景向导 → 规则效果检查 → 普通规则/队列编辑。

向导仅追加五条草稿，不删除现有规则、不自动启用。所有规则显示自然语言，包括筛选的是谁、按什么组合独立计数还是共享合计。效果检查能选具体 Key/模型/凭据，展示交集约束，未保存草稿与 Core 实际策略分别说明。新/修改过分组的草稿没有历史计数时显示未知，不显示伪造的零。

现有 YAML 保存方式保留非本次编辑字段、注释及未知项；不是分布式并发配置编辑锁，多个管理员同时编辑时仍按现有配置系统处理。无需再次粘贴 AI Token 或 CPA Key。

新增主要文案提供简体中文和英文；其他现有语言文件保留所有原值，新文案有英文/中文回退，未宣称完成所有语言人工校对。

## 7. 兼容与覆盖边界

旧配置字段和原 scope 不改名，默认关闭；没有新增配置不会启用限制。此前 UA 产品文件不修改。旧 Core schema 1 仍可读取；V2 新组合及向导需要 V2 Core。建议一起升级 Core 和 Panel，不能把 V2 规则交给不支持的旧 Core。

降低限额不强制终止现有响应；规则重新承接现有活动计数。第一次从关闭切到开启无法回溯未追踪的请求，需要等待旧请求结束或独立实例试跑。计数不持久化；多实例共用账号无法保证账号总并发，需继续使用 Home 或未来共享实现。

Codex 连续性：正常 v2 调用先等待容量，再激活原有 incumbent/canary 状态。外层完成/放弃通过同一共享记录看到实际预留。不改变原连续性状态机。已经由旧/特殊调用路径直接预留的请求仍立即申请，避免把现有预留放进队列。本地繁忙不写成上游额度错误。

Home 与本地 flow-control 同时开启仍明确拒绝，未改变 Home 协议。

本版覆盖原有 Manager Execute/Count/Stream、经这些路径的普通模型调用及 Manager 重试。它不是所有网络出口的限流器：低层 Manager.HttpRequest、独立 Alpha Search/live/realtime relay、绕过 Manager 的插件自发网络请求仍不覆盖；也不把 Executor 内部 wire 重试逐次算 RPM，不为异步视频后台任务提供完整生命周期名额。

## 8. 测试定位

独立 Engine 测试直接复制产品源文件后在临时 module 内运行，无修改算法、无第三方依赖替身。Manager/管理 API、真实 React/Vite/YAML 测试保存在项目中；完整执行需要项目要求的 Go 1.26 和锁定前端依赖。实际通过结果与未执行项目以 local/flow-control-v2/TEST_RESULTS.md 为准。
