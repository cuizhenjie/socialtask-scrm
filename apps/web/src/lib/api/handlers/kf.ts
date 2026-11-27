import { randomUUID } from "node:crypto";
import { ensure, execute, instant, list, one, optional, stamp, str, type Row } from "../db";
import { ApiError } from "../errors";
import { sha256, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";

/**
 * 微信客服（只读第一阶段）：独立客服 Secret 手动分页同步与本地查询。
 * 对应 Spring 的 KfController / KfService / KfSyncClient / KfPage。
 */

const SPRING_TRUE = ["true", "on", "yes", "1"];
const SPRING_FALSE = ["false", "off", "no", "0"];
const KF_ACCOUNT = /^wk[A-Za-z0-9_-]{1,126}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const PEER = /^[a-f0-9]{64}$/;

type KfConfig = {
  enabled: boolean;
  authorized: boolean;
  corpId: string;
  account: string;
  secret: string;
  appSecret: string;
  retentionDays: number;
};

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (SPRING_TRUE.includes(value)) return true;
  if (SPRING_FALSE.includes(value)) return false;
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envText(name: string): string {
  return process.env[name] === undefined ? "" : String(process.env[name]);
}

function config(): KfConfig {
  return {
    enabled: flag("WECOM_KF_ENABLED", false),
    authorized: flag("WECOM_KF_AUTHORIZED", false),
    corpId: envText("WECOM_CORP_ID"),
    account: envText("WECOM_KF_ACCOUNT_ID"),
    secret: envText("WECOM_KF_SECRET"),
    appSecret: envText("WECOM_AGENT_SECRET"),
    retentionDays: envInt("WECOM_KF_RETENTION_DAYS", 30),
  };
}

export function kfConfigured(): boolean {
  const cfg = config();
  return (
    cfg.enabled &&
    cfg.authorized &&
    cfg.corpId.trim() !== "" &&
    KF_ACCOUNT.test(cfg.account) &&
    cfg.secret.trim() !== "" &&
    cfg.secret !== cfg.appSecret &&
    cfg.retentionDays >= 1 &&
    cfg.retentionDays <= 90
  );
}

export function kfAccountKey(): string {
  const cfg = config();
  return sha256(`KF_ACCOUNT:${cfg.corpId}:${cfg.account}`);
}

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function rootAdmin(ctx: Ctx): RequestUser {
  const user = caller(ctx);
  if (user.role !== "admin") throw new ApiError(403, "仅系统管理员可访问微信客服数据");
  return user;
}

function ready(ctx: Ctx): RequestUser {
  const user = rootAdmin(ctx);
  if (!kfConfigured()) throw new ApiError(409, "微信客服未启用或未完成授权配置");
  return user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Java URLEncoder(UTF-8)。 */
function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()~]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

function integer(value: unknown, fallback: number): number {
  return isInt(value) ? value : fallback;
}

async function record(actor: number, entity: string, entityId: number, action: string, after: unknown): Promise<void> {
  await execute(
    "INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,CAST(? AS jsonb))",
    actor,
    entity,
    String(entityId),
    action,
    after === null || after === undefined ? null : JSON.stringify(after),
  );
}

/* ---------------------------------------------------------------- 分页解析 */

type KfMessage = {
  key: string;
  peer: string | null;
  origin: number;
  type: string;
  content: string;
  time: Date;
  recallTarget: string | null;
};

type KfPage = { cursor: string; hasMore: boolean; messages: KfMessage[] };

function field(node: Record<string, unknown>, name: string, max: number, required: boolean): string {
  const value = node[name];
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw new Error("微信客服响应缺少必要字段");
    return "";
  }
  if (typeof value !== "string" || value.length > max || CONTROL.test(value)) {
    throw new Error("微信客服字段格式无效");
  }
  return value;
}

