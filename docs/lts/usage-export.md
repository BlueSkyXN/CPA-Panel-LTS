# Usage 导出与分页

请求明细中的 CSV/JSON 导出包含当前时间范围、筛选条件和查询 bound 下的全部匹配记录，与正在显示的页码无关。顶部“导出完整备份”继续调用 `/usage/export`，用于 canonical v3 备份与恢复，不受请求明细筛选影响；两者不是同一种文件。

## 恢复与完整性

导出显示已读取/总数、重试、文件生成和结果状态。每批临时网络错误或 408/429/500/502/503/504 最多自动重试两次，间隔 500ms、1s。耗尽后可在当前页面继续，从失败游标重试；已验证并转换的批次不重新请求。401/403/400、过期快照和完整性错误不提供跨快照续传。

每批在推进检查点前核对 bound、稳定的整数总数、唯一记录 ID、游标进度和最终条数。失败或取消不下载部分文件。筛选、时间窗口、连接作用域或快照变化以及页面卸载会取消旧任务。检查点只保存在内存，取消、刷新或关闭页面后需重新开始；不会持久化 usage 明细。

翻页失败保留上一成功页及其页码，重试加载原目标页。每个当前查询最多缓存最近 5 页；键包括连接、bound、时间范围、筛选、页码/游标，切换查询丢弃缓存，显式重试重新请求。页面大小遵循 Core 能力并最多为 100。

## 前端处理

导出逐批转换原有字段和计价结果，生成 Blob 片段；不同时保留全量请求明细、表格行和序列化对象。批次之间让出事件循环，使取消、绘制和其他输入可以执行。保留唯一 ID 集合与最终文件片段，因此客户端内存仍随结果大小增长；此实现不承诺任意大小导出的固定内存。

## Core 能力与兼容

- 没有 `export_version`，或其版本尚未支持：沿用 `/usage/query/details`，导出批次遵循 `max_page_size` 并最多为 200。
- 声明 `export_version: 1` 与合法 `max_export_page_size`：使用 `/usage/query/export`，最多每批 1,000 条。新响应保留 version/bound/items/total/next_cursor，不重复返回 metrics/options。
- 声明能力后的 404、网络故障或解析错误按失败处理，不改变端点、筛选或快照来拼接旧路径数据。
- 更旧 Core 的全量 usage 模式继续导出全部已筛选行；已有能力探测及 legacy fallback 规则不变。
- 新旧导出字段、CSV 列、JSON 值、排序、trace_id 和费用语义一致。只改变读取与加工方式。

## 验证入口

```bash
npm run test:usage
npm run test:api-client
npm run check:lts
npm run type-check
npm run lint
npm run build
python3 scripts/smoke-usage-export.py
python3 scripts/smoke-usage-export.py --export-capability
python3 scripts/smoke-lts-panel.py
```

`benchmark-usage-export.py --baseline-dist <已有基线dist>` 对同一合成数据比较文件 SHA-256、请求次数、耗时、10ms 采样的 JS 堆峰值和主线程长任务。堆采样值不代表精确分配器峰值或浏览器总内存。

`smoke-usage-export-core.py --core-dir <新Core工作树> --legacy-core-dir <旧Core工作树> --legacy-panel-dist <旧Panel的dist>` 启动隔离临时 Core，用合成 usage 验证新 Panel＋新 Core、新 Panel＋旧 Core、旧 Panel＋新 Core；不访问生产实例。
