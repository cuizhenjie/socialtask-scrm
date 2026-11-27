# SocialTask SCRM · REST API v1

接口前缀：`/api/v1`。均按 JSON 返回（附件 GET 除外）。登录返回随机 token，后续原生 API 使用 `Authorization: Bearer <token>`；Next.js 客户端使用同源 `/api/proxy/*`，**不在浏览器 JavaScript 中读取 Bearer token**。时间入参使用 ISO-8601 UTC，例如 `2026-11-25T10:00:00Z`。

## 路由与角色

| 模块 | 方法 | 路径 | 权限和说明 |
|---|---|---|---|
| 基础 | GET | `/health` | 公共健康探针 |
| 认证 | POST | `/auth/login` | 用户名+密码；返回有效期 12h 的临时会话 |
| 认证 | POST | `/auth/logout` | 撤销会话 |
| 认证 | GET | `/me` | 当前用户 |
| 人员 | GET | `/people` | 管理员/经理查询 |
| 人员 | GET | `/people/assignees` | 可分派在用人员 |
| 人员 | POST | `/people` | 创建人员档案 |
| 人员 | POST | `/people/import` | 批量导入人员（单次最多 500 条，逐行校验，重复行不覆盖历史并返回失败明细） |
| 人员 | PATCH | `/people/{id}` | 更新人员状态/企业微信绑定 |
| 账号 | GET | `/people/{id}/accounts` | 人员社交账号档案 |
| 账号 | POST | `/people/{id}/accounts` | 新增抖音账号，保留历史 |
| 认证 | POST | `/people/{id}/credentials` | 为执行人创建登录账号 |
| 内容 | GET/POST | `/content-packages` | 创建/列表内容包 |
| 内容 | POST | `/content-packages/{id}/review` | 人工审核内容包 |
| 发布 | GET/POST | `/publish-batches` | 批量下发独立任务 |
| 任务 | GET | `/tasks` 或 `/me/tasks` | 管理员全部/执行人本人任务 |
| 任务 | GET | `/tasks/{id}` | 任务详情、素材、截图记录 |
| 任务 | POST | `/tasks/{id}/submissions` | 本人提交结果 |
| 任务 | POST | `/tasks/{id}/review` | 管理员审核通过/退回 |
| 任务 | POST | `/tasks/{id}/transfer` | 管理员转派（保留日志） |
| 任务 | POST | `/tasks/{id}/cancel` | 管理员取消任务 |
| 作品 | GET | `/works` | 经回传建立的作品档案 |
| 评论 | GET | `/comments` | 真实评论列表 |
| 评论 | GET/POST | `/works/{id}/comments` | 查询/人工录入评论 |
| 评论 | POST | `/works/{id}/comment-tasks` | 官方助理评论工单 |
| 客户 | GET/POST | `/customers` | 客户档案与可靠身份去重 |
| 客户 | GET | `/customers/{id}` | 必要客户信息、来源及时间线 |
| 客户 | GET | `/customers/{id}/timeline` | 客户任务历史 |
| 客户 | POST | `/customers/{id}/contact-permission` | 更新真实联系依据 |
| 客户 | POST | `/customers/{id}/contact-rounds` | 作者+助理首次联系 |
| 客户 | POST | `/customers/{id}/do-not-contact` | 禁止后续联系并终止未执行任务 |
| 文件 | POST | `/attachments` | `multipart/form-data`, `file`, `purpose=CONTENT\|PRIVATE_MESSAGE`；返回 `retention_until`（若配置保留期） |
| 文件 | GET | `/attachments/{id}` | 私有附件下载（按用途授权；已过期清理返回 410） |
| 通知 | GET | `/notifications` | Outbox 发送状态 |
| 日志 | GET | `/audit-logs` | 管理员审计日志 |
| 运维 | POST | `/ops/tick` | 管理员手动触发催办/回访/SLA/通知/附件到期清理 |
| 统计 | GET | `/dashboard` | 今日任务、客户等汇总 |

**异常约定**：401 未登录；403 越权；400 非法请求/素材/时间；404 记录不存在；409 业务状态冲突（重复作品、重复回访、不可提交等）。

## 示例：登录、创建人员、发布任务

```bash
BASE=http://127.0.0.1:8080/api/v1
curl -sS "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_ADMIN","password":"YOUR_SECRET"}'
# 从返回 JSON 中读取 access_token；以下示例将其放入 TOKEN 环境变量

curl -sS "$BASE/people" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"personNo":"S001","name":"参与者001","personType":"creator","groupName":"第一组"}'

curl -sS "$BASE/content-packages" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"真实内容审核样例","body":"已核实且不涉及虚假推广的内容","hashtags":"#记录","assetIds":[]}'

# 管理员先执行 /content-packages/{id}/review APPROVE，再下发批次
curl -sS "$BASE/publish-batches" -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"测试发布批次","contentId":1,"assigneeIds":[1],"deadline":"2026-12-01T10:00:00Z","reminderInterval":60,"reminderMax":10}'
```

