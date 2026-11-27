# 全局设置中心（P1 第一阶段）

系统管理员访问 /admin/settings。GET /api/v1/settings 仅返回配置状态与非敏感运行参数，不返回 Secret、Callback Token、EncodingAESKey、CorpID 原值或模型密钥。普通成员和 manager 均返回 403。

当前配置真相源仍是服务端环境变量，沿用 infra/.env 与 .env.example，避免数据库与 Next.js 启动环境出现双重真相源。请在部署秘密管理器中修改，并重启受影响服务。页面“重新检查”只做本地格式与存在性检查，不连接外部服务；CONFIGURED 不代表提供方已接受。

DSH 宿主模型设置与 SocialTask 登录独立。插件已有 OpenAI Chat Completions 兼容 CLI，BASE_URL 与 ENDPOINT 二选一，MODEL 和 API_KEY 由宿主安全注入；默认关闭外发、人工批准脱敏结构。后端配置页不读取宿主秘密，也不伪造连接状态。

后续：如果需要在线修改密钥，必须提供外部主密钥、加密存储、版本控制、轮换后缓存失效、审计与回滚；本阶段不提供在线凭据写入。微信客服与会话存档需独立配置与许可。

## V9 服务端模型在线配置

部署管理员先通过秘密管理器设置 SOCIALTASK_CONFIG_KEY（32 个随机字节的标准 Base64，妥善备份，不提交仓库）及 SOCIALTASK_LLM_ALLOWED_ORIGINS（逗号分隔的准确 HTTPS origin，无路径、查询或凭据）。建议网络层仅允许访问批准的供应商/自建模型出口，避免 DNS 或代理误配置。管理台可保存启用状态、Base URL/Chat Completions 端点、Model ID、新 API Key 或清除密钥；乐观版本控制，AES-256-GCM 随机 nonce 和版本 AAD。变更端点需重新输入或显式清除密钥。主密钥遗失不能恢复旧密钥；部署主密钥轮换须先另行迁移/重新设置。

服务端模型与 DSH 宿主配置独立；管理员明确确认后可对已发布模板做脱敏评审，发送字段位置、阶段、类型、必填标志，不发送名称、键名、原文、附件或客户数据。无重定向、不自动重试、响应有界、不自动应用建议。未使用真实模型请求。企业微信在线凭据轮换仍未实现，避免跨企业身份误关联。