function parsePage(root: Record<string, unknown>, account: string, accountKey: string, previous: string): KfPage {
  if (!isInt(root.errcode) || root.errcode !== 0) throw new Error("微信客服接口拒绝或响应无效");
  if (!isInt(root.has_more) || root.has_more < 0 || root.has_more > 1) throw new Error("微信客服分页标志无效");
  const hasMore = root.has_more === 1;
  let cursor = field(root, "next_cursor", 1024, false);
  const rawList = root.msg_list;
  if (!Array.isArray(rawList) || rawList.length > 100) throw new Error("微信客服消息页无效");
  if (cursor.trim() === "") {
    if (hasMore || rawList.length > 0) throw new Error("微信客服游标无效");
    cursor = previous;
  }
  if (hasMore && cursor === previous) throw new Error("微信客服游标没有前进");

  const messages: KfMessage[] = [];
  for (const raw of rawList) {
    const item: Record<string, unknown> = isRecord(raw) ? raw : {};
    const id = field(item, "msgid", 512, true);
    const type = field(item, "msgtype", 32, true);
    if (!/^[a-z0-9_]+$/.test(type)) throw new Error("微信客服类型无效");
    const event = type === "event";
    const identity: Record<string, unknown> = event && isRecord(item.event) ? item.event : event ? {} : item;
    if (account !== field(identity, "open_kfid", 128, true)) throw new Error("微信客服账号范围不匹配");
    const external = field(identity, "external_userid", 128, !event);
    const peer = external.trim() === "" ? null : sha256(`KF_PEER:${accountKey}:${external}`);
    if (!isInt(item.send_time)) throw new Error("微信客服时间无效");
    const timestamp = item.send_time;
    if (timestamp <= 0 || timestamp > 4102444800) throw new Error("微信客服时间无效");
    const origin = integer(item.origin, -1);
    if (event ? origin !== 4 : !(origin === 3 || origin === 5)) throw new Error("微信客服消息来源无效");

    let content: string;
    let recall: string | null = null;
    if (event) {
      const kind = field(identity, "event_type", 64, true);
      if (!/^[a-z0-9_]+$/.test(kind)) throw new Error("微信客服事件无效");
      content = `[客服事件] ${kind}`;
      if (kind === "user_recall_msg" || kind === "servicer_recall_msg") {
        if (peer === null) throw new Error("撤回事件缺少会话");
        recall = sha256(`KF_MSG:${accountKey}:${field(identity, "recall_msgid", 512, true)}`);
      }
    } else if (type === "text") {
      const textNode = isRecord(item.text) ? item.text.content : undefined;
      if (typeof textNode !== "string") throw new Error("文本内容无效");
      const text = textNode.replace(/\u0000/g, "");
      const points = Array.from(text);
      content = points.length > 4000 ? points.slice(0, 4000).join("") : text;
    } else {
      content = `[客服 ${type} 消息；本阶段仅保留类型元数据]`;
    }
    messages.push({
      key: sha256(`KF_MSG:${accountKey}:${id}`),
      peer,
      origin,
      type,
      content,
      time: new Date(timestamp * 1000),
      recallTarget: recall,
    });
  }
  return { cursor, hasMore, messages };
}

/* ---------------------------------------------------------------- HTTP 客户端 */

let cachedToken: string | null = null;
let tokenExpiry = 0;

function invalidate(used: string): void {
  if (used === cachedToken) {
    cachedToken = null;
    tokenExpiry = 0;
  }
}

