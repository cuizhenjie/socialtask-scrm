# 迁移到独立 Next.js + 方舟 Supabase

当前业务接口由 `apps/web` 提供，应用不使用数据库连接串。底层仍是 Supabase 托管的 PostgreSQL。

## 1. 数据库与 Storage

- **空工作区**：在同一个方舟 Supabase 工作区的 SQL Editor 依次运行 `supabase/bootstrap.sql`、`supabase/migrations/20261127_next_runtime.sql`、`supabase/storage.sql`。
- **已有 SocialTask 数据**：先备份并在隔离副本演练；不要重跑 `bootstrap.sql`。已有完整 V1–V11 托管库只加新迁移和 Storage 脚本。如果还在旧本地实例，先用受支持的托管库导入/恢复流程迁移业务 schema、表数据和序列，验证记录数与最新 ID，再执行增量；不将数据库密码或连接串交给应用。
- 新增私有桶 `socialtask-attachments`，不要给 `anon` / `authenticated` 加读写策略。浏览器通过经过鉴权的 Next.js 接口获取素材。

## 2. 旧附件（如有）

切换前暂停旧系统写入和定时清理，独立备份数据库与旧附件原文件；仅备份元数据不能恢复图片。**不要先删旧上传卷。** 从旧库导出下列查询结果为 JSON 数组；旧文件按 `storage_key` 位于挂载卷的上传目录（或由旧 Next.js 宿主导出其临时目录，若仍可取）。迁移保留原 ID、存储键、任务关联与权限：

```sql
SELECT storage_key,mime,file_size FROM public.attachments WHERE purged_at IS NULL ORDER BY id;
```

```bash
node scripts/migrate-attachments.mjs manifest.json /path/to/read-only-uploads
# 确认目标工作区后再执行；SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 从秘密管理器注入
node scripts/migrate-attachments.mjs manifest.json /path/to/read-only-uploads --apply
```

默认命令不访问网络。实际迁移不覆盖不同文件，以 SHA-256 回读验证。任何缺件先处理，不把历史文件丢失伪装成迁移成功。备份文件、清单和回读证据仅限授权维护者访问。

## 3. 切换

把 Web 和调度配置一次性指向 Next.js，企微回调 URL 路径不变。旧 Compose 容器不会随新配置自动消失，先按原版本停止旧服务及调度器，再启动新服务；保留旧容器数据卷和升级前备份，不运行 `down -v`。检查 `GET /api/v1/ready`，验证账号密码登录、已有素材下载（核对 SHA-256）、新建工单和回传审核；确认调度器运行后再开真实企微。回退使用已验证的备份、旧附件和切换前版本，先确定切换后新增写入的处理方式。
