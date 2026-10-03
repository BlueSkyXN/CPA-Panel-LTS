# Daybreak Blue request tags

请求明细的速度档位列同时呈现上游确认的 Blue 程序：

- `STD`：标准速度 + 上游确认 Standard。
- `BLUE`：标准速度 + 上游确认 Daybreak Blue。
- `FAST`：Fast 速度 + 上游确认 Standard。
- `BLUE FAST`：Fast 速度 + 上游确认 Daybreak Blue。
- `Std ?` / `Fast ?`：有速度分类，但访问程序未知（未回显、历史数据或不支持的程序）。悬浮提示解释来源，不把未知当作 Standard。

底层仍分为两个维度。速度解析、原来的请求→实际速度差异展示、Fast/Std 筛选及计费不变；速度未知时保留旧有 assumed 证据与估算规则，悬浮可查。Blue 不参与计费，也不把 `service_tier` 改为 `blue` 或 `bluefast`。

Core 新增可选 `response_cyber_program`：`daybreak_blue` / `standard` / `unknown`，缺省代表没有响应证据。Panel 在完整快照、查询明细、导入校验、请求明细 CSV/JSON 导出中保留此维度。Core 原始 canonical v3 的导入导出仍由现有 API 完成。

必须根据响应识别，不能根据模型名、请求参数、省略参数或 `-blue` 别名推断。官方允许有资格账号省略请求选择而默认 Blue，所以普通模型名也可能显示 Blue。新 Panel 连接旧 Core 时无 Blue 证据，显示未知程序；旧历史记录不回填。

本次不新增 Blue/Red 筛选或资格探测，不改变配置，不支持 Red 专属标签。上线需要配套 Core 字段；本地 mock/单元测试不等于生产验收。