async function accessToken(): Promise<string> {
  const cfg = config();
  if (cachedToken !== null && Date.now() < tokenExpiry) return cachedToken;
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encode(cfg.corpId)}&corpsecret=${encode(cfg.secret)}`,
    { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000) },
  );
  if (response.status !== 200) throw new Error("微信客服 HTTP 响应异常");
  const node: unknown = JSON.parse(await response.text());
  if (!isRecord(node) || integer(node.errcode, -1) !== 0) throw new Error("微信客服凭证无效");
  const token = node.access_token;
  if (typeof token !== "string" || token.trim() === "") throw new Error("微信客服凭证无效");
  cachedToken = token;
  tokenExpiry = Date.now() + Math.max(0, integer(node.expires_in, 0) - 180) * 1000;
  return token;
}

async function boundedText(response: Response, max: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) {
      total += next.value.length;
      if (total > max) {
        await reader.cancel();
        throw new Error("微信客服响应过大");
      }
      chunks.push(next.value);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function fetchKfPage(cursor: string): Promise<KfPage> {
  const cfg = config();
  if (!kfConfigured()) throw new ApiError(409, "微信客服未启用或未完成独立授权配置");
  if (cursor.length > 1024 || CONTROL.test(cursor)) throw new ApiError(400, "微信客服游标无效");
  try {
    const token = await accessToken();
    const body: Record<string, unknown> = { open_kfid: cfg.account, limit: 100, voice_format: 0 };
    if (cursor.trim() !== "") body.cursor = cursor;
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${encode(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );
    if (response.status !== 200) throw new Error("微信客服 HTTP 响应异常");
    const parsed: unknown = JSON.parse(await boundedText(response, 2 * 1024 * 1024));
    if (!isRecord(parsed)) throw new Error("微信客服响应无效");
    const code = integer(parsed.errcode, -1);
    if (code === 40014 || code === 42001) invalidate(token);
    return parsePage(parsed, cfg.account, kfAccountKey(), cursor);
  } catch {
    throw new ApiError(502, "微信客服同步失败；游标未推进，请核对许可与接口频率限制");
  }
}

/* ---------------------------------------------------------------- 业务 */

export async function kfState(ctx: Ctx): Promise<Record<string, unknown>> {
  rootAdmin(ctx);
  const cfg = config();
  const result: Record<string, unknown> = {
    enabled: cfg.enabled,
    authorized: cfg.authorized,
    configured: kfConfigured(),
    retention_days: cfg.retentionDays,
    mode: "MANUAL_READ_ONLY",
    has_more: false,
  };
  if (kfConfigured()) {
    const row = await optional(
      "SELECT last_attempt_at,last_sync_at,has_more,last_error FROM kf_sync_state WHERE account_key=?",
      kfAccountKey(),
    );
    if (row !== null) Object.assign(result, row);
  }
  return result;
}

export async function kfSync(ctx: Ctx, confirm: boolean): Promise<Record<string, unknown>> {
  const user = ready(ctx);
  if (!confirm) throw new ApiError(400, "须明确确认本次仅同步授权客服账号的会话数据");
  const cfg = config();
  const account = kfAccountKey();
  const actor = user.id;

  await execute("INSERT INTO kf_sync_state(account_key) VALUES(?) ON CONFLICT (account_key) DO NOTHING", account);
  const row = await one("SELECT * FROM kf_sync_state WHERE account_key=? FOR UPDATE", account);
  const now = new Date();
  const leaseUntil = row.lease_until === null || row.lease_until === undefined ? null : instant(row.lease_until);
  if (leaseUntil !== null && leaseUntil.getTime() > now.getTime()) {
    throw new ApiError(409, "已有同步任务执行中");
  }
  const lastAttempt = row.last_attempt_at === null || row.last_attempt_at === undefined ? null : instant(row.last_attempt_at);
  if (lastAttempt !== null && lastAttempt.getTime() + 60_000 > now.getTime()) {
    throw new ApiError(429, "同步限频：每 60 秒最多一次");
  }
  const lease = randomUUID();
  await execute(
    "UPDATE kf_sync_state SET lease_id=?,lease_until=(now() + INTERVAL '60 seconds'),last_attempt_at=now() WHERE account_key=?",
    lease,
    account,
  );
  const cursor = row.cursor_value === null || row.cursor_value === undefined ? "" : String(row.cursor_value);

  try {
    const page = await fetchKfPage(cursor);
    const current = await one("SELECT lease_id FROM kf_sync_state WHERE account_key=? FOR UPDATE", account);
    ensure(lease === str(current.lease_id), "同步租约已失效，游标未推进");
    let processed = 0;
    for (const message of page.messages) {
      if (message.time.getTime() < Date.now() - cfg.retentionDays * 86_400_000) continue;
      const alreadyRecalled =
        message.peer !== null &&
        (await optional(
          "SELECT id FROM kf_messages WHERE account_key=? AND peer_key=? AND recall_target_key=? LIMIT 1",
          account,
          message.peer,
          message.key,
        )) !== null;
      await execute(
        "INSERT INTO kf_messages(account_key,peer_key,message_key,origin,message_type,content,message_at,recalled,recall_target_key) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        account,
        message.peer,
        message.key,
        message.origin,
        message.type.toUpperCase(),
        alreadyRecalled ? null : message.content,
        stamp(message.time),
        alreadyRecalled,
        message.recallTarget,
      );
      if (message.recallTarget !== null) {
        await execute(
          "UPDATE kf_messages SET content=NULL,recalled=TRUE WHERE account_key=? AND peer_key=? AND message_key=?",
          account,
          message.peer,
          message.recallTarget,
        );
      }
      processed++;
    }
    await execute(
      "UPDATE kf_sync_state SET cursor_value=?,has_more=?,last_sync_at=now(),last_error=NULL,lease_id=NULL,lease_until=NULL WHERE account_key=? AND lease_id=?",
      page.cursor,
      page.hasMore,
      account,
      lease,
    );
    await record(actor, "kf_sync", 0, "SYNC_PAGE", { processed, has_more: page.hasMore });
    return { processed, has_more: page.hasMore, mode: "MANUAL_READ_ONLY" };
  } catch (error) {
    await execute(
      "UPDATE kf_sync_state SET last_error='同步失败，游标未推进',lease_id=NULL,lease_until=NULL WHERE account_key=? AND lease_id=?",
      account,
      lease,
    );
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "微信客服同步失败；游标未推进");
  }
}

export async function kfConversations(ctx: Ctx): Promise<Row[]> {
  ready(ctx);
  return list(
    "SELECT peer_key,MAX(message_at) AS last_message_at,COUNT(*) AS message_count FROM kf_messages WHERE account_key=? AND peer_key IS NOT NULL AND message_at>=(now() - (? * INTERVAL '1 day')) GROUP BY peer_key ORDER BY last_message_at DESC LIMIT 300",
    kfAccountKey(),
    config().retentionDays,
  );
}

export async function kfMessages(ctx: Ctx): Promise<Row[]> {
  ready(ctx);
  const peer = ctx.params.peer;
  if (peer === undefined || !PEER.test(peer)) throw new ApiError(400, "会话标识无效");
  return list(
    "SELECT id,origin,message_type,content,message_at,recalled FROM kf_messages WHERE account_key=? AND peer_key=? AND message_at>=(now() - (? * INTERVAL '1 day')) ORDER BY message_at DESC,id DESC LIMIT 200",
    kfAccountKey(),
    peer,
    config().retentionDays,
  );
}
