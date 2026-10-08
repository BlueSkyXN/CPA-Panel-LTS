# ZCode Coding Plan 凭据提取工具

`scripts/zcode-credentials.mjs` 是独立 Node.js 命令行工具，用于读取本机 ZCode 保存的凭据、解密 `enc:v1` 字段，以及按需查询已有的个人或团队项目 key。它没有接入 Panel 网页，不会自动填写账号表单。

需要 Node.js 20 或更新版本，无额外依赖。**正常运行会向终端输出完整明文凭据，包括 OAuth token、API key 和派生材料；`--v4` 还会输出签名私钥。请在自己的终端使用，不要把输出粘贴到日志、Issue 或截图中。**

## 本地读取

```sh
node scripts/zcode-credentials.mjs
```

默认检查桌面设置指定的数据目录、`ZCODE_DATA_BASE_DIR` 和 HOME 下的旧目录，保留每条候选的来源，并对相同 key 去重。也可用 `--data-dir /path/to/data/.zcode/v2` 指定包含 `credentials.json` 的目录。

桌面 `setting.json` 与凭据文件可能不在同一目录。显式指定当前活动数据目录时，工具仍读取与它关联的桌面套餐选择；无关目录不会继承本机的团队选择。目录内自身存在的设置优先。

Coding Plan 候选支持国内 BigModel 和国际 Z.ai。Start Plan provider 的 JWT 不进入 Coding Plan API key 候选，也不计入候选数量。缓存字段名只作为线索，不据此断言个人／团队归属或套餐可用性。

## 查询已有云端 key

```sh
node scripts/zcode-credentials.mjs --remote --region bigmodel
```

工具使用本地 OAuth 凭据查询项目、列出已有 key，并通过复制接口取得 secret，组成完整的 `ID.SECRET`。默认读取个人项目和当前选中的团队项目；`--all-projects` 显式扩展到其他可访问项目。国际账号使用 `--region zai`。

云端获取只查询已有 key，不创建、不轮换 key，也不刷新登录 token。没有已有 key、授权失效或项目不可访问时会报告错误；取得 key 不代表已经验证模型调用、额度或计费待遇。

## 可选 V4 握手诊断

```sh
node scripts/zcode-credentials.mjs --remote --region bigmodel --v4 --app /path/to/ZCode.app
```

`--v4` 会向模型服务的握手接口申请签名私钥，并生成一组未发送到模型的示例签名。它不调用模型。应用安装在非标准目录时使用 `--app`，或通过 `--client-version` 明确指定要对照的版本。不要把诊断生成的私钥、时间戳、nonce 或签名头写进 CPA 账号文件；插件自行完成握手和逐请求签名。

## 保存到 CPA

Panel 新建 ZCode 账号只需手工填写完整 API key。设备 ID 可手填；留空时新账号生成一次 UUID，编辑时保留已保存值。直接上传 JSON 则必须提供完整 `api_key` 和非空 `device_id`。Panel 保存时统一 `request_retry: 0`，并清除旧 `config_file` 引用。

## 验证

```sh
npm run test:zcode-credentials
```

自测只使用临时合成数据与模拟网络，覆盖本地解密、来源去重、Start Plan 排除、分离的桌面设置／活动数据目录、个人／团队远端查询、区域鉴权差异和 V4 计算。该命令已接入 `test:auth-files`，不会读取真实凭据或调用真实云端接口。
