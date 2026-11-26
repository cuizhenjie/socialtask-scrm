# 全局设置中心（P1 第一阶段）

系统管理员访问 /admin/settings。GET /api/v1/settings 仅返回配置状态与非敏感运行参数，不返回 Secret、Callback Token、EncodingAESKey、CorpID 原值或模型密钥。普通成员和 manager 均返回 403。

当前配置真相源仍是服务端环境变量，沿用 infra/.env 与 .env.example，避免数据库与 Spring 启动环境出现双重真相源。请在部署秘密管理器中修改，并重启受影响服务。页面“重新检查”只做本地格式与存在性检查，不连接外部服务；CONFIGURED 不代表提供方已接受。

DSH 宿主模型设置与 SocialTask 登录独立。插件已有 OpenAI Chat Completions 兼容 CLI，BASE_URL 与 ENDPOINT 二选一，MODEL 和 API_KEY 由宿主安全注入；默认关闭外发、人工批准脱敏结构。后端配置页不读取宿主秘密，也不伪造连接状态。

后续：如果需要在线修改密钥，必须提供外部主密钥、加密存储、版本控制、轮换后缓存失效、审计与回滚；本阶段不提供在线凭据写入。微信客服与会话存档需独立配置与许可。
