import { randomUUID } from "node:crypto";
import { execute, insert, instant, json, list, num, one, optional, str, type Row } from "../db";
import { requireAdmin } from "../context";
import type { Ctx } from "../dispatch";
import { newTask, notifyTask } from "./task";
import { runSlaTick } from "./sla";
import { dispatchNotifications } from "./notification";
import { purgeExpiredAttachments } from "./storage";

const BUSINESS_ZONE = "Asia/Shanghai";

function businessDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function mayRemind(state: string | null, count: number, max: number): boolean {
  return (state === "PENDING" || state === "REWORK") && count >= 0 && max > 0 && count < max;
}

function mayFollowup(
  author: string | null,
  assistant: string | null,
  customerState: string,
  hasConsent: boolean,
  doNotContact: boolean,
  firstFinishedAt: Date | null,
  now: Date,
): boolean {
  return (
    hasConsent &&
    !doNotContact &&
    customerState === "NO_REPLY" &&
    author === "NO_REPLY" &&
    assistant === "NO_REPLY" &&
    firstFinishedAt !== null &&
    businessDate(now) > businessDate(firstFinishedAt)
  );
}

/** 对应 SchedulerService.remindDue：超时标记 + 分级催办。 */
export async function remindDue(): Promise<Record<string, number>> {
  let reminded = 0;
  let overdue = 0;
  const waiting = await list(
    "SELECT * FROM tasks WHERE status IN ('PENDING','REWORK') AND (next_remind_at<=CURRENT_TIMESTAMP OR due_at<CURRENT_TIMESTAMP) ORDER BY due_at LIMIT 100 FOR UPDATE SKIP LOCKED",
  );
  const now = new Date();
  for (const task of waiting) {
    const id = Number(task.id);
    const state = str(task.status);
    const count = num(task.reminder_count);
    const max = num(task.reminder_max);
    const dueAt = instant(task.due_at);
    if (dueAt && dueAt < now && (task.overdue_at === null || task.overdue_at === undefined)) {
      await execute("UPDATE tasks SET overdue_at=? WHERE id=?", now.toISOString(), id);
      overdue++;
      await notifyTask(id, Number(task.assignee_id), "TASK_OVERDUE", "任务已超时", `TASK:${id}:OVERDUE`);
    }
    const nextRemind = task.next_remind_at ? instant(task.next_remind_at) : null;
    if (!nextRemind || nextRemind > now) continue;
    if (!mayRemind(state, count, max)) continue;
    const next = count + 1;
    const atLimit = next >= max;
    const interval = num(task.reminder_interval) || 60;
    await execute(
      "UPDATE tasks SET reminder_count=?,next_remind_at=? WHERE id=?",
      next,
      atLimit ? null : new Date(now.getTime() + interval * 60_000).toISOString(),
      id,
    );
    await notifyTask(id, Number(task.assignee_id), "TASK_REMINDER", `第${next}次催办，请打开任务处理`, `TASK:${id}:REMIND:${next}`);
    if (atLimit) {
      await execute(
        "INSERT INTO notifications(event_key,task_id,person_id,event_type,details,state) VALUES(?,?,NULL,'ADMIN_ESCALATION',?,'WORKBENCH') ON CONFLICT (event_key) DO NOTHING",
        `TASK:${id}:LIMIT`,
        id,
        "任务已达到催办上限，需要管理员人工处理",
      );
    }
    reminded++;
  }
  return { reminded, new_overdue: overdue };
}

