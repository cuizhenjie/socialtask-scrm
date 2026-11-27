import { randomUUID } from "node:crypto";
import { execute, insert, list, one, optional, required, stamp, str, type Row } from "../db";
import { ApiError } from "../errors";
import { requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import { attachSla } from "./sla";

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function pathId(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ApiError(400, "编号格式错误");
  return parsed;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function futureDeadline(value: unknown): Date {
  const text = typeof value === "string" ? value.trim() : "";
  const time = new Date(text);
  if (!text || Number.isNaN(time.getTime()) || time.getTime() < Date.now() - 30_000) {
    throw new ApiError(400, "截止时间应为未来的 ISO-8601 UTC 时间，例如 2026-11-25T10:00:00Z");
  }
  return time;
}

function businessNumber(prefix: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return prefix + `${value("year")}${value("month")}${value("day")}` + randomUUID().slice(0, 10).replace(/-/g, "").toUpperCase();
}

async function notifyTask(taskId: number, personId: number, event: string, message: string, key: string): Promise<void> {
  await execute(
    "INSERT INTO notifications(event_key,task_id,person_id,event_type,details) VALUES(?,?,?,?,?) ON CONFLICT (event_key) DO NOTHING",
    key,
    taskId,
    personId,
    event,
    message,
  );
}

async function audit(actorId: number, entity: string, entityId: number, action: string, after: unknown): Promise<void> {
  await execute(
    "INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,CAST(? AS jsonb))",
    actorId,
    entity,
    String(entityId),
    action,
    after === null ? null : JSON.stringify(after),
  );
}

async function createOfficialCommentTask(
  title: string,
  assignee: number,
  due: Date,
  workId: number,
  payload: Record<string, unknown>,
  actorId: number,
): Promise<number> {
  const now = Date.now();
  let firstRemind = new Date(due.getTime() - 30 * 60000);
  if (firstRemind.getTime() < now) firstRemind = new Date(now + 60000);
  const taskNo = businessNumber("COM");
  const taskId = await insert(
    "INSERT INTO tasks(task_no,title,type,assignee_id,batch_id,work_id,customer_id,round_id,due_at,payload_json,reminder_interval,reminder_max,next_remind_at) VALUES(?,?,?,?,?,?,?,?,?,CAST(? AS jsonb),?,?,?)",
    taskNo,
    title,
    "OFFICIAL_COMMENT",
    assignee,
    null,
    workId,
    null,
    null,
    stamp(due),
    JSON.stringify(payload),
    10,
    5,
    stamp(firstRemind),
  );
  await attachSla(taskId, "OFFICIAL_COMMENT", "NORMAL", new Date());
  await notifyTask(taskId, assignee, "TASK_CREATED", `${taskNo}：${title}`, `TASK:${taskId}:CREATE`);
  await audit(actorId, "task", taskId, "CREATE", { task_no: taskNo, type: "OFFICIAL_COMMENT", assignee_id: assignee });
  return taskId;
}

export async function workList(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list(
    "SELECT w.*,p.name AS author_name FROM works w JOIN people p ON p.id=w.author_person_id ORDER BY w.id DESC LIMIT 500",
  );
}

export async function commentList(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list(
    "SELECT c.*,w.work_url FROM comments c JOIN works w ON w.id=c.work_id ORDER BY c.id DESC LIMIT 500",
  );
}

export async function workComments(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list("SELECT * FROM comments WHERE work_id=? ORDER BY id DESC", pathId(ctx.params.id));
}

export async function addComment(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(caller(ctx));
  const workId = pathId(ctx.params.id);
  await one("SELECT id FROM works WHERE id=?", workId);
  const rawNickname = ctx.body.nickname;
  const rawContent = ctx.body.content;
  if (typeof rawNickname !== "string" || typeof rawContent !== "string") {
    throw new ApiError(400, "评论人昵称不能为空或过长");
  }
  required(rawNickname, "评论人昵称", 160);
  required(rawContent, "真实评论原文", 10000);
  const externalUid = optionalText(ctx.body.externalUid);
  const rawCategory = ctx.body.category;
  const category = rawCategory === null || rawCategory === undefined ? "其他" : String(rawCategory);
  const commentId = await insert(
    "INSERT INTO comments(work_id,nickname,external_uid,content,category) VALUES(?,?,?,?,?)",
    workId,
    rawNickname,
    externalUid,
    rawContent,
    category,
  );
  await audit(actor.id, "comment", commentId, "RECORD_REAL_COMMENT", { work_id: workId });
  return one("SELECT * FROM comments WHERE id=?", commentId);
}

export async function createOfficialCommentTaskRoute(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(caller(ctx));
  const workId = pathId(ctx.params.id);
  const work = await one("SELECT * FROM works WHERE id=?", workId);
  if (str(work.verify_status) !== "VERIFIED") throw new ApiError(409, "作品尚未审核通过");
  const assistantId = Number(ctx.body.assistantId);
  if (!Number.isInteger(assistantId) || assistantId <= 0) throw new ApiError(400, "编号格式错误");
  const assignee = await one("SELECT person_type,status FROM people WHERE id=?", assistantId);
  if (!(str(assignee.status) === "ACTIVE" && str(assignee.person_type) === "assistant")) {
    throw new ApiError(409, "必须是有效官方助理账号");
  }
  const commentText = required(ctx.body.commentText, "官方评论文案", 2000);
  const pending = await optional(
    "SELECT id FROM tasks WHERE work_id=? AND type='OFFICIAL_COMMENT' AND status IN ('PENDING','REWORK','SUBMITTED') LIMIT 1",
    workId,
  );
  if (pending) throw new ApiError(409, "该作品已有未完成的官方助理评论任务");
  const taskId = await createOfficialCommentTask(
    "官方助理公开评论",
    assistantId,
    futureDeadline(ctx.body.deadline),
    workId,
    { comment_text: commentText },
    actor.id,
  );
  return { id: taskId, work_id: workId, status: "PENDING" };
}
