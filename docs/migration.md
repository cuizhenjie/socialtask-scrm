# 从 v0.1 Python/SQLite 演示版迁移到 Java/Next 正式工程

## 现状

旧版 `socialtask-scrm` 基于 FastAPI、SQLAlchemy、SQLite 和静态 HTML，拥有 14 项已运行的示例测试；正式工程为 Spring Boot / MySQL / Flyway / Next.js，属于**重建的技术栈与业务契约**。两者的表结构、ID 形式、会话、附件路径均不同，没有自动原位更新。

**不要**直接将 SQLite `.db` 文件拷入 MySQL 数据目录，也不要把旧版演示管理员密码写入生产环境。

## 迁移顺序

1. 冻结旧版修改，备份数据库与附件，记录源文件 SHA-256、业务记录数量。
2. 在全新 MySQL 库执行 Flyway V1，创建独立管理员，验证 `health` 及所有表的约束。
3. 先迁 `people`、`social_accounts`、分组及身份类型；旧账户密码须重新设置，重新校验企业微信成员映射与授权范围。
4. 再迁获审批的 `content_packages`、`publish_batches`、原始 `tasks`、`works`、`comments`。只迁业务事实和验收证据，不伪造历史的管理员审核记录。
5. 将 `customers`、verified identities 和 `customer_sources` 按核实的 UID/主页建立映射，绝不根据昵称自动去重；冲突形成待人工处理清单。
6. 迁 `contact_rounds`、`contact_attempts`、`task_submissions` 与附件；旧隐私截图必须重新设置最小权限与保留期限。
7. 对账：人员数量、作品 URL hash、唯一客户标识冲突数、任务状态与附件 checksum。无异常才让新应用开始写入。
8. 旧系统只读保留一段合规期限，按备份/恢复/回滚策略处理。避免旧版和新版同时向同一客户下发外联。

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

本版本只交付了 schema 和 API，**没有**实现通用 SQLite→MySQL 的实际数据迁移脚本，必须在取得真实旧库并完成数据字典核对后单独编写 ETL 和运行 dry-run。