/** 对应 SchedulerService.createFollowups：次日授权客服回访。 */
export async function createFollowups(): Promise<Record<string, number>> {
  const maxActive = Math.max(1, Number(process.env.FOLLOWUP_MAX_ACTIVE_TASKS || 10));
  let created = 0;
  let noStaff = 0;
  const rounds = await list(
    "SELECT r.id AS round_id,r.customer_id,c.status,c.contact_allowed,c.do_not_contact,c.consent_basis FROM contact_rounds r JOIN customers c ON c.id=r.customer_id WHERE r.round_no=1 AND r.status='ACTIVE' AND c.status IN ('NEW','NO_REPLY') AND c.contact_allowed=TRUE AND c.do_not_contact=FALSE ORDER BY r.id LIMIT 200",
  );
  for (const row of rounds) {
    const customerId = num(row.customer_id);
    const customer = await one("SELECT * FROM customers WHERE id=? FOR UPDATE", customerId);
    if (
      !customer.contact_allowed ||
      customer.do_not_contact ||
      ["RESPONDED", "REFUSED"].includes(str(customer.status) ?? "")
    ) {
      continue;
    }
    if (await optional("SELECT id FROM contact_rounds WHERE customer_id=? AND round_no=2", customerId)) continue;
    const attempts: Row[] = await list(
      "SELECT t.type,t.status,t.updated_at,a.reply_status FROM tasks t LEFT JOIN contact_attempts a ON a.task_id=t.id WHERE t.round_id=? AND t.type IN ('CONTACT_AUTHOR','CONTACT_ASSISTANT')",
      num(row.round_id),
    );
    if (attempts.length !== 2 || attempts.some((item) => str(item.status) !== "COMPLETED")) continue;
    let author: string | null = null;
    let assistant: string | null = null;
    let finished: Date | null = null;
    for (const attempt of attempts) {
      if (str(attempt.type) === "CONTACT_AUTHOR") author = str(attempt.reply_status);
      if (str(attempt.type) === "CONTACT_ASSISTANT") assistant = str(attempt.reply_status);
      const at = instant(attempt.updated_at);
      if (at && (!finished || at > finished)) finished = at;
    }
    if (!mayFollowup(author, assistant, "NO_REPLY", true, false, finished, new Date())) continue;
    const staff = await optional(
      "SELECT p.id FROM people p LEFT JOIN tasks t ON t.assignee_id=p.id AND t.status IN ('PENDING','REWORK') "
        + "WHERE p.person_type='support' AND p.group_name='第三组' AND p.status='ACTIVE' "
        + "AND p.wecom_userid IS NOT NULL AND p.wecom_userid<>'' "
        + "AND EXISTS(SELECT 1 FROM social_accounts sa WHERE sa.person_id=p.id AND sa.platform='douyin' AND sa.status='ACTIVE') "
        + "GROUP BY p.id HAVING COUNT(t.id) < ? ORDER BY COUNT(t.id) ASC,p.id ASC LIMIT 1",
      maxActive,
    );
    if (!staff) {
      noStaff++;
      continue;
    }
    const round = await insert("INSERT INTO contact_rounds(customer_id,round_no) VALUES(?,2)", customerId);
    const task = await newTask(
      "FOLLOWUP",
      "次日授权客服回访",
      Number(staff.id),
      new Date(Date.now() + 12 * 3600_000),
      null,
      null,
      customerId,
      round,
      {
        private_message:
          "您好，这里是官方客服。您此前咨询过相关项目，如仍需要了解，可以由我为您答疑；如不需要，我们将不再打扰。",
        disclose_identity: true,
      },
      60,
      3,
      null,
    );
    await execute("UPDATE customers SET status='FOLLOWUP_PENDING' WHERE id=?", customerId);
    await execute(
      "INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,CAST(? AS jsonb))",
      null,
      "contact_round",
      String(round),
      "AUTO_FOLLOWUP",
      json({ task_id: task }),
    );
    created++;
  }
  return { created, missing_support: noStaff };
}

async function purgeMessageBodies() {
  const wecomDays = Number(process.env.WECOM_RETENTION_DAYS || 90);
  const kfDays = Number(process.env.WECOM_KF_RETENTION_DAYS || 30);
  let redacted = 0, inbox = 0, kf = 0;
  if (Number.isInteger(wecomDays) && wecomDays >= 1 && wecomDays <= 3650) {
    redacted = await execute(
      "UPDATE wecom_messages m SET content=NULL,provider_msgid=NULL,provider_media_id=NULL,media_filename=NULL,media_bytes=NULL,delivery_status='REDACTED' WHERE m.message_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 day')) AND m.delivery_status<>'REDACTED' AND EXISTS(SELECT 1 FROM tasks t WHERE t.source_message_id=m.id)", wecomDays,
    );
    inbox = await execute(
      "DELETE FROM wecom_messages m WHERE NOT EXISTS(SELECT 1 FROM tasks t WHERE t.source_message_id=m.id) AND m.message_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 day'))", wecomDays,
    );
  }
  if (Number.isInteger(kfDays) && kfDays >= 1 && kfDays <= 90) {
    kf = await execute("DELETE FROM kf_messages WHERE message_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 day'))", kfDays);
  }
  return { redacted, inbox, kf };
}

/** DB-backed lease prevents overlapping manual and scheduled runs across instances. */
export async function runOpsTick(): Promise<Record<string, unknown>> {
  const token = randomUUID();
  const acquired = await execute(
    "INSERT INTO socialtask_job_leases(job,token,expires_at) VALUES('ops',CAST(? AS uuid), CURRENT_TIMESTAMP + INTERVAL '10 minutes') ON CONFLICT(job) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at WHERE socialtask_job_leases.expires_at<=CURRENT_TIMESTAMP", token,
  );
  if (!acquired) return { skipped: true, reason: "ALREADY_RUNNING" };
  const result: Record<string, unknown> = {};
  const failed: string[] = [];
  try {
    for (const [name, job] of Object.entries({
      reminders: remindDue, followups: createFollowups, sla: runSlaTick,
      notifications: dispatchNotifications, messages: purgeMessageBodies, attachments: purgeExpiredAttachments,
    })) {
      try {
        const output = await job();
        result[name] = output;
        if (name === "attachments" && Number((output as Record<string, unknown>).failed) > 0) failed.push(name);
      } catch {
        failed.push(name);
      }
    }
    return { ...result, failed };
  } finally {
    await execute("DELETE FROM socialtask_job_leases WHERE job='ops' AND token=CAST(? AS uuid)", token)
      .catch(() => undefined); // bounded lease recovers if the gateway is unavailable
  }
}

/** Manual admin endpoint retained for the operations workbench. */
export async function opsTick(ctx: Ctx): Promise<Record<string, unknown>> {
  requireAdmin(ctx.user!);
  return runOpsTick();
}
