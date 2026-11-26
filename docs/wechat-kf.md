# 微信客服 P2 第一阶段（只读）

实现独立 /admin/kf 与 /api/v1/kf，默认关闭。参考企业微信接口文档入口 https://developer.work.weixin.qq.com/document/path/94670 及接口镜像 https://qiyeweixin.apifox.cn/api-10061327 。原官方页面访问受限，实际接入需核实企业许可与接口版本。

- 在企业后台授权指定微信客服账号，通过独立 WECOM_KF_SECRET 获取 token，配置 WECOM_CORP_ID、WECOM_KF_ACCOUNT_ID（wk…）、WECOM_KF_AUTHORIZED=true、WECOM_KF_ENABLED=true。应用 Secret 不得复用。
- 当前采用管理员明确确认后 POST /cgi-bin/kf/sync_msg 单页拉取。无 callback token 的请求受平台严格频率限制；本地每 60 秒最多一页，不自动循环或后台拉取。has_more 为 1 时允许后续手动继续；平台允许最近约 3 天记录，不承诺完整历史。
- 不存储原始外部用户 ID、媒体 ID、欢迎语 code、场景参数或原始 JSON。账号、客户与消息 ID 按不同命名空间哈希，撤回清除正文；哈希标识仍属于需保护的数据。默认保留 30 天（1–90），每日清理。管理员之外拒绝访问。
- 独立数据表，不自动合并客户、授权联系人或人员，不自动回复客户。授权开关关闭后页面不可读取该渠道记录。
- 会话存档为另一个独立产品：需要企业购买/启用对应许可、员工告知及外部客户同意，并通过官方 SDK 及密钥完成分页拉取、解密和媒体读取。参考 https://developer.work.weixin.qq.com/document/path/91774 。当前不内置 SDK，不支持存档数据读取或普通私聊回复。

没有调用真实企微接口或使用真实客户数据。CI 使用合成响应和模拟 transport。后续可在取得许可后扩展独立加密回调、带短期 callback token 的队列同步、客户会话状态及受限回复、媒体处理和存档 SDK 适配器。
