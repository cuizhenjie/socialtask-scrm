# SocialTask SCRM 生产发版与配置手册

> 适用版本：当前主干（Flyway V1–V10，Spring Boot 3 / Java 21 + Next.js 15 + MySQL 8.4）。
> 原则：**默认先以密码登录模式安全上线，再按企业授权进度灰度开启企业微信各项能力**；禁止把真实密钥、`.env` 提交到 Git。

---

## 1. 环境与前置条件

| 组件 | 要求 |
|---|---|
| 主机资源 | Linux（推荐 Ubuntu 22.04/24.04），最低 4 vCPU / 8 GB RAM / 100 GB SSD |
| 运行时 | Docker Engine 24+ 与 Docker Compose v2 |
| 网络与证书 | 已备案域名 + 有效 HTTPS TLS 证书（Nginx 终止 TLS）；对外仅开放 `80`/`443`，**严禁暴露 `3000`、`8080`、`3307`** |
| 备份空间 | 独立磁盘或对象存储挂载点，用于存放每日 MySQL + 私有附件卷备份 |

---

## 2. 生产配置清单（`infra/.env`）

在服务器项目根目录执行 `cp .env.example infra/.env && chmod 600 infra/.env`，生成随机强密钥：

```bash
# 生成 32 字节 Base64 密钥（用于 SOCIALTASK_CONFIG_KEY）
openssl rand -base64 32
# 生成高强度数据库与管理员密码（各不相同）
openssl rand -base64 24
```

### 2.1 必填基础配置（首轮发版即可启动）

```dotenv
# === 数据库（三组密码必须互不相同，切勿泄露）===
MYSQL_ROOT_PASSWORD=<随机24位以上强密码A>
DB_PASSWORD=<随机24位以上强密码B>

# === 首次初始化管理员（仅数据库无用户时生效；首登成功后务必清空并重启 api）===
BOOTSTRAP_ADMIN_USERNAME=sysadmin
BOOTSTRAP_ADMIN_PASSWORD=<随机20位以上强口令C>

# === 公网访问与会话安全 ===
# 必须为真实 HTTPS 根 origin，禁止带尾斜杠、路径、query 或 userinfo
APP_PUBLIC_URL=https://scrm.your-domain.com
# 生产 HTTPS 必须设为 true
SESSION_COOKIE_SECURE=true

# === 后台调度与业务参数 ===
SCHEDULER_ENABLED=true
FOLLOWUP_MAX_ACTIVE_TASKS=10

# === 隐私附件保留策略（V10）===
# 私信截图到期后自动物理删除文件、保留审计记录（1-3650天，默认90天）
ATTACHMENT_PM_RETENTION_DAYS=90
# 内容素材包图片保留期（0=长期保留；1-3650=到期自动清理）
ATTACHMENT_CONTENT_RETENTION_DAYS=0
```

### 2.2 企业微信自建应用配置（未完成企微联调前全部保持 `false`）

```dotenv
# 出站应用消息/文本卡片开关
WECOM_ENABLED=false
# 自建应用媒体上传/下载开关（出站发送媒体还要求 WECOM_ENABLED=true）
WECOM_MEDIA_ENABLED=false
# 企微内免登 OAuth 开关（要求 APP_PUBLIC_URL 为 HTTPS 且已配可信域名）
WECOM_OAUTH_ENABLED=false

WECOM_CORP_ID=
WECOM_AGENT_ID=0
WECOM_AGENT_SECRET=

# 自建应用加密消息回调开关（独立于出站发送；Nginx 需将 /api/v1/wecom/callback 直反代至 8080）
WECOM_CALLBACK_ENABLED=false
WECOM_CALLBACK_TOKEN=
WECOM_ENCODING_AES_KEY=
# 企微消息正文保留期（1-3650天，默认90天；关联工单的消息脱敏留ID，未关联消息删除）
WECOM_RETENTION_DAYS=90
```

### 2.3 微信客服独立只读渠道配置（V7，需独立客服授权，默认关闭）

```dotenv
WECOM_KF_ENABLED=false
WECOM_KF_AUTHORIZED=false
WECOM_KF_ACCOUNT_ID=
# 必须为微信客服独立 Secret，禁止复用自建应用 WECOM_AGENT_SECRET
WECOM_KF_SECRET=
# 微信客服消息保留期（1-90天，默认30天）
WECOM_KF_RETENTION_DAYS=30
```

### 2.4 服务端加密 LLM 模型配置（V9，可选）

```dotenv
# 32字节随机 Base64 主密钥，妥善异地备份；严禁复用 WECOM_ENCODING_AES_KEY
SOCIALTASK_CONFIG_KEY=
# 允许访问的精确 HTTPS Origin 逗号列表（无路径/query/凭据），如 https://api.openai.com,https://llm.internal.example.com
SOCIALTASK_LLM_ALLOWED_ORIGINS=
```

---

## 3. Nginx HTTPS 反向代理配置

参考仓库中的 [infra/nginx.example.conf](../infra/nginx.example.conf)，将 `socialtask.example.com` 与证书路径替换为实际值，核心安全路由约束如下：

