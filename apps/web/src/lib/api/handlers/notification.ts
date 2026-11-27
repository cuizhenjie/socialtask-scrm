import { execute, list, num, one, optional, str, type Row } from "../db";
import { ApiError } from "../errors";
import { requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import { outboundConfigured, sendTextCard, WecomRejected } from "./wecom";

/**
 * 通知 Outbox：单条 UPDATE … RETURNING 原子认领后再调用企业微信。
 * 对应 Spring 的 NotificationService 与 OpsController 中通知/审计部分。
 */

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function longParam(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "编号格式错误");
  return parsed;
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

export async function notificationsList(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list(
    "SELECT n.*,p.name AS recipient_name FROM notifications n LEFT JOIN people p ON p.id=n.person_id ORDER BY n.id DESC LIMIT 300",
  );
}

export async function notificationRetry(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(caller(ctx));
  const id = longParam(ctx.params.id);
  const notice = await one("SELECT id,state FROM notifications WHERE id=? FOR UPDATE", id);
  const state = str(notice.state);
  if (state !== "FAILED" && state !== "NOT_CONFIGURED") {
    throw new ApiError(409, "仅发送失败或未配置消息可以重试");
  }
  await execute(
    "UPDATE notifications SET state='PENDING',send_attempts=0,attempted_at=NULL,last_error=NULL WHERE id=?",
    id,
  );
  await record(actor.id, "notification", id, "RETRY", { previous_state: state });
  return one("SELECT id,state FROM notifications WHERE id=?", id);
}

export async function auditLogs(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300");
}

/** 定时任务/运维手动调度入口；不做登录校验，调用方必须已鉴权。 */
export async function dispatchNotifications(): Promise<Record<string, unknown>> {
  let processed = 0;
  let accepted = 0;
  let failed = 0;
  // 崩溃的 worker 可能已经发出卡片；结果不明时绝不重新认领。
  await execute(
    "UPDATE notifications SET state='UNKNOWN',last_error='发送结果未知，请人工核对' WHERE state='SENDING' AND attempted_at < (CURRENT_TIMESTAMP - INTERVAL '5 minutes')",
  );
  for (let i = 0; i < 40; i++) {
    // 单条语句原子认领：PostgREST 每次调用即一个事务，不能依赖跨请求的行锁。
    let notice: Row | null = await optional(
      "UPDATE notifications SET state='SENDING',send_attempts=send_attempts+1," +
        "attempted_at=CURRENT_TIMESTAMP WHERE id=(SELECT id FROM notifications WHERE state='PENDING' " +
        "ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *",
    );
    if (notice === null) break;
    if (notice.person_id !== null && notice.person_id !== undefined) {
      const person = await optional("SELECT wecom_userid FROM people WHERE id=?", notice.person_id);
      if (person !== null) notice = { ...notice, wecom_userid: person.wecom_userid };
    }
    const id = Number(notice.id);
    const userid = str(notice.wecom_userid);
    if (!outboundConfigured() || userid === null || userid.trim() === "") {
      await execute(
        "UPDATE notifications SET state='NOT_CONFIGURED',last_error='应用发送未启用或人员未绑定企业微信' WHERE id=? AND state='SENDING'",
        id,
      );
      processed++;
      continue;
    }
    const taskId = notice.task_id === null || notice.task_id === undefined ? null : num(notice.task_id);
    try {
      const providerMsgid = await sendTextCard(userid, "SocialTask 任务通知", str(notice.details), taskId);
      await execute(
        "UPDATE notifications SET state='SENT',sent_at=CURRENT_TIMESTAMP,provider_msgid=?,last_error=NULL WHERE id=? AND state='SENDING'",
        providerMsgid,
        id,
      );
      accepted++;
    } catch (error) {
      if (error instanceof WecomRejected) {
        await execute(
          "UPDATE notifications SET state='FAILED',last_error='企业微信明确拒绝请求' WHERE id=? AND state='SENDING'",
          id,
        );
      } else {
        await execute(
          "UPDATE notifications SET state='UNKNOWN',last_error='发送结果未知，请人工核对' WHERE id=? AND state='SENDING'",
          id,
        );
      }
      failed++;
    }
    processed++;
  }
  return {
    processed,
    accepted_by_api: accepted,
    failed_attempts: failed,
    wecom_configured: outboundConfigured(),
  };
}