## 任务状态和提交参数

统一状态：`PENDING → SUBMITTED → COMPLETED`，不通过则 `SUBMITTED → REWORK → SUBMITTED`。暂停：`PAUSED`，取消：`CANCELLED`，因客户回复/拒绝终止：`STOPPED`。每次提交新增 `task_submissions` 历史，`version` 自增。

- 作品发布：`POST /tasks/{id}/submissions`，body `{"payload":{"work_url":"https://www.douyin.com/video/<真实作品ID>"}}`，需按任务本人登录，作品链接去重。
- 官方助理评论：`{"payload":{"confirmed":true}}`，提交后管理员人工打开原评论区核验；不上传截图。
- 作者/助理及授权客服联系：先通过 `POST /attachments` 上传 `purpose=PRIVATE_MESSAGE` 的实际联系截图，随后 `{"payload":{"reply_status":"NO_REPLY"},"attachmentId":<图片ID>}`。状态为 `REPLIED | NO_REPLY | UNKNOWN | REFUSED`。
- 审核：`{"decision":"APPROVE"}` 或 `{"decision":"REJECT","reason":"需要重新核验"}`。
- 转派：`{"assigneeId":<人员ID>,"reason":"人工审核的转派原因","deadline":"2026-12-01T10:00:00Z"}`，其中截止日期可省略。

## 客户去重与后续联系

新建客户可提供 `externalUid` / `profileUrl`，只有明确 `identityVerified=true` 时才建立用于去重的哈希身份。如果缺失验证证据，不能根据昵称合并。一个客户可关联多个 `sourceWorkId` / 评论；身份产生冲突必须人工核验，系统不会自动覆盖档案。

联系任务必须存在有效的 `contactAllowed=true` 和说明性的 `consentBasis`；如客户明确拒绝，`do-not-contact` 将终止后续未执行任务。任一联系方反馈客户已回复/拒绝后，其他未执行的联系任务将立即停止。次日回访由服务端根据两条**已审核完成**的首轮任务和“都未回复”的结果进行判断，并要求合格的第三组授权客服。

本 API 不支持抖音自动登录、自动采集评论、自动发送私信，企业微信消息需要单独获授权、配置并联调。

---

## v1.1 新增：企业微信内部应用消息与聚合工作台

以下接口已编写，**未经企业微信真实账号授权、域名回调验证及线上请求验收**。本阶段只支持 `WECOM_APP` 自建应用内部成员的消息回调，**不读取客户联系的普通聊天、群聊或其他应用消息**。

| 方法 | 路径 | 鉴权 | 功能 |
|---|---|---|---|
| GET | `/wecom/config` | 管理员 | 返回出站开关、回调配置状态（不包含密钥） |
| GET | `/wecom/callback?msg_signature=&timestamp=&nonce=&echostr=` | 微信签名 | 自建应用回调 URL 验证，返回解密 challenge |
| POST | `/wecom/callback?msg_signature=&timestamp=&nonce=` | 微信签名 | 解密应用内成员消息，按 MsgId 幂等入库，返回 `success` |
| GET | `/wecom/inbox/conversations?q=` | 管理员 | 内部成员会话列表、未读数 |
| GET | `/wecom/inbox/conversations/{id}/messages` | 管理员 | 最近 200 条消息，REDACTED 为保留来源 ID 的已清理正文 |
| GET | `/wecom/inbox/conversations/{id}/tickets` | 管理员 | 最近 50 条来源消息关联的工单摘要 |
| POST | `/wecom/inbox/conversations/{id}/tickets` | 管理员 | 复用 TicketIn，必填当前会话且未清理的入站 sourceMessageId，可带模板版本与下发字段 |
| POST | `/wecom/inbox/conversations/{id}/read` | 管理员 | 将该会话设为已读（工作台级别） |
| POST | `/wecom/inbox/conversations/{id}/reply` | 管理员 | 对**已绑定内部成员**发送企业微信自建应用文本消息 |
| POST | `/tickets` | 管理员 | 创建人工服务工单，支持 `sourceMessageId` 关联真实已接收消息 |
| POST | `/notifications/{id}/retry` | 管理员 | 将失败/未配置通知重新放入待发送队列 |

企业微信消息卡片继续使用既有的 `textcard` API，跳转 `/m/tasks/{id}`。消息 `SENT` 仅代表调用接口成功，**不代表消息已被读取或实际到达终端**；额外记录 `provider_msgid`（如接口返回）。未配置的环境不标记发送成功。

### 企业微信回调配置

在 `infra/.env` 中配置：

