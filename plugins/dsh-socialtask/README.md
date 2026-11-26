# 3COOL · SocialTask SCRM

让 DSH 对话中的工单范围定义、素材字段设计和验收证据核对可以重复使用。借鉴 [歸藏设计](https://github.com/op7418/dsh-guizang-design)「插件包 + 随包技能 + 工作流」的组织方式，独立实现。没有引入参考插件的代码、资源或构建依赖。

## 安装与试用

本包是装入 **DSH Desktop 或 Web** 的独立插件，不是 DSH 本体、独立 CRM 桌面客户端、Windows `.exe` 或 macOS `.dmg`。需要 DSH `0.2.2-rc.5` 或更高的 0.2.x 版本；低于要求时更新宿主，不关闭兼容校验。Web CLI / 自行打包需要 Node.js 24.9+，使用新版 DSH 时还需满足该宿主的 Node 版本要求。插件没有构建依赖、安装脚本或原生模块。

### Desktop：不发布 npm，也能从本地文件安装

1. 启动官方桌面宿主，让它初始化默认工作区。若没有安装宿主，先从 [官方发布页](https://github.com/deepseek-ai/deepseek-harness/releases) 获取你的系统版本。
2. 在 Desktop 侧栏打开「插件 → 添加插件」。把下载好的 `dsh-socialtask-0.2.1.tgz` **绝对本地路径**填到安装输入框，保留默认镜像即可。比如 Windows `C:\Users\你的用户名\Downloads\dsh-socialtask-0.2.1.tgz`；macOS `/Users/你的用户名/Downloads/dsh-socialtask-0.2.1.tgz`。不用解压，也不用填 npm 包名。
3. 安装后点「立即启用」（或在插件列表启用），需要时重启 Desktop。新会话输入 `/socialtask-account`、`/socialtask-ticket-template` 或 `/socialtask-acceptance` 检查是否可用。
4. 已装旧版且提示同名存在时，按 Desktop 的插件管理页卸载该插件，再装新包。卸载也在同一入口完成。

依据：[官方插件安装对话框支持 tarball 和本地路径](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/client/ui-plugin-manager/README.md)；[Desktop 使用同一插件管理服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/apps/desktop/README.md#bundled-command-runtime)。如果使用终端，必须在 Desktop 首次启动、完全退出后，使用 **Desktop 自带的 dsh**，而不是 npm 安装的 CLI：

```powershell
dsh plugin --profile desktop add "$HOME\Downloads\dsh-socialtask-0.2.1.tgz"
```

macOS 命令为 `dsh plugin --profile desktop add "$HOME/Downloads/dsh-socialtask-0.2.1.tgz"`。重开 Desktop 后启用。如果没有 `dsh` 命令，可在 Desktop 应用菜单安装自带命令，或优先用图形安装方式。检查 `dsh --version`，确认不是另外装的 npm CLI。

### Web 兼容安装

```sh
# 使用已有 web profile，安装前先停止该 profile。
dsh plugin --profile web add "/absolute/path/dsh-socialtask-0.2.1.tgz"
dsh --profile web --dump-config
dsh --profile web
# 撤回：dsh plugin --profile web remove dsh-socialtask
```

### 用 SocialTask 系统账号和密码登录

- `/socialtask-account` 只提供工作台入口。在 **SocialTask 自己的登录页面**输入 SocialTask 账号和密码；插件、DSH 和模型都不接收账号密码、令牌或 Cookie，也不会自动打开或登录。
- DSH 维护者可在 DSH 宿主启动环境设置 `SOCIALTASK_APP_URL` 为经过核验的 SocialTask 部署地址（例如 `https://crm.example.test`），然后重启宿主。仅 HTTPS 可用（本机开发可用 HTTP）；不要在地址中附带用户信息、查询参数或令牌。桌面图标启动的应用不一定继承终端环境，未能注入时请自己在浏览器打开系统管理员确认的 `/login` 地址。插件没有预填生产域名。
- 宿主自身登录、外部模型 API Key 与 SocialTask 登录完全独立。

### 工作流

- `/socialtask-ticket-template`：草拟模板、明确字段和审核规则、掌握版本升级；用内置工具检查 JSON。
- `/socialtask-acceptance`：区分模板、模拟企微、真机三套检查项；汇总已知失败和待补证据。
- 三个原生工具均为只读：工单检查只消费本次调用参数，账号入口只读取宿主配置的地址；不读取会话历史、真实后端、企微或素材文件，不替代真实业务验收。
- 插件图标使用 [三酷科技官网原版 Logo](https://www.3cool.cc/3cool.png)。

## 自定义模型地址、模型和密钥

**DSH 对话与技能**：设置 → Models → Add model provider → Custom model API，填 Provider ID、API 协议、Base URL、API 密钥，以及对应 Model ID。选择服务实际支持的协议，例如 OpenAI Chat Completions，并在对话模型选择器指定该模型。不要把密钥写入聊天、技能文件或仓库。对话本身按 DSH 的模型配置发送给所选供应商，该过程不由插件代理。详见 [DSH 模型指南](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)。

**插件的独立、可选人工评审命令**：通过 OpenAI Chat Completions 兼容网关辅助判断字段顺序与必填设置，不影响 DSH 的会话模型。默认关闭且未注册成 agent 工具，只有终端用户主动调用命令并确认脱敏才会尝试请求。仅外发字段位置、阶段、类型、是否必填，不发送模板名称、字段键名/标签、工单原文、素材、身份或会话历史。模型 ID 关联所选网关。Key 作为 Bearer 凭证仅发送到配置的单个地址；不跟随重定向，不重试。请信任你配置的服务并按其计费使用，未测试任何真实模型或密钥。

```sh
# 普通使用完全离线。也可将 node lib/cli.js 换成已安装的 dsh-socialtask 命令。
node lib/cli.js review-template < examples/material-template.json
printf '{}' | node lib/cli.js assess-evidence wecom-device
# 可选人工外部评审。密钥由环境/秘密管理器注入，不要写在命令历史或脚本中。
export SOCIALTASK_LLM_ENABLED=1
export SOCIALTASK_LLM_BASE_URL='https://gateway.example/v1'
# 或设置 SOCIALTASK_LLM_ENDPOINT='https://gateway.example/openai/chat/completions'
# BASE_URL 与 ENDPOINT 二选一；BASE_URL 会自动追加 /chat/completions，ENDPOINT 原样使用。
export SOCIALTASK_LLM_MODEL='your-model-id'
# 预先从秘密管理器注入 SOCIALTASK_LLM_API_KEY
node lib/cli.js model-review --approve-sanitized < examples/material-template.json
```

原生插件既不会自动发企微消息、操作生产后台或创建真实工单，也没有素材下载、落库、发布等运行时权限。真实联调另行授权和验收。

## 开发

```sh
npm test
npm run pack:desktop -- ./dist
```

构建输出通用的 `dsh-socialtask-0.2.1.tgz`，脚本核验图标、内含文件并打印 SHA-256。包不需要在 npm 注册发布。

参考 [DSH 打包安装](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish.html) 与 [DSH 原生工具接口](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)。

CI 追加离线 Desktop tarball 打包检查（不发布 npm、不安装宿主）。可在当前提交的 GitHub Actions `web-build` 下载 `socialtask-desktop-plugin` artifact，包含 TGZ 与打包 SHA-256 记录。`node lib/cli.js model-config-check` 仅校验宿主配置，返回脱敏状态，不请求模型。服务端管理台的 LLM 配置与 DSH 宿主完全独立。
