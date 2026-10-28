# V8 上游增量审查（2026-10-28）

Panel 从 `829ec19dcd9075c39815966862c00e84e3194d11` 开始维护，审查官方 main
`714de0760a3ce86094b178fb46f834d34bc4a2a5` 至 `64b4f5aed19b8f791eb21eb9e785ea379ea05b44`
之间的三个提交。配套 Core 同步目标为官方 `9717e325ba6ab2c7483ea93ccb5f2047eb2e7dd5`。

| 上游提交 | 分类 | 处理与依据 |
|---|---|---|
| `f2e27103451ef7e909dc99f2ba47dff99697910b` | adapt-port，部分延期 | 吸收现有依赖的兼容升级：CodeMirror、Axios、React 19、React Router 7、YAML、Zustand、React types、typescript-eslint 8、Prettier、Sass、singlefile。保留 npm 和 package-lock。Bun 迁移及与现有基线跨 major 的 i18next/react-i18next、ESLint、Vite/plugin-react 升级延期，沿用此前工具链决策。 |
| `3dcd007b13f70509ef10bd53f59b7d813f1bcccf` | adapt-port | 四套现有语言的 Vertex 默认区域说明改为 `global`，对应本轮 Core 的 Vertex import 默认值。保留用户显式填写的区域。 |
| `64b4f5aed19b8f791eb21eb9e785ea379ea05b44` | already-equivalent | LTS README 与资产中已无 APIMart 赞助内容，无需再删除。 |

## Protected delta review

- 完整 usage 页面、导入导出、事件、定价和 provider 状态条保留。
- 配置继续使用 V8 API 与同一次读取的 ETag；LTS usage/Flow/插件扩展继续使用既有 v0 路由。
- Core 新增的未提供可视控件的配置项，继续由 YAML 编辑器保留；本轮不扩展配置 UI。
- 保留四套语言、现有页面结构、插件能力门控和 `management.html` 单文件产物。
- 不引入 Bun 或修改发布触发条件。

## 验证

`npm run validate:lts` 通过：703 tests，contract、type-check、build 通过；lint 保留一条既有 effect-cleanup warning。
本机使用已安装 Chrome 的 mock browser smoke 通过。配套临时 Core smoke 待 Core 同步完成后执行。
检查使用合成配置与临时实例，不访问生产配置或供应商账号。