```dotenv
WECOM_ENABLED=true
WECOM_CORP_ID=REPLACE_CORP_ID
WECOM_AGENT_ID=REPLACE_NUMERIC_AGENT_ID
WECOM_AGENT_SECRET=REPLACE_APP_SECRET
WECOM_CALLBACK_ENABLED=true
WECOM_CALLBACK_TOKEN=REPLACE_RANDOM_TOKEN
WECOM_ENCODING_AES_KEY=REPLACE_43_CHARACTER_KEY
WECOM_RETENTION_DAYS=90
APP_PUBLIC_URL=https://your-approved-domain.example
```

将企业微信自建应用接收消息 URL 配置为 `https://your-approved-domain.example/api/v1/wecom/callback`，由**你的 HTTPS 网关直接反代至 Java API 8080**；现有 Next.js BFF 路由 `/api/proxy/` **不是回调接入地址**。回调必须经公网 HTTPS、管理后台中相同的 Token/AESKey、正确的企业 CorpID 验证。测试完成前保持 `WECOM_ENABLED=false` 和 `WECOM_CALLBACK_ENABLED=false`。

## v1.1 新增：SLA 策略、人员标签与工单统计

| 方法 | 路径 | 鉴权 | 功能 |
|---|---|---|---|
| GET/POST | `/sla/policies` | 管理员 | 查询、新建 SLA 策略 |
| PUT | `/sla/policies/{id}` | 管理员 | 更新策略（只影响之后新建任务） |
| GET | `/tasks/{id}/sla` | 管理员 | 工单 SLA 快照和响应/完成时间 |
| POST | `/tasks/{id}/priority` | 管理员 | 修改**未首次响应**任务的优先级并重算 SLA |
| GET | `/people/groups` | 管理员 | 分组字典及人数 |
| POST | `/people/groups` | 管理员 | 创建分组 `{name,description}` |
| GET | `/people/tags` | 管理员 | 标签字典及人数 |
| POST | `/people/tags` | 管理员 | 创建标签 `{name}` |
| PUT | `/people/{id}/tags` | 管理员 | 全量替换人员标签 `{tagIds:[1,2]}` |
| GET | `/people?q=&role=&group=&status=&tagId=` | 管理员 | 人员角色、分组、标签筛选 |
| GET | `/tasks?q=&type=&status=&group=&tagId=&priority=&sla=` | 管理员/本人 | 统一工单筛选，`sla=BREACHED/AT_RISK/ON_TRACK/MET` |
| GET | `/reports/tickets?from=&to=&group=&tagId=&type=&status=&priority=` | 管理员 | 工单量、完成、首次响应/解决违约、分组、类型、人员、日趋势 |

示例 SLA：

```json
{
  "name":"官方客服工作时段 SLA",
  "taskType":"SERVICE_TICKET",
  "priority":"HIGH",
  "responseMinutes":30,
  "resolutionMinutes":240,
  "responseWarningMinutes":10,
  "resolutionWarningMinutes":30,
  "calendarMode":"BUSINESS_HOURS",
  "timezone":"Asia/Shanghai",
  "businessStart":"09:00",
  "businessEnd":"18:00",
  "workingDays":"1,2,3,4,5",
  "enabled":true
}
```

匹配规则：`task_type + priority` 精确优先，缺省降级到 `ALL + priority`；同一作用域唯一。首次响应记第一次执行人提交，解决记管理员审批通过。响应和解决为两个独立时钟，均按工单创建时间开始。业务截止时间 `tasks.due_at` 与 SLA 解决截止是不同概念。**当前不支持中国法定节假日例外、审批阶段时钟暂停或客户实际聊天的消息响应时刻**，工作时间日历仅处理星期和每日起止时间。

预警到期前产生 `SLA_RESPONSE_WARNING` / `SLA_RESOLUTION_WARNING` 工作台通知；违约触发 `SLA_RESPONSE_BREACH` / `SLA_RESOLUTION_BREACH`，每个工单每类型至多一次。管理员可在消息工作台人工处理。

### 普通服务工单创建

`POST /tickets`

```json
{
  "title":"客户资料确认",
  "description":"来自企业微信应用内的内部员工请求，需核实材料",
  "assigneeId":42,
  "deadline":"2026-11-30T10:00:00Z",
  "priority":"HIGH",
  "sourceMessageId":108
}
```

普通服务工单由客服或官方助理执行，通过 `POST /tasks/{id}/submissions` 提交 `{"payload":{"notes":"已核实并回传处理结果"}}`，随后由管理员审核。`sourceMessageId` 仅可引用本系统已成功接收的内部应用消息。



## v1.1 新增：客户分组与客户标签（与人员标签独立）

