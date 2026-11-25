# SocialTask SCRM · 正式工程 v1.1（SLA / 企业微信应用消息增强候选版）

> 基于《素人代发任务管理系统｜完整 SOP 及技术需求文档》开发的独立正式技术栈工程。**源码已编写，尚未通过全量构建、真实浏览器、MySQL/Flyway 及外部平台联调，因此不是可直接公网生产发布的版本。**

## v1.1 本轮新增

- **工单 SLA 可配置**：按工单类型/优先级设置首次响应、解决时限、工作日/工作时间与提前预警；工单独立快照，不追溯覆盖历史。管理页 `/admin/sla`。
- **服务工单**：`SERVICE_TICKET` 支持直接创建、下发、执行人填写结果、管理员审核，并可与已接收的企微内部应用消息关联。
- **双侧分组/标签**：人员业务分组和执行标签管理，以及独立的客户分组和客户业务标签；人员/任务/客户列表按各自属性筛选，不混用员工与客户标签。
- **工单统计**：`/admin/reports` 汇总完成量、待审量、响应 SLA 违约、解决 SLA 违约、人员/分组/类型分布与日期趋势。
- **企微应用消息工作台**：`/admin/messages` 支持自建应用回调验签解密、内部成员消息入库、会话列表、已读、管理员通过官方应用接口回复、创建关联服务工单，并保留原通知 Outbox 状态。
- **出站通知可靠性**：短事务领取+重试+平台消息号；`SENT` 只意味着平台 API 接受，不等于终端送达。

**重要范围**：本版本不能直接聚合企业微信所有客户私聊或微信群聊天。员工与客户之间的会话需要另行申请微信客服接口或合规的会话内容存档能力，并落实客户知情同意。**真实企业微信接口未联调，消息卡片未实机测试**。查看 `docs/API.md` 与 `docs/acceptance.md`。

### 从 v1.0 升级

保留原 MySQL 数据，不修改 V1 迁移；将本版本代码部署到现有工程，启动 Spring Boot 时 Flyway 依次执行 `V2__inbox_sla_tags.sql`、`V3__customer_segmentation.sql`，累计新增 **10 张表** 和若干字段/索引，旧任务 SLA 以可获取的历史时间回填，历史客户自动归入“未分组”。**在非生产环境备份、执行迁移并验收后才能升级生产**。如仍是纯新环境，V1、V2、V3 将依次执行。切勿把 Python/SQLite 演示数据直接复制到 MySQL。

正式接收企微消息需配置 `WECOM_CALLBACK_ENABLED`、回调 `Token` / `EncodingAESKey`、企业 `CorpID`，并用获准的 HTTPS 回调 URL 直达 Java API。申请与配置步骤见 `docs/API.md`。

## 系统简介

业务中心以真实人员为基础、作品为业务入口、任务为执行载体、客户为统一数据对象：

1. 管理员建立人员、账号、分组；为本人/获授权的员工创建登录凭据。
2. 管理员上传合规图片和内容包，经人工审核后下发发布批次；每个执行人收到独立任务。
3. 员工通过移动 H5 人工发布内容、回传抖音作品链接，管理员验收并建作品档案。
4. 官方助理接收公开评论工单，确认后由管理员打开原作品人工核验；真实评论由管理员录入。
5. 发现真实有意向客户时，先识别身份与联系依据，再建立唯一客户档案，并关联作品、评论。
6. 作者和官方助理可并行接收联系任务、人工发送私信并上传截图。任一方反馈已回复/拒绝联系，取消对该客户的未执行重复任务。
7. 双方首轮任务均验收完成且反馈未回复、跨到中国时区次日且客户允许继续联系时，自动筛选第三组授权客服进行**一次**后续跟进；没有合格客服则不派发。
8. 任务支持超时提醒、退回、转派、审计与客户时间线。所有外部社交媒体操作均由真人通过平台许可的方式完成。

请勿将本系统用于伪造普通消费者体验、冒充患者、发布虚假医疗评价、骚扰用户或未经授权获取评论/私信；内容包实行人工合规审核。**本项目不包括任何抖音未经授权的自动采集/自动私信工具。**

## 工程结构

```text
socialtask-scrm-formal/
├── services/api/               Spring Boot 3 / Java 21 REST API
│   ├── src/main/java/          auth, people, content, task, work, customer, notification, storage, analytics
│   ├── src/main/resources/
│   │   └── db/migration/       Flyway V1/V2/V3 MySQL 8 关系表
│   ├── src/test/java/          领域规则及 MySQL 联合验收测试
│   └── Dockerfile
├── apps/web/                   Next.js 15 / React 19 / TypeScript 管理端 + 移动任务端
├── infra/                      MySQL + API + Web Compose，Nginx HTTPS 示例
├── scripts/                    无依赖领域测试、TS/TSX 语法校验与静态契约检查
├── docs/                       接口、架构、迁移、验收与证据
├── .github/workflows/ci.yml    CI: Java domain / Spring + MySQL / Next build
└── Makefile
```

### 技术栈

