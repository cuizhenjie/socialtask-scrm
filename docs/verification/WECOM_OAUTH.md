# 企业微信自建应用 OAuth 登录 — 实施与验收

> 历史验收记录。下面的旧架构、命令或成绩不代表当前主干；当前以独立 Next.js 部署和 `scripts/test-next-runtime.mjs` 为准。

原始补丁基线：`8a746843f44c30869d088524bf1150e8624a338e`（2026-11-25 main）；提交前合入 `aab43ffef56aafe3a8a8d0ac80b8a8a24dc01916`（DSH Desktop 交付）。用户已批准提交及推送，未批准部署或调用真实企业微信。所有测试数据均为合成数据。基线版本号保持不变，待完整工程验收后再发布。

## 1. 登录链路

1. 企业微信文本卡片继续链接 `APP_PUBLIC_URL/m/tasks/{id}`；不改变卡片发送逻辑。已有有效 `socialtask_session` 时直接访问任务。
2. 无会话时，既有 AuthGate/API 401 逻辑跳转 `/login?next=/m/tasks/{id}`；企微 `wxwork` UA 自动进入 `/api/auth/wecom/start`。普通浏览器继续密码登录；企微内非任务登录页提供显式免密码入口，退出后不会自动登录。
3. Next.js BFF 生成 256-bit 浏览器随机数，通过内部 `POST /api/v1/auth/wecom/start` 申请 state。后端持久化 state 与浏览器随机数的 SHA-256、回跳路径、5 分钟有效期。BFF 设置 `__Host-socialtask_wecom_attempt`（Secure/HttpOnly/SameSite=Lax/Path=/，300 秒），303 跳转企微网页授权。
4. 授权地址：`https://open.weixin.qq.com/connect/oauth2/authorize?appid=CORPID&redirect_uri=ENCODED_CALLBACK&response_type=code&scope=snsapi_base&agentid=AGENTID&state=RANDOM_HEX#wechat_redirect`。
5. 回调 `/api/auth/wecom/callback?code=...&state=...`；BFF 拒绝缺失、重复、非法参数与缺失浏览器 Cookie。内部 `POST /api/v1/auth/wecom/exchange` 必须同时校验 state、浏览器随机数及期限；原子 DELETE 只有一个请求成功。即使供应商失败也不允许重放，重新发起授权即可。
6. Java 后端使用自建应用 Secret 获取应用级 token：`GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=...&corpsecret=...`；缓存提前 180 秒过期。再使用 `GET https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=...&code=...` 获取小写 `userid`。不读取手机号等敏感字段；无内部成员身份即拒绝，不用 OpenID/ExternalUserID 替代。旧版 `user/getuserinfo` 不是本次目标，不自动回退或重试一次性 code。
7. `AuthService.loginWecom` 通过 `people.wecom_userid → users.person_id` 锁定并校验唯一映射（含非活跃/未配置记录，歧义拒绝）；人员 ACTIVE、账号 active、已有本地合法角色，才可签发会话。不自动注册、绑定或提升权限。返回的角色来自本地账号，不信任浏览器角色或 userid。
8. 共用 `issueSession`：随机 32 bytes token、数据库仅 SHA-256、12 小时；仅 BFF 得到 token，浏览器只接收原有 `socialtask_session` 的 Secure/HttpOnly/SameSite=Lax Cookie。303 回到数据库 state 中的任务路径，复用 `cardReturnPath` 与 `afterLoginPath`；无有效任务路径按角色回到 `/admin` 或 `/m`。原任务 API 的 `Access.ownsTask` 仍然判断归属；回跳不会授予任务权限。
9. OAuth 失败仅以固定错误标记返回登录页，不自动重复授权、不在 URL 放 token、不输出 provider 原始错误；保留合法原任务回跳供密码登录或手动重试。回调清理临时 Cookie。通用 BFF `/api/proxy/auth/...` 一律拒绝，避免将 bearer 响应转给前端 JS。

### 接口约束

| API | 入参 | 成功结果 | 失败 |
| --- | --- | --- | --- |
| `POST /api/v1/auth/wecom/start`（内部） | `browserNonce` 64 小写十六进制，`next` 可选 | `authorization_url` | 400 无效，404 禁用，503 配置不全 |
| `POST /api/v1/auth/wecom/exchange`（内部） | `state`、`browserNonce`、`code`（最多 512 UTF-8 字节） | 原有 `access_token`、`token_type`、`expires_in`、`user`，及可信 `next` | 400 无效或重放，401 供应商授权失败，403 未绑定或歧义，404 禁用，502 上游不可用，503 配置错误 |
| `GET /api/auth/wecom/start`（浏览器） | `next` 可选 | 303 企微授权，设置临时 Cookie | 303 登录页 |
| `GET /api/auth/wecom/callback`（浏览器） | `code`、`state`，临时 Cookie | 303 本站路径，设置系统会话 Cookie | 303 登录页，不签发会话 |

