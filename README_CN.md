# CPA Panel LTS

CPA Panel LTS 是 `CPA-Core-LTS` 的长期维护版 Web 管理面板。

它是用于管理与故障排查 **CLI Proxy API / CPA Core LTS** 的单文件 Web UI（React + TypeScript），通过 **Management API** 完成配置、凭据、日志、配额与使用统计等管理操作。

[English](README.md)

- **LTS 核心项目**: https://github.com/BlueSkyXN/CPA-Core-LTS
- **原始上游核心项目**: https://github.com/router-for-me/CLIProxyAPI
- **原始上游面板项目**: https://github.com/router-for-me/Cli-Proxy-API-Management-Center
- **示例地址**: http://localhost:8317/management.html
- **LTS 基线**: 面板 `v1.8.4` 配套核心 `v6.9.49`
- **Core 集成**: latest release 发布 `management.html` 供 `CPA-Core-LTS` 下载

## LTS 计划

本仓库存在的原因是：上游管理面板在后续版本中改为依赖更轻量的 recent requests / API key usage 数据，并移除了完整的使用统计页面。本仓库用于继续维护完整统计 UI。

基线事实：

- 面板基线：`v1.8.4`
- 面板基线提交：`8ed837c3d734c3970a6d6799c557bb6a6753360d`
- 核心基线：`CPA-Core-LTS`，基于 `CLIProxyAPI v6.9.49`
- `v1.9.3` 仍保留完整统计实现，但 `v1.8.4` 是更靠后的 tag，也是统计移除路径开始前最后一个保留完整统计页面的面板 tag。
- 上游移除路径发生在该基线之后：`b25f722` 将 provider usage tracking 切到 recent requests，`632be0b` 删除了 `src/components/usage/*`、`src/pages/UsagePage.tsx`、`src/services/api/usage.ts`、`src/stores/useUsageStatsStore.ts` 以及相关统计工具。

维护规则：

- `main` 就是 LTS 主线，不再单独维护一个长期“统计分支”。
- 必须保留 `/usage` 页面、统计图表、请求事件表、模型/API/凭据维度拆分、导入导出、本地模型价格设置。
- 必须保持与 `CPA-Core-LTS` Management API usage endpoints 的兼容。
- 可以选择性跟进上游 UI 修复，但不要盲目同步会移除或削弱完整统计能力的上游改动。
- 后续轻量化改造可以移除推广文案、无用 UI、非 LTS 发布链路，但不能破坏使用统计契约。
- 文档与运行界面保持商业中立，不包含返利链接、注册优惠、付费推荐位，也不在空配置状态推荐特定品牌。
- Panel 的上游处理模式是 protected selective-port，不是 Core 那种 protected full-sync，因为 Panel upstream 直接删除了完整统计 UI 本身。

维护参考：

- `docs/lts/sync-runbook.md`
- `docs/lts/panel-feature-contracts.yaml`
- `docs/lts/panel-protected-deltas.yaml`
- `scripts/check-lts-panel-contract.sh`

从6.0.19版本开始，Web UI 随主程序一起提供；服务运行后，通过 API 端口上的"/management.html"访问它。`CPA-Core-LTS` 默认会从本仓库 latest release 下载名为 `management.html` 的资产。

## 这是什么（以及不是什么）

- 本仓库只包含 Web 管理界面本身，通过 CPA Core LTS / CLI Proxy API 的 **Management API**（`/v0/management`）读取/修改配置、上传凭据、查看日志与使用统计。
- 它 **不是** 代理本体，不参与流量转发。

## 快速开始

### 方式 A：使用 CLI Proxy API 自带的 Web UI（推荐）

1. 启动 CLI Proxy API 服务。
2. 打开：`http://<host>:<api_port>/management.html`
3. 输入 **管理密钥** 并连接。

页面会根据当前地址自动推断 API 地址，也支持手动修改。

### 方式 B：开发调试

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，然后连接到你的 CLI Proxy API 后端实例。

### 方式 C：构建单文件 HTML

```bash
npm install
npm run build
```

- 构建产物：`dist/index.html`（资源已全部内联）。
- 在 CLI Proxy API 的发布流程里会重命名为 `management.html`。
- `CPA-Core-LTS` 期望 latest release 中存在名称严格为 `management.html` 的资产。
- 本地预览：`npm run preview`

提示：直接用 `file://` 打开 `dist/index.html` 可能遇到浏览器 CORS 限制；更稳妥的方式是用预览/静态服务器打开。

## 连接说明

### API 地址怎么填

以下格式均可，Web UI 会自动归一化：

- `localhost:8317`
- `http://192.168.1.10:8317`
- `https://example.com:8317`
- `http://example.com:8317/v0/management`（也可填写，后缀会被自动去除）

### 管理密钥（注意：不是 API Keys）

管理密钥会以如下方式随请求发送：

- `Authorization: Bearer <MANAGEMENT_KEY>`（默认）

这与 Web UI 中"API Keys"页面管理的 `api-keys` 不同：后者是代理对外接口（如 OpenAI 兼容接口）给客户端使用的鉴权 key。

### 远程管理

当你从非 localhost 的浏览器访问时，服务端通常需要开启远程管理（例如 `allow-remote-management: true`）。  

## 功能一览（按页面对应）

