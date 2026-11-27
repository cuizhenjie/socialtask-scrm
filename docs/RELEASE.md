# Next.js 独立部署与运维

## 环境变量

从 [方舟 Agent Plan 对应 Supabase 工作区](https://docs.volcengine.com/docs/ark/agent-plan-personal-supabase?lang=zh) 获取三项参数：

| 工作区值 | 应用变量 | 用途 |
|---|---|---|
| Supabase Base URL | `SUPABASE_URL` | PostgREST 与 Storage 的 HTTPS 根地址，不能填 PG 连接串 |
| Service role key | `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端数据与附件访问；禁止加 `NEXT_PUBLIC_` |
| Anon key | `SUPABASE_ANON_KEY` | 可留空；SocialTask 登录不走 Supabase Auth，业务也不用它 |

按 [升级与数据迁移](migration.md) 准备工作区。复制 `.env.example` 为 `infra/.env` 并修改：生产开启 `SESSION_COOKIE_SECURE=true`，设置 `APP_PUBLIC_URL`；空库第一次登录需设置 `BOOTSTRAP_ADMIN_USERNAME` 和 16 字符以上、最多 72 字节的随机 `BOOTSTRAP_ADMIN_PASSWORD`。首次按该账号登录会在空库创建管理员，已有账户不会改密；创建后删除这两个环境变量并重启。没有固定默认密码。启用定时任务时用独立 `CRON_SECRET`（如 `openssl rand -hex 32`）；企微与模型配置独立，不复用该密钥。

## 自托管

```bash
make up
make health
docker compose --env-file infra/.env -f infra/compose.yaml logs --tail=100 web scheduler
```

`web` 与 `scheduler` 共用同一 Node 镜像。本地端口 3000 保持回环地址绑定，用 [示例 Nginx](../infra/nginx.example.conf) 终止 TLS。公开路由 `/api/v1/wecom/callback` 到 Next.js；示例默认屏蔽其它 `/api/v1` 及调度入口。如需要开放机器接口，按调用者和路径单独配置。

托管 Next.js 时以 `apps/web` 为应用根，使用服务器运行时，不支持静态导出。使用能够发送 POST 的外部调度器，每分钟 POST `/api/internal/scheduler`，带独立 `Authorization: Bearer <CRON_SECRET>`。手动的 `POST /api/v1/ops/tick` 仍走工作台会话权限。不要同时让旧服务运行定时任务。调度失败返回 502 和任务名，重叠触发跳过；调度密钥不得用于浏览器。

## 监控和恢复

`/api/v1/health` 仅表明进程运行；`/api/v1/ready` 检查业务 schema、RPC 和私有桶。就绪不代表企业微信、LLM 或端到端链路已验证。业务表数据与私有桶里实际图片分别做受控备份，恢复演练时从备份恢复独立工作区，核对图片哈希、登录、工单和历史记录；不要把库备份当作对象文件的备份。正式开通企微前按 [验收指南](acceptance.md) 核验并仅使用已授权测试应用。

附件新传、重试与回收见 [API](API.md#附件上传与重试)。Storage 使用 [火山引擎 Supabase 私有桶](https://docs.volcengine.com/docs/aidap/Creating_a_file_bucket?lang=zh)，服务端凭据不会发送到浏览器。
