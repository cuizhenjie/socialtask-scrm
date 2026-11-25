# 2026-11-24 · 源码验证状态（严格区分实际运行）

| 检查 | 状态 | 证据 |
|---|---|---|
| Java 21 纯业务规则 | **已执行** | `bash scripts/check-domain.sh`，16 项断言通过 |
| TypeScript/TSX 语法 | **已执行**，只是语法解析 | `node scripts/check-syntax.cjs`，26 个 TS/TSX 模块、0 语法错误 |
| 静态工程契约、配置与 SQL 表定义 | **已执行** | `python scripts/check-contract.py`（SQL 静态核对，不等于 Flyway 迁移） |
| MySQL 8.4 + Flyway V1 迁移 | **未运行** | 需 Docker/MySQL 和 Maven |
| Spring Boot Maven 依赖解析、编译和应用启动 | **未运行** | 当前容器无 Maven 和可用网络 |
| Spring Boot `WorkflowIntegrationTest` | **未运行** | CI 中提供了 MySQL service 与 MockMvc 用例 |
| Next `npm install`、`tsc --noEmit`、`next build` | **未运行** | 当前容器无法安装 npm 依赖 |
| 浏览器及移动端真实点击回归 | **未运行** | 需成功安装依赖、构建、启动服务 |
| 企业微信真实发送及跳转回调 | **未运行**，默认关闭 | 需企业授权、自建应用凭据和真实成员 userId |
| 抖音 API 集成 | **未实现** | 只支持人工操作和结果回传，不做未授权自动化 |
| 公网部署、TLS、安全审查、备份恢复 | **未运行** | 需要部署环境和安全验收 |

**发布门槛**：先完成可复现的 Maven/MySQL 和 Next.js 构建，再运行 docs/acceptance.md 场景，随后持授权执行企业微信端到端调试。当前产物定位为**正式工程源码候选版本**，不是已上线成品。用户未授权 GitHub 仓库推送，未执行任何远端改动。

## v1.1 追加验证状态（2026-11-24）

- **已执行**：`scripts/check-domain.sh`（16 项纯 Java 领域断言）；`scripts/check-features.sh`（11 项纯 JDK SLA 日历与企业微信加密回调断言）；`bash scripts/check-java-syntax.sh`（41 个 Java 文件纯语法解析）；`node scripts/check-syntax.cjs`（28 个 TS/TSX 文件语法解析）；`python scripts/check-contract.py`（56 项静态迁移/配置/路由契约检查）。这些不是运行时集成测试。
- **已编写未执行**：`EnhancementsIntegrationTest.java`（MySQL 分组/标签/新工单/SLA/报表/权限）；`WecomCallbackIntegrationTest.java`（加密回调验签、重复入库、收件箱）；原有 `WorkflowIntegrationTest.java` 需以 V2 再次回归。
- **未验证**：实际 MySQL Flyway V2 迁移、Maven 全构建、Next.js 生产构建、浏览器表单交互、企业微信 CorpID/Agent 发送权限、消息回调真实验签、生产 HTTPS、公有云限流与监控。
- **不在范围**：普通企业微信客户聊天、群聊、微信客服历史记录、会话存档、抖音自动化采集。未配置这些能力，不可标注为“完整企微聚合”。

### v1.1 客户分组/标签扩展说明

- 已编写：Flyway V3（3 张客户分类表及分组外键），客户分类字典、保存、过滤 API，客户列表/档案 UI，管理员 RBAC 与操作审计。
- 已添加但**未运行**：`EnhancementsIntegrationTest` 中的客户创建、分组/标签绑定及组合筛选 MySQL 集成断言。
- 已执行：纯源码级和离线契约检查。**尚未实际在 MySQL 执行 V3，也没有浏览器验证新增表单。**