后端只有上面两个 POST 开放未登录访问；其授权入口不是普通业务接口。生产反向代理不要公开内部 API 或将该接口转发给公网。公网只需要前端 OAuth 路由和原来独立的企微消息回调（若启用）。BFF 与 API 之间必须是受信网络；跨主机使用 TLS/私有网络。

## 2. Flyway 与撤销

新增 `V5__wecom_oauth_state.sql`，不修改 V1/V2/V3/V4（工单模板）：
- `wecom_oauth_states`：state_hash、browser_hash、return_path、expires_at 及到期索引。每次启动授权清理过期记录；多实例共享 MySQL。单浏览器同一时刻保留最后一次授权 Cookie，多个并行标签页可能需要重试。
- `sessions.auth_method`：默认 `PASSWORD`，新 OAuth 会话为 `WECOM`；旧会话保持原逻辑。通过人员管理 API 解绑/修改 UserID 时只撤销该人员的 WECOM 会话；停用人员仍撤销全部会话。不要直接改数据库跳过业务层；若直接运维修复绑定，须同步撤销对应 OAuth 会话。
- 保持现有多账号/人员模型，不新增历史数据可能不满足的全局唯一约束；授权时严格要求只有一条绑定和一条用户记录。上线前清理歧义，避免授权失败。

MySQL 8.4 执行 DDL 前备份，验证 Flyway V5 实际应用成功。关闭 `WECOM_OAUTH_ENABLED` 只禁止新 OAuth 授权，不自动撤销已签发会话；紧急停用需由有权限的运维按变更流程执行 `UPDATE sessions SET revoked=TRUE WHERE auth_method='WECOM';`。不要删除 V5 migration，不要手工篡改 Flyway 历史。更换 CorpID/应用 Secret 前先关 OAuth、清空旧 state 并撤销旧 OAuth 会话，重新核验全部绑定。

## 3. 配置（真实联调前，不启用）

默认 `.env.example` 中 `WECOM_OAUTH_ENABLED=false`，`WECOM_ENABLED`（消息发送）与 `WECOM_CALLBACK_ENABLED`（消息回调）完全独立。只有经企业管理员授权后才设置：

```dotenv
APP_PUBLIC_URL=https://scrm.example.com
SESSION_COOKIE_SECURE=true
WECOM_OAUTH_ENABLED=true
WECOM_ENABLED=false
WECOM_CALLBACK_ENABLED=false
WECOM_CORP_ID=ww_REPLACE_ME
WECOM_AGENT_ID=1000001
WECOM_AGENT_SECRET=REPLACE_IN_SECRET_STORE
```