- **后端**：Java 21、Spring Boot 3.5.x、Spring Security、Spring JDBC、Flyway、MySQL 8.4。
- **前端**：Next.js 15 App Router、React 19、TypeScript 5、Tailwind CSS、lucide-react；管理端是定制 Admin UI，不是第三方开源后台框架的原样集成。
- **会话安全**：服务端 BCrypt 密码校验；随机 Bearer token 哈希存储于 MySQL；Next.js BFF 把 token 保存在 `HttpOnly / SameSite=Lax` cookie。
- **文件**：本地私有挂载卷；只允许真实 PNG/JPEG、单文件不超过 5MB，截图只有授权管理人员能够下载。
- **消息**：MySQL 通知 Outbox + 企业微信自建应用文本卡片适配器；默认 `WECOM_ENABLED=false`，未配置必须显示 `NOT_CONFIGURED`，不伪装送达。
- **调度**：服务端分钟级催办、最多 N 次、转派保留历史；时区为 Asia/Shanghai（业务规则）/ UTC（持久化）。

## 快速启动（需有网络下载依赖）

要求：Docker Engine + Docker Compose v2；或本机 Java 21/Maven、Node 22/npm、MySQL 8.4。

```bash
# 进入项目根目录
cp .env.example infra/.env
# 编辑 infra/.env，设置三组互不相同的强密码，并保持 WECOM_ENABLED=false

docker compose --env-file infra/.env -f infra/compose.yaml up -d --build
# 等待 MySQL 健康检查和首次 Flyway 迁移

docker compose --env-file infra/.env -f infra/compose.yaml ps
curl -fsS http://127.0.0.1:8080/api/v1/health
```

默认本地入口：

| 页面/接口 | URL |
|---|---|
| 管理工作台 | http://127.0.0.1:3000/admin |
| 登录页 | http://127.0.0.1:3000/login |
| 移动任务端 | http://127.0.0.1:3000/m |
| API 健康探针 | http://127.0.0.1:8080/actuator/health |
| REST API | http://127.0.0.1:8080/api/v1 |

第一次启动时，系统在数据库没有用户且配置了 `BOOTSTRAP_ADMIN_USERNAME` 和 `BOOTSTRAP_ADMIN_PASSWORD` 时才创建管理员。**没有固定默认账号密码**。生产部署须设置 HTTPS、`SESSION_COOKIE_SECURE=true`，并移除引导密码环境变量、限制后台与数据库对外访问。

本地端口绑定在 `127.0.0.1`，不会自动提供外网可访问地址。执行端的企业微信消息内链接需要部署到获准的 HTTPS 域名。

## 本地无 Docker 开发

```bash
# 1. 自建 MySQL 数据库 socialtask 并配置 JDBC_URL / DB_USER / DB_PASSWORD
# 2. 安装 Java 21 和 Maven，使用环境变量设置首个管理员账号、密码
cd services/api
mvn spring-boot:run

# 3. 另开终端：
cd apps/web
npm install
API_INTERNAL_URL=http://127.0.0.1:8080 npm run dev
```

新环境全量验收（必须执行，当前交付环境**未运行**）：

```bash
cd services/api && mvn test
cd ../../apps/web && npm run typecheck && npm run build
# 启动服务后，使用浏览器逐步运行 docs/acceptance.md 所列验收链路
```

无需数据库/联网的快速检查（已在交付环境执行）：

```bash
bash scripts/check-domain.sh
node scripts/check-syntax.cjs
bash scripts/check-features.sh
bash scripts/check-java-syntax.sh
python scripts/check-contract.py
```

## 最小业务演示操作路径

登录管理员 → `人员与账号管理` 创建作者/素人/官方助理/客服 → 为执行人员创建登录凭据并绑定官方企业微信 ID（若适用） → `内容包` 创建并审核 → `发布批次` 选择发布人和截止时间 → 执行人员在 `/m` 人工发布、回传抖音 URL → 管理员在 `任务工单` 核验 → `作品` 录入真实评论、下发官方评论工单并核验 → `客户` 按 UID/主页建立去重档案，确认合规联系依据 → 为作者/助理创建首轮任务 → 执行人通过移动端上传真实截图 → 管理员验收 → 查看是否进入次日回访或停止联系。

> 文档中很多原始示例数据为界面样例，并不是本项目已在真实企业微信、抖音或医疗业务中运行的证据。

## 文档与已知限制

- [API 路由和入参示例](docs/API.md)
- [服务架构和数据约束](docs/architecture.md)
- [验收与上线前检查清单](docs/acceptance.md)
- [旧版 Python MVP 数据迁移说明](docs/migration.md)
- [验证状态（明确已执行与未执行）](docs/verification/STATUS.md)
- [企业微信、SLA 与客户分组真实验收台](docs/verification/WECOM_SLA_STATUS.md)
- [源 SOP 与正式工程任务映射](docs/implementation-baseline.md)

**当前未完成的上线门槛：** npm/Maven 依赖安装、完整 Java/MySQL 集成测试、前端 Next.js 生产构建、浏览器实机验收、企业微信授权与 API 真实送达、配置生产 TLS/备份/监控/文件安全与客户数据保留期限、SOP 内医学美容内容合规复核。抖音平台接口仅有人工替代链路，没有自动化集成。

本工程不是上一版 FastAPI/SQLite 演示程序的原位更新，也不包含历史数据库的自动迁移。见迁移文档。当前未配置任何 Git 远端，不会自动推送仓库。
