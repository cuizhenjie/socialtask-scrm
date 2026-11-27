# 迁移说明：SQLite → PostgreSQL，以及 MySQL → Ark Agent Plan Supabase

## 现状

旧版 `socialtask-scrm` 基于 FastAPI、SQLAlchemy、SQLite 和静态 HTML；正式工程为 Spring Boot / PostgreSQL / Flyway / Next.js，属于**重建的技术栈与业务契约**。两者的表结构、ID 形式、会话、附件路径均不同，没有自动原位更新。

数据库层已统一为 PostgreSQL：

- 本地开发 / 自托管：`infra/compose.yaml` 的 `postgres:16-alpine`。
- 线上：火山方舟 Agent Plan 的 Supabase（PostgreSQL 引擎）。
- V1–V11 全部为 PostgreSQL 语法（`BIGSERIAL`、`TIMESTAMPTZ(3)`、`JSONB`、`ON CONFLICT`），已合并为 `supabase/bootstrap.sql`；应用启动不再执行 Flyway。
- V11 为 Supabase 版启用 RLS 并收紧 `anon` / `authenticated` 权限，隔离 PostgREST 暴露面。

**不要**直接将 SQLite `.db` 文件拷入 PostgreSQL 数据目录，也不要把旧版演示管理员密码写入生产环境。

## 从 SQLite 迁到 PostgreSQL

1. 冻结旧版修改，备份数据库与附件，记录源文件 SHA-256、业务记录数量。
2. 在全新 PostgreSQL/Supabase 库执行 Flyway V1–V11，创建独立管理员，验证 `health` 及所有表的约束。
3. 先迁 `people`、`social_accounts`、分组及身份类型；旧账户密码须重新设置，重新校验企业微信成员映射与授权范围。
4. 再迁获审批的 `content_packages`、`publish_batches`、原始 `tasks`、`works`、`comments`。只迁业务事实和验收证据，不伪造历史的管理员审核记录。
5. 将 `customers`、verified identities 和 `customer_sources` 按核实的 UID/主页建立映射，绝不根据昵称自动去重；冲突形成待人工处理清单。
6. 迁 `contact_rounds`、`contact_attempts`、`task_submissions` 与附件；旧隐私截图必须重新设置最小权限与保留期限。
7. 对账：人员数量、作品 URL hash、唯一客户标识冲突数、任务状态与附件 checksum。无异常才让新应用开始写入。
8. 旧系统只读保留一段合规期限，按备份/恢复/回滚策略处理。避免旧版和新版同时向同一客户下发外联。

## 从 MySQL 迁到 Supabase（本仓库已完成代码侧）

| 项 | 处理方式 |
|---|---|
| 数据库访问 | JDBC + Flyway → Supabase PostgREST；驱动、连接池、Flyway 依赖全部移除 |
| 自增主键 | `AUTO_INCREMENT` → `BIGSERIAL` |
| 时间 | `DATETIME(3)` + `UTC_TIMESTAMP(3)` → `TIMESTAMPTZ(3)` + `now()` |
| JSON 列 | `JSON` / `JSON_EXTRACT` → `JSONB` / `->>`，写入统一 `CAST(? AS jsonb)` |
| UPSERT | `ON DUPLICATE KEY UPDATE` → `ON CONFLICT ... DO NOTHING / DO UPDATE` |
| 聚合 | `GROUP_CONCAT` → `string_agg`；布尔求和改为 `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| 时间加减 | `DATE_ADD / DATE_SUB` → `+ / - INTERVAL` |

迁移前请先把现有 MySQL 数据导出为 CSV/JSON，再按上表逐表导入新库；不要尝试把 MySQL 物理文件直接挂到 PostgreSQL。

### Supabase 接入方式（PostgREST，无 JDBC）

API 进程不再持有数据库连接串，也不引入 JDBC 驱动、连接池或 Flyway，改为通过 HTTPS 调用 Supabase Data API：

- `SUPABASE_URL=https://<project>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service_role key>`，仅存在于服务端环境变量，禁止下发浏览器
- `SUPABASE_RPC_PATH=/rest/v1/rpc`（默认；本地裸 PostgREST 容器改为 `/rpc`）

数据读写只经过两个 `SECURITY DEFINER` 函数：`api_query(sql) -> jsonb` 负责 SELECT 与带 `RETURNING` 的写入，`api_exec(sql) -> int` 执行无返回写入并给出影响行数。两者均 `REVOKE ... FROM PUBLIC/anon/authenticated`，只授予 `service_role`。

1. 在 Supabase Dashboard → SQL Editor（`postgres` 角色）一次性执行 `supabase/bootstrap.sql`，它包含 V1–V11 全部表结构与上述网关函数。
2. V11 为所有表启用 RLS；`service_role` 绕过 RLS，`anon`/`authenticated` 被收回表权限，浏览器无法直接读写业务表。
3. 浏览器端只用 `NEXT_PUBLIC_SUPABASE_URL` 和 anon key，所有业务读写仍经 Spring Boot BFF。

已知边界：PostgREST 每次 HTTP 调用即一个独立事务，跨语句原子性不保证。通知发送队列已改为单条 `UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` 原子认领；后续若出现必须强事务的多步写入，应把该流程下沉为数据库函数并通过 `api_query` 调用。

## 源与目标字段映射

| 业务对象 | 目标表 | 迁移重点 |
|---|---|---|
| 人员与社交账号 | `people`, `social_accounts`, `users` | 微信 ID 验证、账号不覆盖历史、密码轮换 |
| 素材与内容 | `attachments`, `content_packages` | 授权、内容审核结论、附件新路径 |
| 任务与作品 | `publish_batches`, `tasks`, `works` | 原任务编号重映射、状态机、不重复 URL |
| 真实评论 | `comments` | 来源作品/评论原文、人工采集依据 |
| 客户与来源 | `customers`, `customer_identities`, `customer_sources` | 去重证据、一客多来源、数据使用期限 |
| 联系与回访 | `contact_rounds`, `contact_attempts`, `task_submissions` | 双路联系各自独立、次日幂等、截图与任务绑定 |
| 消息与审计 | `notifications`, `audit_logs` | 区分历史来源与新系统实际发生的事件 |

本仓库只交付 schema 和 API，**没有**实现通用 SQLite/MySQL → PostgreSQL 的实际数据迁移脚本，必须在取得真实旧库并完成数据字典核对后单独编写 ETL 并运行 dry-run。
