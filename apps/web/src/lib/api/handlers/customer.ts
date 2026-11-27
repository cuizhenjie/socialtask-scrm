import { randomUUID } from "node:crypto";
import { bool, execute, insert, list, num, one, optional, required, stamp, str, type Row } from "../db";
import { ApiError } from "../errors";
import { isAdmin, requireAdmin, sha256, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import { attachSla } from "./sla";

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function flag(value: unknown): boolean {
  return value === true;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function optionalLong(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "参数有误");
  return parsed;
}

function requiredLong(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ApiError(400, "编号格式错误");
  return parsed;
}

function pathId(value: string): number {
  return requiredLong(value);
}

function trustedDouyinHost(host: string): boolean {
  return (
    host === "douyin.com" ||
    host.endsWith(".douyin.com") ||
    host === "iesdouyin.com" ||
    host.endsWith(".iesdouyin.com")
  );
}

function canonicalProfileDouyin(input: string): string {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !trustedDouyinHost(host) ||
      url.username !== "" ||
      url.password !== "" ||
      !url.pathname ||
      url.pathname === "/"
    ) {
      throw new Error("invalid");
    }
    return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    throw new ApiError(400, "需要人工核验且为 HTTPS 的抖音账号主页");
  }
}

function businessDate(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}`;
}

function businessNumber(prefix: string): string {
  return prefix + businessDate() + randomUUID().slice(0, 10).replace(/-/g, "").toUpperCase();
}

function futureDeadline(value: unknown): Date {
  const text = typeof value === "string" ? value.trim() : "";
  const time = new Date(text);
  if (!text || Number.isNaN(time.getTime()) || time.getTime() < Date.now() - 30_000) {
    throw new ApiError(400, "截止时间应为未来的 ISO-8601 UTC 时间，例如 2026-11-25T10:00:00Z");
  }
  return time;
}

function requirePermission(allowed: boolean, doNotContact: boolean, basis: string | null): void {
  if (!allowed || doNotContact || basis === null || basis.trim().length < 4) {
    throw new ApiError(400, "客户联系许可不足或已经拒绝联系");
  }
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

/** 内联 TaskService.newTask 的任务与通知写入；SLA 挂接复用 sla 模块的 attachSla。 */
async function createTask(
  type: string,
  title: string,
  assignee: number,
  due: Date,
  batchId: number | null,
  workId: number | null,
  customerId: number | null,
  roundId: number | null,
  payload: Record<string, unknown>,
  interval: number,
  max: number,
  actorId: number,
): Promise<number> {
  const now = Date.now();
  let firstRemind = new Date(due.getTime() - 30 * 60000);
  if (firstRemind.getTime() < now) firstRemind = new Date(now + 60000);
  const prefix =
    type === "PUBLISH"
      ? "PUB"
      : type === "OFFICIAL_COMMENT"
        ? "COM"
        : type === "CONTACT_AUTHOR" || type === "CONTACT_ASSISTANT"
          ? "DM"
          : type === "SERVICE_TICKET"
            ? "TKT"
            : "FOL";
  const taskNo = businessNumber(prefix);
  const taskId = await insert(
    "INSERT INTO tasks(task_no,title,type,assignee_id,batch_id,work_id,customer_id,round_id,due_at,payload_json,reminder_interval,reminder_max,next_remind_at) VALUES(?,?,?,?,?,?,?,?,?,CAST(? AS jsonb),?,?,?)",
    taskNo,
    title,
    type,
    assignee,
    batchId,
    workId,
    customerId,
    roundId,
    stamp(due),
    JSON.stringify(payload),
    interval,
    max,
    stamp(firstRemind),
  );
  await attachSla(taskId, type, "NORMAL", new Date());
  await notifyTask(taskId, assignee, "TASK_CREATED", `${taskNo}：${title}`, `TASK:${taskId}:CREATE`);
  await audit(actorId, "task", taskId, "CREATE", { task_no: taskNo, type, assignee_id: assignee });
  return taskId;
}

export async function customerList(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  const q = ctx.query.get("q");
  const status = ctx.query.get("status");
  const segmentId = optionalLong(ctx.query.get("segmentId"));
  const tagId = optionalLong(ctx.query.get("tagId"));
  let sql =
    "SELECT c.*,g.name AS segment_name, (SELECT COUNT(*) FROM customer_sources s WHERE s.customer_id=c.id) AS source_count, (SELECT string_agg(t.name, ',' ORDER BY t.name) FROM customer_tag_links l JOIN customer_tags t ON t.id=l.tag_id WHERE l.customer_id=c.id) AS tag_names, (SELECT string_agg(l.tag_id::text, ',' ORDER BY l.tag_id) FROM customer_tag_links l WHERE l.customer_id=c.id) AS tag_ids FROM customers c LEFT JOIN customer_segments g ON g.id=c.segment_id WHERE 1=1";
  const args: unknown[] = [];
  if (q !== null && q.trim() !== "") {
    sql += " AND (c.customer_no LIKE ? OR c.nickname LIKE ?)";
    const pattern = `%${q.trim()}%`;
    args.push(pattern, pattern);
  }
  if (status !== null && status.trim() !== "") {
    sql += " AND c.status=?";
    args.push(status);
  }
  if (segmentId !== null) {
    sql += " AND c.segment_id=?";
    args.push(segmentId);
  }
  if (tagId !== null) {
    sql += " AND EXISTS(SELECT 1 FROM customer_tag_links l WHERE l.customer_id=c.id AND l.tag_id=?)";
    args.push(tagId);
  }
  sql += " ORDER BY c.id DESC LIMIT 500";
  return list(sql, ...args);
}

export async function customerSegments(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list(
    "SELECT s.*,(SELECT COUNT(*) FROM customers c WHERE c.segment_id=s.id) AS customer_count FROM customer_segments s ORDER BY s.id",
  );
}

export async function addSegment(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const name = required(ctx.body.name, "客户分组", 100);
  const description = optionalText(ctx.body.description);
  const segmentId = await insert(
    "INSERT INTO customer_segments(name,description) VALUES(?,?)",
    name,
    description === null ? "" : description.trim(),
  );
  await audit(user.id, "customer_segment", segmentId, "CREATE", { name });
  return one("SELECT * FROM customer_segments WHERE id=?", segmentId);
}

export async function customerTags(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list(
    "SELECT t.*,(SELECT COUNT(*) FROM customer_tag_links l WHERE l.tag_id=t.id) AS customer_count FROM customer_tags t ORDER BY t.id",
  );
}

export async function addTag(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const name = required(ctx.body.name, "客户标签", 60);
  const tagId = await insert("INSERT INTO customer_tags(name) VALUES(?)", name);
  await audit(user.id, "customer_tag", tagId, "CREATE", { name });
  return one("SELECT * FROM customer_tags WHERE id=?", tagId);
}

export async function classifyCustomer(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const customerId = pathId(ctx.params.id);
  await one("SELECT id FROM customers WHERE id=? FOR UPDATE", customerId);
  const segmentId = optionalLong(ctx.body.segmentId);
  if (segmentId === null) throw new ApiError(400, "客户分组不能为空");
  const segment = await one("SELECT id,active FROM customer_segments WHERE id=?", segmentId);
  if (!bool(segment.active)) throw new ApiError(400, "客户分组已经停用");
  const rawTags = ctx.body.tagIds;
  let tagIds: number[] = [];
  if (rawTags === null || rawTags === undefined) {
    throw new ApiError(400, "最多设置 30 个不同客户标签");
  }
  if (!Array.isArray(rawTags)) throw new ApiError(400, "最多设置 30 个不同客户标签");
  tagIds = rawTags.map((item) => Number(item));
  if (tagIds.length > 30 || new Set(tagIds).size !== tagIds.length) {
    throw new ApiError(400, "最多设置 30 个不同客户标签");
  }
  for (const tagId of tagIds) {
    if (!Number.isInteger(tagId) || tagId <= 0) throw new ApiError(400, "标签编号错误");
    await one("SELECT id FROM customer_tags WHERE id=?", tagId);
  }
  await execute("UPDATE customers SET segment_id=? WHERE id=?", segmentId, customerId);
  await execute("DELETE FROM customer_tag_links WHERE customer_id=?", customerId);
  for (const tagId of tagIds) {
    await execute("INSERT INTO customer_tag_links(customer_id,tag_id) VALUES(?,?)", customerId, tagId);
  }
  await audit(user.id, "customer", customerId, "CLASSIFY", { segment_id: segmentId, tag_ids: tagIds });
  return customerDetail(ctx, customerId);
}

export async function createCustomer(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const body = ctx.body;
  const nickname = required(body.nickname, "客户昵称", 160);
  const identityVerified = flag(body.identityVerified);
  const contactAllowed = flag(body.contactAllowed);
  const consentBasis = optionalText(body.consentBasis);
  if (contactAllowed) requirePermission(true, false, consentBasis);
  const sourceWorkId = optionalLong(body.sourceWorkId);
  const sourceCommentId = optionalLong(body.sourceCommentId);
  if (sourceCommentId !== null && sourceWorkId === null) {
    throw new ApiError(400, "关联评论时必须指定来源作品");
  }
  const identities = new Map<string, string>();
  if (identityVerified) {
    const externalUid = optionalText(body.externalUid);
    if (externalUid !== null && externalUid.trim() !== "") {
      identities.set("UID", sha256(externalUid.trim()));
    }
    const profileUrl = optionalText(body.profileUrl);
    if (profileUrl !== null && profileUrl.trim() !== "") {
      identities.set("PROFILE", sha256(canonicalProfileDouyin(profileUrl)));
    }
    if (identities.size === 0) throw new ApiError(400, "已核验客户必须提供 UID 或账号主页");
  }
  const matches = new Set<number>();
  for (const [kind, hash] of identities) {
    const matched = await optional(
      "SELECT customer_id FROM customer_identities WHERE platform='douyin' AND identity_kind=? AND identity_hash=?",
      kind,
      hash,
    );
    if (matched) matches.add(num(matched.customer_id));
  }
  if (matches.size > 1) {
    throw new ApiError(409, "身份信息指向不同客户，需要管理员核验合并，系统不会自动覆盖档案");
  }
  let customerId: number;
  if (matches.size === 0) {
    customerId = await insert(
      "INSERT INTO customers(customer_no,nickname,status,contact_allowed,consent_basis) VALUES(?,?,?,?,?)",
      businessNumber("C"),
      nickname,
      "NEW",
      contactAllowed,
      consentBasis,
    );
    await audit(user.id, "customer", customerId, "CREATE", { identity_verified: identityVerified });
  } else {
    customerId = [...matches][0];
  }
  for (const [kind, hash] of identities) {
    const found = await optional(
      "SELECT customer_id FROM customer_identities WHERE platform='douyin' AND identity_kind=? AND identity_hash=?",
      kind,
      hash,
    );
    if (!found) {
      await execute(
        "INSERT INTO customer_identities(customer_id,platform,identity_kind,identity_hash) VALUES(?,?,?,?)",
        customerId,
        "douyin",
        kind,
        hash,
      );
    } else if (num(found.customer_id) !== customerId) {
      throw new ApiError(409, "身份标识冲突，需要人工核验");
    }
  }
  if (sourceWorkId !== null) {
    await one("SELECT id FROM works WHERE id=?", sourceWorkId);
    if (sourceCommentId !== null) {
      const comment = await one("SELECT work_id FROM comments WHERE id=?", sourceCommentId);
      if (num(comment.work_id) !== sourceWorkId) throw new ApiError(409, "原始评论不属于指定作品");
    }
    const source = `W${sourceWorkId}-C${sourceCommentId === null ? 0 : sourceCommentId}`;
    await execute(
      "INSERT INTO customer_sources(customer_id,work_id,comment_id,source_key) VALUES(?,?,?,?) ON CONFLICT (customer_id,source_key) DO NOTHING",
      customerId,
      sourceWorkId,
      sourceCommentId,
      source,
    );
  }
  return customerDetail(ctx, customerId);
}

export async function customerDetail(ctx: Ctx, customerId: number): Promise<Row> {
  const user = caller(ctx);
  const customer = await one("SELECT * FROM customers WHERE id=?", customerId);
  if (!isAdmin(user)) {
    if (user.personId === null) throw new ApiError(403, "无客户访问权限");
    const assigned = await optional(
      "SELECT id FROM tasks WHERE customer_id=? AND assignee_id=? LIMIT 1",
      customerId,
      user.personId,
    );
    if (!assigned) throw new ApiError(403, "无权访问未分派客户");
  }
  const result: Row = { ...customer };
  if (isAdmin(user)) {
    const segment = await optional("SELECT name FROM customer_segments WHERE id=?", customer.segment_id);
    result.segment_name = segment === null ? "未分组" : str(segment.name) ?? "未分组";
    const tags = await list(
      "SELECT t.id,t.name FROM customer_tag_links l JOIN customer_tags t ON t.id=l.tag_id WHERE l.customer_id=? ORDER BY t.name",
      customerId,
    );
    result.tags = tags;
    result.tag_ids = tags.map((tag) => num(tag.id));
  }
  result.sources = await list(
    "SELECT s.id,s.work_id,s.comment_id,w.work_url FROM customer_sources s JOIN works w ON w.id=s.work_id WHERE s.customer_id=? ORDER BY s.id",
    customerId,
  );
  result.contact_rounds = await list(
    "SELECT id,round_no,status,created_at FROM contact_rounds WHERE customer_id=? ORDER BY round_no",
    customerId,
  );
  result.timeline = await list(
    "SELECT t.id,t.task_no,t.title,t.type,t.status,t.assignee_id,p.name AS assignee_name,t.created_at,t.updated_at FROM tasks t JOIN people p ON p.id=t.assignee_id WHERE t.customer_id=? ORDER BY t.created_at,t.id",
    customerId,
  );
  return result;
}

export async function customerDetailRoute(ctx: Ctx): Promise<Row> {
  return customerDetail(ctx, pathId(ctx.params.id));
}

export async function customerTimeline(ctx: Ctx): Promise<unknown> {
  const detail = await customerDetail(ctx, pathId(ctx.params.id));
  return detail.timeline;
}

export async function updatePermission(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const customerId = pathId(ctx.params.id);
  const contactAllowed = flag(ctx.body.contactAllowed);
  const consentBasis = optionalText(ctx.body.consentBasis);
  const customer = await one("SELECT * FROM customers WHERE id=? FOR UPDATE", customerId);
  if (bool(customer.do_not_contact) && contactAllowed) {
    throw new ApiError(409, "已经拒绝联系的客户禁止直接重新开启外联");
  }
  if (contactAllowed) requirePermission(true, false, consentBasis);
  await execute("UPDATE customers SET contact_allowed=?,consent_basis=? WHERE id=?", contactAllowed, consentBasis, customerId);
  await audit(user.id, "customer", customerId, "CONTACT_PERMISSION", { allowed: contactAllowed });
  return customerDetail(ctx, customerId);
}

export async function customerDoNotContact(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const customerId = pathId(ctx.params.id);
  const reason = required(ctx.body.reason, "停止联系原因", 500);
  await one("SELECT id FROM customers WHERE id=? FOR UPDATE", customerId);
  await execute("UPDATE customers SET do_not_contact=TRUE,contact_allowed=FALSE,status='REFUSED' WHERE id=?", customerId);
  const active = await list(
    "SELECT id,assignee_id FROM tasks WHERE customer_id=? AND status IN ('PENDING','REWORK') AND type IN ('CONTACT_AUTHOR','CONTACT_ASSISTANT','FOLLOWUP') FOR UPDATE",
    customerId,
  );
  for (const task of active) {
    const taskId = num(task.id);
    await execute("UPDATE tasks SET status='STOPPED',next_remind_at=NULL WHERE id=?", taskId);
    await notifyTask(taskId, num(task.assignee_id), "TASK_STOPPED", "客户拒绝联系，禁止继续联系", `TASK:${taskId}:STOP`);
  }
  await execute("UPDATE contact_rounds SET status='REFUSED' WHERE customer_id=? AND status='ACTIVE'", customerId);
  await audit(user.id, "customer", customerId, "DO_NOT_CONTACT", { reason, stopped: active.length });
  return customerDetail(ctx, customerId);
}

export async function firstRound(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const customerId = pathId(ctx.params.id);
  const body = ctx.body;
  const customer = await one("SELECT * FROM customers WHERE id=? FOR UPDATE", customerId);
  requirePermission(bool(customer.contact_allowed), bool(customer.do_not_contact), str(customer.consent_basis));
  if (str(customer.status) === "RESPONDED") throw new ApiError(409, "客户已回复，不应重复派发首次外联");
  if (await optional("SELECT id FROM contact_rounds WHERE customer_id=? AND round_no=1", customerId)) {
    throw new ApiError(409, "首轮联系任务已存在");
  }
  const authorId = requiredLong(body.authorId);
  const assistantId = requiredLong(body.assistantId);
  if (authorId === assistantId) throw new ApiError(400, "作者和官方助理不能是同一执行人");
  const author = await one("SELECT person_type,status FROM people WHERE id=?", authorId);
  const assistant = await one("SELECT person_type,status FROM people WHERE id=?", assistantId);
  if (!(str(author.person_type) === "author" && str(author.status) === "ACTIVE")) {
    throw new ApiError(409, "作者必须为启用状态");
  }
  if (!(str(assistant.person_type) === "assistant" && str(assistant.status) === "ACTIVE")) {
    throw new ApiError(409, "助理必须为启用的官方助理");
  }
  const privateMessage = optionalText(body.privateMessage);
  const authorMessage = required(optionalText(body.authorMessage) ?? privateMessage, "作者私信内容", 2000);
  const assistantMessage = required(optionalText(body.assistantMessage) ?? privateMessage, "助理私信内容", 2000);
  const due = futureDeadline(body.deadline);
  const roundId = await insert("INSERT INTO contact_rounds(customer_id,round_no) VALUES(?,1)", customerId);
  const authorTask = await createTask(
    "CONTACT_AUTHOR",
    "客户首次联系·作者",
    authorId,
    due,
    null,
    null,
    customerId,
    roundId,
    { private_message: authorMessage, disclose_identity: true },
    30,
    3,
    user.id,
  );
  const assistantTask = await createTask(
    "CONTACT_ASSISTANT",
    "客户首次联系·官方助理",
    assistantId,
    due,
    null,
    null,
    customerId,
    roundId,
    { private_message: assistantMessage, disclose_identity: true },
    30,
    3,
    user.id,
  );
  await audit(user.id, "contact_round", roundId, "CREATE", {
    author_task: authorTask,
    assistant_task: assistantTask,
  });
  return {
    id: roundId,
    author_task_id: authorTask,
    assistant_task_id: assistantTask,
    status: "ACTIVE",
  };
}
