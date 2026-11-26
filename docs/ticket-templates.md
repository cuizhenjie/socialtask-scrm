# 服务工单模板与素材下发
在「工单模板」配置字段的标识、名称、顺序、阶段、类型及是否必填。发布并生成新版本后，在「统一任务中心 → 新建服务工单」选择模板和对应的已审核素材包。执行者到 H5 查看说明和素材，再按模板回传；原有不选模板的服务工单仍可使用。

- 下发字段：文字、HTTPS 链接、是/否、已审核素材包。素材包依旧走原来的 PNG/JPEG 上传和内容审核，不通过企业微信卡片直接发送附件。
- 回传字段：文字、HTTPS 链接、是/否；不支持回传文件。既有处理结果说明仍为必填。
- 工单保存创建时的模板、字段值与已审核素材包信息快照。已发布版本不会被原地修改；历史工单不受新版本影响。
- 素材下载仍走系统鉴权，只有管理员及当前被分派且未取消或停止的工单执行人可访问其素材；已有发布批次权限不变。
- 企微消息工作台可直接选择模板及已审核素材包，通过当前会话的入站消息建单，并查看关联工单；统一任务中心原有入口继续可用。
- 后端上线前应用 Flyway `V4__ticket_templates.sql`。不能以单元测试结果替代企业微信真机从收件到回单的联调。

## API（均经既有鉴权）
管理员通过 `GET /api/v1/ticket-templates` 获取各模板当前版本，通过 `POST /api/v1/ticket-templates` 追加版本。例如：

```json
{
  "key":"material_dispatch",
  "expectedVersion":0,
  "title":"内容素材发放",
  "fields":[
    {"key":"assets","label":"已审核素材包","phase":"DISPATCH","kind":"MATERIAL_PACKAGE","required":true},
    {"key":"work_url","label":"作品链接","phase":"RESPONSE","kind":"HTTPS_URL","required":true}
  ]
}
```

向 `POST /api/v1/tickets` 提交原建单字段，并增加 `templateKey`、`templateVersion` 和 `fieldValues:{"assets":12}`。这里 12 为已审核素材包 ID，而非任意附件 ID。工单详情的既有 `payload_json` 持有 `template_snapshot`。提交结果时用 `payload: {"notes":"已完成","fieldValues":{"work_url":"https://example.org/work"}}`。

本地仅运行模板规则单元测试：`cd services/api && mvn -Dtest=TicketTemplateTest test`。使用项目既有的隔离 MySQL 和 Flyway 测试配置运行 `TicketTemplateIntegrationTest`，验证实际素材下载权限及历史版本隔离。