Flyway `V3__customer_segmentation.sql` 在不影响现有客户身份、联系许可和来源关系的情况下增加客户分类字典及关联：

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/customers?q=&status=&segmentId=&tagId=` | 管理员 | 客户昵称、编号、客户分组、客户标签、状态组合筛选 |
| GET/POST | `/customers/segments` | 管理员 | 查看 / 新增客户业务分组 |
| GET/POST | `/customers/tags` | 管理员 | 查看 / 新增客户业务标签 |
| PUT | `/customers/{id}/classification` | 管理员 | 更新单个客户的分组与标签，写入审计日志 |

示例请求：

```http
PUT /api/v1/customers/42/classification
Content-Type: application/json

{"segmentId":2,"tagIds":[1,3]}
```

更新客户分组/标签**不会**自动开启联系许可、解除客户拒绝联系，也不会以昵称为依据合并客户。迁移时旧客户统一进入默认“未分组”；如果后续需要多租户隔离、标签批量分配与客户归因维度统计，应单独增加对应模块与验收案例。

### 企微消息保留期与工单来源

超过 `WECOM_RETENTION_DAYS` 的未关联消息删除；已被工单引用的消息清除正文和 provider_msgid，保留来源行及 `REDACTED` 状态以满足外键和来源追溯。不会自动删除工单描述、处理结果或素材快照；工单保留周期另行制定。此逻辑不读取企微外部私聊。

## 全局设置

`GET /api/v1/settings`（仅 admin）：服务端环境配置状态、独立企微能力开关、外部渠道与宿主模型边界。不返回凭据，不调用外部接口。详见 [settings.md](settings.md)。

## 自建应用媒体及可靠发送（V6）

- `POST /wecom/inbox/conversations/{id}/reply`：`content` 与客户端生成的 UUID `requestId`；旧客户端不传时仍兼容，但不能跨请求去重。相同账号、会话、UUID 和内容在消息保留期内只产生一条持久化发送记录；更换内容返回 409。
- `POST /wecom/inbox/conversations/{id}/reply-media`：multipart `requestId`、`type`（image/voice/video/file）、`file`。图像和 AMR 2MB，其余按本系统 multipart 5MB 上限；媒体独立开关与出站开关须同时启用。
- `GET /wecom/inbox/messages/{id}/media`：管理员下载未过期的图片/语音/视频原件，固定官方 API，媒体 ID 不进入列表响应，下载以附件形式返回。有效期 3 天，未落地存档。
- 发送前先提交 SENDING 记录。ACCEPTED 是平台接受，FAILED 是明确拒绝，UNKNOWN 是超时等不确定结果；进程异常遗留 SENDING 五分钟后展示 UNKNOWN。不自动重发，操作人员核对后再决定。自建应用普通入站回调不承诺接收文件。

## 微信客服独立渠道（V7）

仅 admin 可调用 `GET /kf/state`、`GET /kf/conversations`、`GET /kf/conversations/{peer}/messages`，以及 `POST /kf/sync`（`{"confirm":true}`）。默认关闭，需独立 Secret、账号 ID、显式授权开关，配置不同于自建应用。每 60 秒最多拉取一页 100 条，服务器持久化游标与租约，重复消息去重，撤回正文清理，错误不推进游标。当前只读文本和非文本类型/事件元数据，未实现客户回复、媒体下载或自动身份关联。会话内容存档不等于微信客服；详见 docs/wechat-kf.md。

## SLA V8 日历、暂停与升级

策略 POST/PUT 新增 `closedDates`、`openDates`（逗号或换行分隔的本地 YYYY-MM-DD，最多各 730 日；仅 BUSINESS_HOURS）、`escalationMinutes`（违约后递增整数分钟，最多五级）。新工单快照日历、预警和升级参数。`POST /tasks/{id}/sla/pause` 传 `{"reason":"等待必要资料"}`，`POST /tasks/{id}/sla/resume` 无需请求体。管理员权限，未违约的活动任务可暂停；未结束阶段剩余工作时间原样恢复。暂停期间拒绝提交和审核，业务截止与业务催办独立。升级仅写 WORKBENCH 通知，唯一事件键保证不重复；不外发企业微信。`sla=CLOCK_PAUSED` 筛选及统计 summary.sla_paused 可用。历史 V8 前日历修改无法还原，迁移使用当时策略建立快照，不改旧到期时间或违约记录。

## 服务端 LLM 配置（V9）

`GET /settings/llm` 仅 admin 返回非秘密配置；`PUT /settings/llm` 提交 expectedVersion、enabled、url、baseUrl、model、可选 apiKey/clearKey。API Key 采用 AES-GCM 加密，不回显；端点必须属于部署允许名单，变更端点需重输或清除密钥。`POST /settings/llm/review` 接受 templateKey、version、approveSanitized=true，读取已发布模板，外发匿名字段结构，返回文本建议，绝不自动修改模板。默认未启用，无自动请求；详见 settings.md。