- `APP_PUBLIC_URL` 必须为实际的 HTTPS 根 origin，不允许路径、query、fragment 或 userinfo；域名必须与企微后台应用「网页授权及 JS-SDK」可信域名一致，域名验证文件/备案要求以后台提示为准。
- 授权回调为 `https://实际域名/api/auth/wecom/callback`，**不是**消息加密回调 `/api/v1/wecom/callback`，不使用消息 callback token/AES key。
- 设置自建应用 CorpID/AgentID/Secret 及可信出口 IP；确认测试成员属于该企业，完成可见范围与本地 UserID、唯一可用账号绑定。身份接口可能返回可见范围之外的内部成员；本次实际访问授权由本地绑定和角色决定，不将应用可见范围当作授权判断，也不额外调用通讯录接口。若业务要求强制可见范围，需另行授权并设计成员范围校验。
- OAuth Cookie 始终 Secure，需 HTTPS；`SESSION_COOKIE_SECURE=true` 同时保护原密码登录。保持 Web 与回调同一域，不跨域转移 Cookie。
- Secret、应用 token、code、state、浏览器随机数和系统 token 不写日志/URL 分析工具。生产网关应对回调 query、内部认证请求 body、上游 GET query 作脱敏；为认证入口配置请求大小限制及合理限流。凭据只在 Secret Store/服务器环境，不能放 `NEXT_PUBLIC_*` 或 Git。HTTPS 代理禁止缓存认证响应，保持 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`。
- 不支持企业微信桌面浏览器扫码登录、第三方服务商、普通微信客户、外部联系人登录或多企业租户。同一个实例只信任一套 CorpID/AgentID；原 `people.wecom_userid` 没有租户字段。
- 本次 `auth/getuserinfo` 与 `snsapi_base` 参考腾讯云 CloudBase 技术说明（https://docs.cloudbase.net/authentication-v2/method/wecom-login）及接口文档镜像（https://github.com/wxkingstar/doc-hub-mcp）；旧版官方网页授权入口 https://developer.work.weixin.qq.com/document/path/91022 和身份入口 https://developer.work.weixin.qq.com/document/path/91023 本次无法直接打开。真实成员授权结果需按企业后台当前规范复核。

## 4. 测试步骤（不使用真实企微）

依赖：JDK 21、Node 22、Maven、MySQL 8.4（隔离数据库），前端 npm 依赖。离线断言无需安装项目依赖：

```bash
bash scripts/check-wecom-oauth-policy.sh
node --experimental-strip-types scripts/check-login-return.mjs
node --experimental-strip-types scripts/check-wecom-oauth.mjs
bash scripts/check-java-syntax.sh
node scripts/check-syntax.cjs
```

- `WecomOAuthPolicyOfflineTest.java`：生产策略的真实 Java 编译运行，包含 nonce、code UTF-8 长度、回跳白名单、HTTPS callback 与授权链接参数。
- `check-wecom-oauth.mjs`：生产 BFF helper + mock fetch，包含成功、Cookie、回跳、provider URL 白名单、错误分流、外部 URL 注入、缺失/重复参数、不可达后端等。不是浏览器 E2E。
- `WecomOAuthClientTest`：真实 Java adapter + mock transport，验证供应商端点、URL 编码、token 缓存、无效 code/外部身份、禁用、token 失效，不联网。
- `WecomOAuthIntegrationTest`：Spring MockMvc、实际 MySQL/Flyway/session/权限，mock provider；验证任务归属、重放/并发、state 过期、账号歧义、失败、解绑只撤销 OAuth 会话。

以现有 CI 的测试数据库配置执行。若本机启动 Compose mysql，使用新项目名及独立数据卷，并确保 3307 端口未被占用；准备独立 `infra/.env.oauth-qa`（从 `.env.example` 复制并填写隔离测试 DB 密码，禁止提交），仅启动 mysql：

```bash
docker compose -p socialtask-oauth-qa --env-file infra/.env.oauth-qa -f infra/compose.yaml up -d mysql
export JDBC_URL='jdbc:mysql://127.0.0.1:3307/socialtask?connectionTimeZone=UTC'
export DB_USER=socialtask
# DB_PASSWORD 设置为隔离 mysql 的密码（不要输出到日志）
export BOOTSTRAP_ADMIN_USERNAME=ci-admin
export BOOTSTRAP_ADMIN_PASSWORD='This-Is-A-Test-Only-Password-123'
export WECOM_ENABLED=false WECOM_CALLBACK_ENABLED=false WECOM_OAUTH_ENABLED=false SCHEDULER_ENABLED=false
(cd services/api && mvn -B -ntp -Dtest=WecomOAuthClientTest,WecomOAuthIntegrationTest test)
(cd services/api && mvn -B -ntp test)
(cd apps/web && npm install --no-audit --no-fund && npm run typecheck && npm run build)
```

集成测试会创建合成记录；绝不能指向生产数据库。`@MockitoBean` 替换 OAuth provider，不调用企微；独立 adapter 测试的传输也全部 mock。测试后经确认清理该隔离项目数据卷。

本补丁将离线断言加入现有 CI 定义，推送 main 将触发远端 CI；实际结果以 GitHub Actions 为准。当前工作容器没有 Maven、完整仓库及依赖，MySQL/Flyway、Spring MockMvc、完整 TS typecheck/Next build 与浏览器未运行。需要在具备完整仓库的本地/授权 CI 通过后才可进入真实联调。

## 5. 真实联调（需要用户/企业授权，当前未执行）

验收清单：

- 测试成员 A 有唯一绑定与有效任务，首次从企微卡片点击，无密码直接到原 `/m/tasks/{id}`；任务详情 200，重复打开已有会话无需授权。
- A 访问成员 B 任务被后端拒绝（403）；未绑定、停用、重复绑定人员不得登录；外部客户只得到错误提示。
- 缺失/错误/过期 state、复制回调到另一浏览器、并发回调、重复 code、篡改 next 均不得签发新会话，合法回跳不得去外域。
- 回调失败可以密码登录恢复原任务；退出后失效；解绑使 OAuth 会话失效且保留密码会话。
- 浏览器 devtools 记录 cookie attributes、303 链路、任务状态；后端记录脱敏状态码，检查 `sessions.auth_method` 及哈希，不保存 code/token/Secret 或真实用户身份。
- 验证 iOS/Android 企微内置浏览器、可信域名与 IP、应用许可和真实 code 换取 userid；不使用真实客户数据，不自动发送任何卡片或部署。

发布门槛：全部离线测试 + MySQL/Flyway + Spring/Next 构建 + 真实授权测试均通过，并取得明确发布批准。不要把模拟成功当作真实企微成功。