- **仪表盘**：连接状态、服务版本/构建时间、关键数量概览、可用模型概览。
- **基础设置**：调试开关、代理 URL、请求重试、配额回退（达到上限时切换项目或预览模型）、使用统计、请求日志、文件日志、WebSocket 鉴权。
- **API Keys**：管理代理 `api-keys`（增/改/删）。
- **AI 提供商**：
  - Gemini/Codex/Claude/Vertex 配置（Base URL、Headers、代理、模型别名、排除模型、Prefix）。
  - OpenAI 兼容提供商（多 Key、Header、自助从 `/v1/models` 拉取并导入模型别名、可选浏览器侧 `chat/completions` 测试）。
  - Ampcode 集成（上游地址/密钥、强制映射、模型映射表）。
- **认证文件**：上传/下载/删除 JSON 凭据，筛选/搜索/分页，标记 runtime-only；查看单个凭据可用模型（依赖后端支持）；管理 OAuth 排除模型（支持 `*` 通配符）；配置 OAuth 模型别名映射。
- **OAuth**：对支持的提供商发起 OAuth/设备码流程，轮询状态，并可选提交回调 `redirect_url`。当所连接 Core 暴露 iFlow 运行时凭证文件时，面板仍会在凭证作用域中展示；本面板不再宣称存在未经当前 Core 管理 API 验证的导入端点。
- **配额管理**：管理 Claude、Antigravity、Codex、Gemini CLI 等提供商的配额上限与使用情况。
- **使用统计**：按小时/天图表、按 API 与按模型统计、缓存/推理 Token 拆分、RPM/TPM 时间窗、可选本地保存的模型价格用于费用估算。
- **配置文件**：浏览器内用源码/可视化模式编辑 `/config.yaml`（YAML 高亮 + 搜索），保存/重载；可配置 plugin store sources，以及 Core LTS 的 Codex 异常推理重试策略（命中动作、命中条件、流式缓存、对冲重试、耗尽策略、客户端用量聚合、交付/兜底策略、认证范围）。
- **日志**：增量拉取日志、自动刷新、搜索、隐藏管理端流量、清空日志；下载请求错误日志文件。
- **系统信息**：快捷链接 + 拉取 `/v1/models` 并分组展示（需要至少一个代理 API Key 才能查询模型）。

## 技术栈

- React 19 + TypeScript 5.9
- Vite 7（单文件构建）
- Zustand（状态管理）
- Axios（HTTP 客户端）
- react-router-dom v7（HashRouter）
- Chart.js（数据可视化）
- CodeMirror 6（YAML 编辑器）
- SCSS Modules（样式）
- i18next（国际化）

## 多语言支持

目前支持四种语言：

- 英文 (en)
- 简体中文 (zh-CN)
- 繁体中文 (zh-TW)
- 俄文 (ru)

界面语言会根据浏览器设置自动切换，也可在页面底部手动切换。

## 浏览器兼容性

- 构建目标：`ES2020`
- 支持 Chrome、Firefox、Safari、Edge 等现代浏览器
- 支持移动端响应式布局，可通过手机/平板访问

## 构建与发布说明

- 使用 Vite 输出 **单文件 HTML**（`dist/index.html`），资源全部内联（`vite-plugin-singlefile`）。
- 打 `v1-tls-0.0.1` 这类面板发布标签会触发 `.github/workflows/release.yml`，发布 `dist/management.html`。
- 使用 annotated tag：subject 写本版摘要，body 必须且只能包含一条 `Companion-Core: v*-tls-*`。工作流使用这份显式契约和 GitHub `generate-notes`，不再按发布时间或 PR 顺序推断兼容关系。
- 发布时只推送当前面板发布标签；跟进上游后不要使用 `git push --tags`。
- 页脚显示的 UI 版本在构建期注入（优先使用环境变量 `VERSION`，否则使用 git tag / `package.json`）。

## 安全提示

- 管理密钥会存入浏览器 `localStorage`，并使用轻量混淆格式（`enc::v1::...`）避免明文；仍应视为敏感信息。
- 建议使用独立浏览器配置/设备进行管理；开启远程管理时请谨慎评估暴露面。

## 常见问题

- **无法连接 / 401**：确认 API 地址与管理密钥；远程访问可能需要服务端开启远程管理。
- **反复输错密钥**：服务端可能对远程 IP 进行临时封禁。
- **日志页面不显示**：需要在“基础设置”里开启“写入日志文件”，导航项才会出现。
- **功能提示不支持**：多为后端版本较旧或接口未启用/不存在（如：认证文件模型列表、排除模型、日志相关接口）。
- **OpenAI 提供商测试失败**：测试在浏览器侧执行，会受网络与 CORS 影响；这里失败不一定代表服务端不可用。

## 开发命令

```bash
npm run dev        # 启动开发服务器
npm run build      # tsc + Vite 构建
npm run preview    # 本地预览 dist
npm run lint       # ESLint（warnings 视为失败）
npm run format     # Prettier
npm run type-check # tsc --noEmit
npm run check:feature-contract # feature contract 检查
npm run check:lts  # LTS 统计/发布/provider/plugin 契约检查
npm run validate:lts # check:lts + type-check + lint + build
npm run smoke:lts  # 可选：用 Python Playwright + mock Core API 做浏览器 smoke
npm run smoke:lts:core # 可选：对本地 CPA-Core-LTS checkout 做带鉴权 smoke
```

## 贡献

欢迎提 Issue 与 PR。建议附上：

- 复现步骤（服务端版本 + UI 版本）
- UI 改动截图
- 验证记录（`npm run validate:lts`，可选 `npm run smoke:lts` / `npm run smoke:lts:core`，或说明实际运行的更小范围检查）

## 许可证

MIT
