# AGENTS.md

本仓库是 `CPA-Panel-LTS`，不是上游 `router-for-me/Cli-Proxy-API-Management-Center` 的普通同步 fork。

## 项目定位

- LTS 仓库：`https://github.com/BlueSkyXN/CPA-Panel-LTS`
- 上游来源：`https://github.com/router-for-me/Cli-Proxy-API-Management-Center`
- 面板基线版本：`v1.8.4`
- 面板基线提交：`8ed837c3d734c3970a6d6799c557bb6a6753360d`
- 配套核心仓库：`https://github.com/BlueSkyXN/CPA-Core-LTS`
- 核心基线版本：`CLIProxyAPI v6.9.49`
- 核心基线提交：`b8bba053fcdafd80abc2152c88c78f4e7713c05a`

`main` 是唯一的 LTS 主线。后续维护应在 `main` 上推进，不要为“保留统计”再创建长期分支。

## LTS 目标

本项目要在继续维护管理面板的同时，保留上游后续版本移除的完整使用统计 UI。

必须保留的统计 UI 和数据链路：

- `/usage` route
- `src/pages/UsagePage.tsx`
- `src/pages/UsagePage.module.scss`
- `src/components/usage/`
- `src/services/api/usage.ts`
- `src/stores/useUsageStatsStore.ts`
- `src/types/usage.ts`
- `src/utils/usage.ts`
- `src/utils/usageIndex.ts`
- 使用统计导入/导出
- usage charts、token breakdown、request events table、model/API/credential breakdown、local model price settings
- provider status bar 中依赖完整 usage details 的展示

禁止把上游后续“只使用 recent requests / api-key usage，移除完整 usage page”的方向直接合入。

## 已确认的上游移除路径

- `v1.9.3` 仍保留完整统计实现。
- `v1.8.4` 是 `v1.9.3` 之后的 tag，也是统计移除前最后一个保留完整统计页面的 tag，因此本仓库以 `v1.8.4` 为基线。
- `b25f722` 开始把 provider usage tracking 切换为 recent requests。
- `632be0b` 大规模删除完整 usage UI、store、API client 和统计工具。

跟进上游时必须把这两个提交视为统计移除边界，不能直接照搬。

## 与 CPA-Core-LTS 的关系

`CPA-Core-LTS` 是服务端核心，负责代理、鉴权、Management API 和统计数据采集。

`CPA-Panel-LTS` 是前端管理面板，负责读取 `CPA-Core-LTS` 的 `/v0/management` 接口并展示配置、凭据、日志、配额和完整使用统计。

这两个项目应作为一组 LTS 分发维护：

- Core 必须稳定提供 `/usage`、`/usage/export`、`/usage/import` 等 Management API。
- Panel 必须保留完整使用统计页面，并兼容 Core 的统计响应结构。
- Panel latest release 必须提供名称严格为 `management.html` 的资产，供 `CPA-Core-LTS` 默认下载。
- Core 修改统计 schema 时，必须同步检查 Panel。
- Panel 修改统计 UI 时，必须确认 Core 仍提供对应接口。

## 跟进上游规则

- 不要使用 GitHub 的 `Sync fork` 盲同步。
- 先读上游 diff，再选择 cherry-pick、手工移植或放弃。
- 合入前检查是否触碰 usage routes、usage store、usage API client、provider status bar、auth file stats。
- 如果上游改动会删除或弱化完整统计，优先保留 LTS 统计实现，再单独吸收其他无冲突部分。
- 后续轻量化改造可以移除广告、赞助描述、无用页面、无用 provider、非目标 release workflow，但不要删除仍被 Core/Panel 统计链路依赖的代码。
- Panel 发布标签使用自定义 `v*-tls-*` 形式，例如 `v1-tls-0.0.1`；发布时只推送当前标签，不要在跟进上游后执行 `git push --tags`。

## 常用命令

```bash
npm ci
npm run dev
npm run build
npm run preview
npm run lint
npm run type-check
npm run format
```

`npm run build` 会执行 `tsc && vite build`，并生成单文件 `dist/index.html`。

## 主要目录

- `src/pages/UsagePage.tsx`：LTS 必须保留的使用统计页面
- `src/components/usage/`：统计图表、表格和导入导出 UI
- `src/services/api/usage.ts`：Management API usage client
- `src/stores/useUsageStatsStore.ts`：统计数据缓存与加载
- `src/utils/usage.ts`、`src/utils/usageIndex.ts`：统计聚合、索引、格式化
- `src/pages/QuotaPage.tsx`、`src/components/quota/`：配额管理
- `src/pages/AuthFilesPage.tsx`、`src/features/authFiles/`：凭据管理与状态展示
- `src/pages/AiProvidersPage.tsx`、`src/components/providers/`：provider 配置与状态展示
- `src/router/MainRoutes.tsx`：路由注册，必须保留 `/usage`
- `vite.config.ts`：单文件构建和版本注入

## 修改要求

- 默认用中文沟通；代码、命令和专有名词保留英文。
- UI 改动后至少运行 `npm run build`。
- 修改统计相关代码时，优先运行 `npm run type-check` 和 `npm run build`。
- 不要把管理密钥、API keys、OAuth token 写入文档示例或日志。
- 真实接口语义以 `CPA-Core-LTS` 当前 Management API 为准，不要凭印象新增字段。
