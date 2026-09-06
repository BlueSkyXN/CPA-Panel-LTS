# Flow Control Panel：当前入口

配套 Core 产品指南：`docs/lts/flow-control.md`。本目录实现通用规则编辑与只读运行解释，不再维护一套不同的后端调度说明。

## 开关与草稿

三个服务端开关：`flow-control.enabled`、`observation.realtime`、`observation.resources`，默认均false。页面草稿与Core实际开关分别展示，保存并刷新后才确认生效。关闭实时不会自动改成GET轮询；关闭资源采样后，新汇总中缺失的resources会清掉旧样本。

关闭流控不取消正在执行的请求、删除规则或清空已有许可。关闭期间新调用不进入受控计数，不能把观察摘要当成全站并发。启用但无规则仅记录已接入调用，不限制并发；页面明确提示。

配置应用失败时Core继续使用最后成功策略，页面显示失败原因与时间。`configuration-error`不是请求全部不可用的标记。保存API返回409时不写文件；保存成功后仍要看运行策略，不能把文件内容当成已经应用。

首次没有Flow规则时直接编辑默认关闭的version3草稿，仅查看或编辑其他字段不创建Flow配置。已有非空旧规则才要求迁移，不静默升级；被移除目录中的已保存选择仍保留，空集合不等于全部。

## 模型目录

request层复选公开别名；attempt层使用Core返回的已解析目标。只有`features`含`resolved-model-options`时才采用`model-options`作为目标目录，旧Core的公开名称不作替代。目录标签显示`provider · actual ← public aliases`。

模型池可对应多个真实目标。共享限制应选中全部目标并使用不包含model的分组，单模型限制则包含model。目录只描述已知路由，插件后续重写应单独确认。截断时提示，仍允许手填明确目标。

切换请求/执行阶段会清空当前模型选择，需要按新语义重新选择，不自动把别名拼成上游目标。

## 文件职责

- `FlowControlFields.tsx`：主开关、草稿/实际状态、队列和迁移入口。
- `FlowRuleEditor.tsx`：一条通用规则，不加入特定模型专用分支。
- `SelectionField.tsx`：搜索复选、全部/明确集合、保存的未列出选项。
- `RuleInspector.tsx`：调用Core的只读解释，显示本阶段容量与交叉矩阵。
- `LiveMonitor.tsx`：汇总、资源样本、手动分页详情，不在每次SSE后自动请求详情。
- `useStatus.ts`：可停止观察、标签页暂停、仅重连观察、按策略变化刷新目录。
- `model.ts` / `yaml.ts`：数据校验与仅编辑字段写回，保留未知字段及注释。

## API

继续使用原管理认证及`PUT /config.yaml`。GET `/flow-control`返回能力、配置和运行结果；GET `/summary`、`/events`、`/details`分别负责汇总、SSE、分页详情；POST `/preview`、`/migration-preview`只读解释。所有上述相对路径均位于`/v0/management/flow-control`下。

schema仍为3。新增可选字段：`configuration-failure`、`configured-policy`、`model-options-truncated`、目标`aliases/accounts`，并增加`resolved-model-options/last-good-policy`特性声明。未保存草稿、已保存期望策略、已应用策略分开处理。

旧单目标explain继续可用，非法停用草稿返回不完整说明；不是panic或默认放行。预览是某个阶段当前的容量判断，不预留许可、不替代完整路由和首次联合申请。

## 本地完整检查

```sh
npm ci
npm run test:flow-control
npm run test:codex-remote
npm run check:lts
npm run type-check
npm run lint
npm run build
```

`model/insights/refinement.test.mjs`可在实际TypeScript下独立执行，不能据此宣称YAML、React或浏览器通过。`yaml/view.test.mjs`需要项目真实依赖。不得以手写模块替身验证完整构建。