1. `80` 端口强制 `301` 跳转 `https://`。
2. 仅允许 `location = /api/v1/wecom/callback` 直接代理到 `http://127.0.0.1:8080`；其余 `location ^~ /api/v1/` 一律返回 `404`（防止暴露内部 OAuth 接口 `/api/v1/auth/wecom/*`）。
3. `location ^~ /api/auth/` 代理到 `http://127.0.0.1:3000` 并强制附加 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`。
4. `client_max_body_size 10m;` 满足 5MB PNG/JPEG 图片上传。

校验并重载 Nginx：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. 首次发版步骤

```bash
# 1. 拉取目标发布提交并确认工作区干净
git fetch origin
git checkout main
git pull --ff-only origin main

# 2. 准备生产配置（确认权限 600，不包含占位符）
cp .env.example infra/.env
chmod 600 infra/.env
# 编辑 infra/.env 填入第 2 节真实配置

# 3. 构建并启动 MySQL + API + Web（首次启动自动执行 Flyway V1–V10）
make up

# 4. 观察 Flyway 迁移与启动日志（确认 "Successfully applied 10 migrations ... now at version v10"）
docker compose --env-file infra/.env -f infra/compose.yaml logs -f api

# 5. 本机健康探针核验
make health
curl -fsS -I https://scrm.your-domain.com/login
```

### 首登加固（必须执行）

1. 使用浏览器打开 `https://scrm.your-domain.com/login`，用引导管理员登录并进入 `/admin/settings` 核对配置状态。
2. 编辑 `infra/.env`，**清空** `BOOTSTRAP_ADMIN_USERNAME=` 与 `BOOTSTRAP_ADMIN_PASSWORD=`，然后重启 API 容器：
   ```bash
   docker compose --env-file infra/.env -f infra/compose.yaml up -d api
   ```
3. 配置定时备份（建议每日 02:30 执行）：
   ```cron
   30 2 * * * cd /opt/socialtask-scrm && bash scripts/backup-db.sh >> /var/log/socialtask-backup.log 2>&1
   ```

---

## 5. 日常升级发版步骤

1. **升级前全量备份（强制）**：
   ```bash
   make backup
   ```
2. **拉取代码并先在测试环境演练迁移**（如有新增 `V*.sql`）：
   ```bash
   git pull --ff-only origin main
   ```
3. **重建并滚动重启应用容器**（不动 `mysql` 数据卷）：
   ```bash
   docker compose --env-file infra/.env -f infra/compose.yaml up -d --build api web
   ```
4. **验证升级结果**：
   * 检查 `docker compose --env-file infra/.env -f infra/compose.yaml logs --tail=100 api`，确认 Flyway 迁移成功且无报错。
   * 运行 `make health`，访问 `/admin/settings` 点击“重新检查”。

---

## 6. 企业微信能力灰度开启顺序（取得企业授权后）

切勿一次性全部开启，按以下顺序逐项放量：

1. **前置**：在企微后台配置自建应用可信域名（与 `APP_PUBLIC_URL` 严格一致）、企业可信出口 IP、应用可见范围；在 `/admin/people` 为测试成员绑定 `wecom_userid` 并确认唯一账号。
2. **步骤 A（OAuth 免登）**：设置 `WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_AGENT_SECRET`、`WECOM_OAUTH_ENABLED=true`，重启 `api`，在企微客户端打开 `/m/tasks/{id}` 验证免登与越权拒绝。
3. **步骤 B（应用卡片通知）**：开启 `WECOM_ENABLED=true`，下发测试工单确认 `textcard` 送达且通知状态从 `NOT_CONFIGURED` 变为 `SENT`。
4. **步骤 C（加密回调收件箱）**：在企微后台填入回调 URL `https://scrm.your-domain.com/api/v1/wecom/callback` 与 Token/EncodingAESKey，配置 `WECOM_CALLBACK_ENABLED=true` 及密钥后重启 `api`，验证成员入站消息与工作台回复。
5. **步骤 D（按需开启）**：临时媒体（`WECOM_MEDIA_ENABLED=true`）、微信客服只读同步（`WECOM_KF_ENABLED=true` + `WECOM_KF_AUTHORIZED=true` + 独立 Secret）。

---

## 7. 应急处置与回滚

* **仅关闭外部通知或自动调度**：在 `infra/.env` 中将 `WECOM_ENABLED=false`、`WECOM_CALLBACK_ENABLED=false`、`WECOM_OAUTH_ENABLED=false` 或 `SCHEDULER_ENABLED=false`，执行 `docker compose --env-file infra/.env -f infra/compose.yaml up -d api`。
* **紧急撤销全部企微 OAuth 会话**（不影响密码会话）：
  ```bash
  docker compose --env-file infra/.env -f infra/compose.yaml exec mysql \
    mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" socialtask \
    -e "UPDATE sessions SET revoked=TRUE WHERE auth_method='WECOM';"
  ```
* **全量数据与代码回滚**：
  ```bash
  git checkout <上一稳定Tag或Commit>
  CONFIRM_RESTORE=YES bash scripts/restore-db.sh ./backups/<发版前时间戳>
  docker compose --env-file infra/.env -f infra/compose.yaml up -d --build api web
  ```
