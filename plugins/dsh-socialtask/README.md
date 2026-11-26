# SocialTask SCRM · DeepSeek Harness 插件

让 DSH 对话中的工单范围定义、素材字段设计和验收证据核对可以重复使用。借鉴 [歸藏设计](https://github.com/op7418/dsh-guizang-design)「插件包 + 随包技能 + 工作流」的组织方式，独立实现。没有引入参考插件的代码、资源或构建依赖。

## 安装与试用

适用于支持第三方 bundle 的 DSH Web profile，Node.js 24.9+，DSH 0.2.2-rc.5 起至 0.3.0 前。安装只加载随包 JS 与 Markdown，不执行安装脚本。用独立 profile 更方便回滚。

```sh
# 从本目录构建本地包（无需先 npm install）
npm test
npm pack
# 用绝对路径，避免 profile 安装时改变相对路径含义
dsh plugin --profile socialtask add "$PWD/dsh-socialtask-0.1.0.tgz"
dsh --profile socialtask --dump-config
# Web 界面：使用自己的 web profile，或在新 profile 引导时选择 web
# 现有 web profile 也可: dsh plugin --profile web add "$PWD/dsh-socialtask-0.1.0.tgz"
dsh web --profile web
# 撤回：dsh plugin --profile socialtask remove dsh-socialtask
```

可用命令（在支持第三方技能的对话输入框内）：

- `/socialtask-ticket-template`：草拟模板、明确字段和审核规则、掌握版本升级；用内置工具检查 JSON。
- `/socialtask-acceptance`：区分模板、模拟企微、真机三套检查项；汇总已知失败和待补证据。
- 两个原生工具均只消费本次调用参数，无读取会话历史、真实后端、企微或素材文件的权限；工具不验证传入证据链接是否真实，也不会将工具通过当成真实业务验收。

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
npm pack --dry-run
```

参考 [DSH 打包安装](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish.html) 与 [DSH 原生工具接口](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)。
