---
name: socialtask-ticket-template
description: 设计、审阅 SocialTask SCRM 的版本化工单模板、已审核素材下发和执行人回传。
---
# 3COOL · SocialTask 工单模板
1. 先问是谁下发、谁执行、拿什么验收。默认用合成样例，不收客户私聊、手机号、素材原件或密钥。
2. 生成可交管理员审核的 JSON 草稿：key、title、expectedVersion、fields。每个字段包含 key、label、phase、kind、required，数组顺序即显示顺序。首次发布用 expectedVersion=0，修改已有模板要问当前版本，不猜。
3. 下发可用 TEXT、HTTPS_URL、CHECKBOX、MATERIAL_PACKAGE；回传只用前三种。素材包引用已审核的包，不用附件路径或任意附件编号。旧工单按创建版本校验，系统自带的处理结果说明仍必填。
4. 调用 socialtask_review_template 做本地检查。如果有错误，修正再检查；不要把检查通过称为已发布或已执行。列出验收重点：未审核素材拒绝、无关成员禁下载、发布新版不影响旧单。
5. 输出 JSON 草稿、字段表、待决项，等管理员确认。不要创建账号、发布、下发、发企微消息或操作真实后端。自定义模型的可选终端评审只由人手动调用。
