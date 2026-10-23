# ZCode Coding Plan 凭据提取工具

`scripts/zcode-credentials.mjs` 是独立 Node.js 命令行工具，用于读取本机 ZCode 保存的凭据、解密 `enc:v1` 字段，以及按需查询已有的个人或团队项目 key。它没有接入 Panel 网页，不会自动填写账号表单。

需要 Node.js 20 或更新版本，无额外依赖。**正常运行会向终端输出完整明文凭据，包括 OAuth token、API key 和派生材料；`--v4` 还会输出签名私钥。请在自己的终端使用，不要把输出粘贴到日志、Issue 或截图中。**

## 本地读取

```sh
node scripts/zcode-credentials.mjs
```

默认检查桌面设置指定的数据目录、`ZCODE_DATA_BASE_DIR` 和 HOME 下的旧目录，保留每条候选的来源，并对相同 key 去重。也可用 `--data-dir /path/to/data/.zcode/v2` 指定包含 `credentials.json` 的目录。Windows 上如果数据不在 `%USERPROFILE%\.zcode\v2`，同样用 `--data-dir` 指向实际目录。脚本只使用 Node 内置模块，官方 zip 解压出的 `node.exe` 即可运行，不需要 `npm install`。

桌面 `setting.json` 与凭据文件可能不在同一目录。显式指定当前活动数据目录时，工具仍读取与它关联的桌面套餐选择；无关目录不会继承本机的团队选择。目录内自身存在的设置优先。

Coding Plan 候选支持国内 BigModel 和国际 Z.ai。Start Plan provider 的 JWT 不进入 Coding Plan API key 候选，也不计入候选数量。缓存字段名只作为线索，不据此断言个人／团队归属或套餐可用性。

解密必须在生成凭据的那台电脑上运行，或者显式提供加密时的环境。未设置 `ZCODE_CREDENTIAL_SECRET` 时，密钥由平台、用户主目录和用户名派生；这三个值必须与加密时逐字一致。把 `credentials.json` 复制到另一台电脑时，三个参数要一起给：

```sh
node scripts/zcode-credentials.mjs \
  --data-dir /path/to/copied/.zcode/v2 \
  --cipher-platform win32 \
  --cipher-homedir 'C:\Users\对方用户名' \
  --cipher-username 对方用户名
```

Windows 的平台值是 `win32`，不是 `windows`。在原电脑上运行时不要加这三个参数。设置了 `ZCODE_CREDENTIAL_SECRET` 时，以该环境变量为准。

## 查询已有云端 key

```sh
node scripts/zcode-credentials.mjs --remote --region bigmodel
```

工具使用本地 OAuth 凭据查询项目、列出已有 key，并通过复制接口取得 secret，组成完整的 `ID.SECRET`。默认读取个人项目和当前选中的团队项目；`--all-projects` 显式扩展到其他可访问项目。国际账号使用 `--region zai`。

云端获取只查询已有 key，不创建、不轮换 key，也不刷新登录 token。没有已有 key、授权失效或项目不可访问时会报告错误；取得 key 不代表已经验证模型调用、额度或计费待遇。

每个查询仅在网络错误或 15 秒超时后重试，最多尝试 6 次，重试间隔依次为 0.5、1、1.5、2、2.5 秒。HTTP 错误、重定向、业务拒绝和无效响应不会重试，重定向不会被跟随。输出中 `remote[].attempts` 记录该来源的实际 HTTP 请求总次数（包含项目列表、复制 key 和重试），`remote[].errors` 保留对应错误；部分项目成功时仍报告 `partial`。

## 可选 V4 握手诊断

```sh
node scripts/zcode-credentials.mjs --remote --region bigmodel --v4
```

`--v4` 会向模型服务的握手接口申请签名私钥，并生成一组未发送到模型的示例签名。它不调用模型，也不会自动重试握手。签名消息和 `X-Client-Version` 默认使用 `3.14.3`，与插件 `signing.go` 一致，不自动探测本机安装版本。

原有诊断参数仍可使用：`--client-version VERSION` 显式覆盖版本；`--app /path/to/ZCode.app` 在 macOS 上读取指定应用的版本，两者同时出现时以 `--client-version` 为准。指定应用的版本读取失败时跳过 V4 握手并报告错误，Windows/Linux 上用 `--client-version` 指定诊断版本。覆盖版本只影响工具生成的示例，不会修改插件配置。

不要把诊断生成的私钥、时间戳、nonce 或签名头写进 CPA 账号文件；插件自行完成握手和逐请求签名。

## 保存到 CPA

Panel 新建 ZCode 账号只需手工填写完整 API key。设备 ID 可手填；留空时新账号生成一次 UUID，编辑时保留已保存值。直接上传 JSON 则必须提供完整 `api_key` 和非空 `device_id`。Panel 保存时统一 `request_retry: 0`，并清除旧 `config_file` 引用。

## 验证

```sh
npm run test:zcode-credentials
```

自测只使用临时合成数据与模拟网络，覆盖本地及异地解密、自定义密钥优先级、来源去重、Start Plan 排除、分离的桌面设置／活动数据目录、个人／团队远端查询、重试上限、错误归属、旧版本参数、区域鉴权差异和 V4 计算。该命令已接入 `test:auth-files`；自测会隔离当前进程的 ZCode 数据目录和加密密钥环境变量，不会读取真实凭据或调用真实云端接口。
