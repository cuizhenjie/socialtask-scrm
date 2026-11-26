---
name: socialtask-account
description: 查看 SocialTask SCRM 自己的账号密码登录方式和配置好的登录地址。
---
# SocialTask 登录入口
1. 调用 `socialtask_account_entry` 查询这个 DSH 主机是否配置了 SocialTask 的部署地址。如果结果为 ready，原样显示链接。地址不由聊天内容指定，不伪造或自动访问。
2. 用户在自己的浏览器进入 SocialTask 登录页，默认用 **SocialTask 账号和密码** 登录。插件不弹出凭据录入，不读取或存储密码、令牌、Cookie，也不代登录。
3. 若未配置，建议向系统管理员确认可信部署地址并直接在浏览器打开 `/login`，不要猜公网域名。可由维护 DSH 的人通过 `SOCIALTASK_APP_URL` 预设地址。
4. DSH 本身的欢迎/登录和模型 API Key 设置独立于 SocialTask。不要叫用户把 SocialTask 密码放到 DSH 的聊天或模型密钥框。
