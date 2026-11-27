import { randomUUID } from "node:crypto";
import {
  bool,
  ensure,
  execute,
  insert,
  instant,
  json,
  list,
  num,
  object,
  one,
  optional,
  required,
  stamp,
  str,
  type Row,
} from "../db";
import { ApiError, DbConflictError } from "../errors";
import { isAdmin, ownsTask, requireAdmin, sha256, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import { attachSla, markSlaResolved, markSlaResponded, reprioritizeSla, requireSlaRunning } from "./sla";

/**
 * 移植自 services/api 的 com.socialtask.task（TaskService / TaskController /
 * TicketTemplateController / TicketTemplateRepository / TicketTemplate）。
 * SQL 保留 `?` 占位符。
 */

const CONTACT_TYPES = new Set(["CONTACT_AUTHOR", "CONTACT_ASSISTANT", "FOLLOWUP"]);
const TERMINAL = new Set(["COMPLETED", "CANCELLED", "STOPPED"]);
const SLA_FILTERS = new Set(["BREACHED", "AT_RISK", "ON_TRACK", "MET", "CLOCK_PAUSED"]);

/* ------------------------------------------------------------------ */
/* 通用辅助                                                            */
/* ------------------------------------------------------------------ */

function who(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) throw new ApiError(400, "参数有误");
  return id;
}

function intOf(value: unknown): number {
  if (value === null || value === undefined || value === "") throw new ApiError(400, "参数有误");
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "参数有误");
  return parsed;
}

function intOrDefault(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  return intOf(value);
}

function at(value: unknown): Date {
  const date = instant(value);
  if (!date) throw new Error("时间字段缺失");
  return date;
}

function nonBlank(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "参数有误");
  return value as Record<string, unknown>;
}

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** TaskService.deadline：截止时间必须是未来（容忍 30 秒时钟偏差）的 ISO-8601 时间。 */
export function parseDeadline(input: unknown): Date {
  const message = "截止时间应为未来的 ISO-8601 UTC 时间，例如 2026-11-25T10:00:00Z";
  const text = typeof input === "string" ? input.trim() : "";
  if (!text || !INSTANT_RE.test(text)) throw new ApiError(400, message);
  const normalized = text.replace(/(\.\d{3})\d+/, "$1");
  const time = new Date(normalized);
  if (Number.isNaN(time.getTime()) || time.getTime() < Date.now() - 30_000) throw new ApiError(400, message);
  return time;
}

/** TaskService.number：前缀 + Asia/Shanghai 日期 + 9 位随机串。 */
function taskNumber(prefix: string): string {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const datePart = `${values.year}${values.month}${values.day}`;
  const randomPart = randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase();
  return `${prefix}${datePart}${randomPart}`;
}

function typePrefix(type: string): string {
  switch (type) {
    case "PUBLISH":
      return "PUB";
    case "OFFICIAL_COMMENT":
      return "COM";
    case "CONTACT_AUTHOR":
    case "CONTACT_ASSISTANT":
      return "DM";
    case "SERVICE_TICKET":
      return "TKT";
    default:
      return "FOL";
  }
}

function maySubmit(state: string | null): boolean {
  return state === "PENDING" || state === "REWORK";
}

function mayReview(state: string | null): boolean {
  return state === "SUBMITTED";
}

function trustedHost(host: string): boolean {
  const value = host.toLowerCase();
  return value === "douyin.com" || value.endsWith(".douyin.com") || value === "iesdouyin.com" || value.endsWith(".iesdouyin.com");
}

/** Rules.canonicalDouyin：仅接受 HTTPS 抖音作品链接。 */
function canonicalDouyin(input: unknown): string {
  try {
    const raw = String(input ?? "").trim();
    const url = new URL(raw);
    const host = url.hostname;
    if (url.protocol !== "https:" || !host || !trustedHost(host)) throw new Error("bad host");
    const path = url.pathname;
    if (!path || path === "/") throw new Error("bad path");
    return `https://${host.toLowerCase()}${path.replace(/\/+$/, "")}`;
  } catch {
    throw new ApiError(400, "作品链接格式无效：需 HTTPS 抖音作品地址");
  }
}

async function recordAudit(actor: number | null, entity: string, entityId: number, action: string, after: unknown): Promise<void> {
  await execute(
    "INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,CAST(? AS jsonb))",
    actor,
    entity,
    String(entityId),
    action,
    after === null || after === undefined ? null : json(after),
  );
}

export async function notifyTask(taskId: number, person: number, event: string, message: string, key: string): Promise<void> {
  await execute(
    "INSERT INTO notifications(event_key,task_id,person_id,event_type,details) VALUES(?,?,?,?,?) ON CONFLICT (event_key) DO NOTHING",
    key,
    taskId,
    person,
    event,
    message,
  );
}

/* ------------------------------------------------------------------ */
/* 工单模板（TicketTemplate + Repository）                             */
/* ------------------------------------------------------------------ */

type TemplatePhase = "DISPATCH" | "RESPONSE";
type TemplateKind = "TEXT" | "HTTPS_URL" | "CHECKBOX" | "MATERIAL_PACKAGE";

type TemplateField = {
  key: string;
  label: string;
  phase: TemplatePhase;
  kind: TemplateKind;
  required: boolean;
};

type TicketTemplate = {
  key: string;
  version: number;
  title: string;
  fields: TemplateField[];
};

type TemplateMaterial = {
  id: number;
  title: string | null;
  body: string | null;
  hashtags: string | null;
  assetIds: number[];
};

type TemplateSnapshot = {
  template: TicketTemplate;
  values: Record<string, unknown>;
};

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

function buildTemplate(keyRaw: unknown, versionRaw: unknown, titleRaw: unknown, fieldsRaw: unknown): TicketTemplate {
  if (typeof keyRaw !== "string" || !KEY_RE.test(keyRaw)) throw new ApiError(400, "模板标识不合法");
  if (typeof versionRaw !== "number" || !Number.isInteger(versionRaw) || versionRaw < 1) throw new ApiError(400, "模板版本不合法");
  const title = required(titleRaw, "模板名称", 100);
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0 || fieldsRaw.length > 30) throw new ApiError(400, "字段数量须为 1–30");
  const seen = new Set<string>();
  const fields: TemplateField[] = [];
  for (const item of fieldsRaw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new ApiError(400, "字段标识不合法");
    const field = item as Record<string, unknown>;
    const key = field.key;
    if (typeof key !== "string" || !KEY_RE.test(key)) throw new ApiError(400, "字段标识不合法");
    if (seen.has(key)) throw new ApiError(400, `字段标识重复：${key}`);
    seen.add(key);
    const phase = field.phase;
    const kind = field.kind;
    if (phase !== "DISPATCH" && phase !== "RESPONSE") throw new ApiError(400, "字段阶段或类型不合法");
    if (kind !== "TEXT" && kind !== "HTTPS_URL" && kind !== "CHECKBOX" && kind !== "MATERIAL_PACKAGE") throw new ApiError(400, "字段阶段或类型不合法");
    if (phase === "RESPONSE" && kind === "MATERIAL_PACKAGE") throw new ApiError(400, "素材包字段只能用于下发");
    fields.push({ key, label: required(field.label, "字段名称", 100), phase, kind, required: field.required === true });
  }
  return { key: keyRaw, version: versionRaw, title, fields };
}

function buildTemplateFromStored(raw: unknown): TicketTemplate {
  const schema = object(raw);
  return buildTemplate(schema.key, schema.version, schema.title, schema.fields);
}

function textField(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > max) throw new ApiError(400, `${label}为空、过长或类型不合法`);
  return value.trim();
}

function urlField(value: unknown, label: string): string {
  const raw = textField(value, label, 2000);
  try {
    const url = new URL(raw);
    const authority = raw.replace(/^https:\/\//i, "").split(/[/?#]/)[0];
    if (url.protocol === "https:" && url.hostname && !authority.includes("@")) return raw;
  } catch {
    // 交给下方统一报错
  }
  throw new ApiError(400, `${label}须为 HTTPS 链接`);
}

async function lookupMaterial(id: number): Promise<TemplateMaterial | null> {
  const row = await optional("SELECT id,title,body,hashtags,asset_ids_json FROM content_packages WHERE id=? AND review_status='APPROVED'", id);
  if (row === null) return null;
  const stored = row.asset_ids_json;
  let parsed: unknown;
  try {
    parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
  } catch {
    throw new ApiError(400, "素材附件格式不合法");
  }
  if (!Array.isArray(parsed)) throw new Error("素材附件格式不合法");
  return {
    id: num(row.id),
    title: str(row.title),
    body: str(row.body),
    hashtags: str(row.hashtags),
    assetIds: parsed.map((item) => num(item)),
  };
}

async function validateTemplate(
  template: TicketTemplate,
  phase: TemplatePhase,
  input: Record<string, unknown>,
  materials: ((id: number) => Promise<TemplateMaterial | null>) | null,
): Promise<Record<string, unknown>> {
  const expected = template.fields.filter((field) => field.phase === phase);
  for (const key of Object.keys(input)) {
    if (!expected.some((field) => field.key === key)) throw new ApiError(400, "存在未配置的字段");
  }
  const result: Record<string, unknown> = {};
  for (const field of expected) {
    const value = input[field.key];
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      if (field.required) throw new ApiError(400, `${field.label}为必填`);
      continue;
    }
    if (field.kind === "TEXT") {
      result[field.key] = textField(value, field.label, 3000);
    } else if (field.kind === "HTTPS_URL") {
      result[field.key] = urlField(value, field.label);
    } else if (field.kind === "CHECKBOX") {
      if (typeof value !== "boolean") throw new ApiError(400, `${field.label}须为布尔值`);
      result[field.key] = value;
    } else {
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new ApiError(400, `${field.label}须引用合法素材包 ID`);
      if (materials === null) throw new ApiError(400, `${field.label}须引用已审核通过的素材包`);
      const material = await materials(value);
      if (material === null || material.id !== value) throw new ApiError(400, `${field.label}须引用已审核通过的素材包`);
      result[field.key] = material;
    }
  }
  return result;
}

async function dispatchTemplate(key: unknown, version: unknown, values: unknown): Promise<TemplateSnapshot> {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || typeof key !== "string" || key.trim() === "") {
    throw new ApiError(400, "必须指定已发布的模板及版本");
  }
  const row = await one("SELECT schema_json FROM ticket_templates WHERE template_key=? AND version=?", key, version);
  const template = buildTemplateFromStored(row.schema_json);
  const provided = values === null || values === undefined ? {} : asRecord(values);
  const validated = await validateTemplate(template, "DISPATCH", provided, lookupMaterial);
  return { template, values: validated };
}

async function responseValues(templateRaw: unknown, requested: unknown): Promise<Record<string, unknown>> {
  const template = buildTemplateFromStored(templateRaw);
  const provided = requested === null || requested === undefined ? {} : asRecord(requested);
  return validateTemplate(template, "RESPONSE", provided, null);
}

function snapshotAssetIds(values: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  for (const value of Object.values(values)) {
    if (value !== null && typeof value === "object" && Array.isArray((value as TemplateMaterial).assetIds)) {
      for (const assetId of (value as TemplateMaterial).assetIds) ids.add(assetId);
    }
  }
  return [...ids];
}

/* ------------------------------------------------------------------ */
/* 任务                                                                */
/* ------------------------------------------------------------------ */

export async function newTask(
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
  actor: number | null,
): Promise<number> {
  let first = new Date(due.getTime() - 30 * 60_000);
  if (first.getTime() < Date.now()) first = new Date(Date.now() + 60_000);
  const taskNo = taskNumber(typePrefix(type));
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
    json(payload),
    interval,
    max,
    stamp(first),
  );
  await attachSla(taskId, type, "NORMAL", new Date());
  await notifyTask(taskId, assignee, "TASK_CREATED", `${taskNo}：${title}`, `TASK:${taskId}:CREATE`);
  await recordAudit(actor, "task", taskId, "CREATE", { task_no: taskNo, type, assignee_id: assignee });
  return taskId;
}

async function getTaskById(id: number, user: RequestUser): Promise<Record<string, unknown>> {
  const task = await one("SELECT t.*,p.name AS assignee_name,p.person_no FROM tasks t JOIN people p ON p.id=t.assignee_id WHERE t.id=?", id);
  ownsTask(user, num(task.assignee_id));
  const result: Record<string, unknown> = { ...task };
  if (task.batch_id !== null && task.batch_id !== undefined) {
    result.content = await one("SELECT c.* FROM publish_batches b JOIN content_packages c ON c.id=b.content_id WHERE b.id=?", task.batch_id);
  }
  if (task.work_id !== null && task.work_id !== undefined) {
    result.work = await one("SELECT id,work_url,verify_status FROM works WHERE id=?", task.work_id);
  }
  if (task.customer_id !== null && task.customer_id !== undefined) {
    result.customer = await one("SELECT id,customer_no,nickname,status,do_not_contact FROM customers WHERE id=?", task.customer_id);
  }
  result.sla = await optional(
    "SELECT s.*,sp.name AS policy_name,COALESCE(s.calendar_snapshot->>'calendar_mode',sp.calendar_mode) AS calendar_mode FROM task_sla s JOIN sla_policies sp ON sp.id=s.policy_id WHERE s.task_id=?",
    id,
  );
  result.submissions = await list(
    "SELECT id,revision,payload_json,attachment_id,review_status,submitted_at FROM task_submissions WHERE task_id=? ORDER BY revision DESC LIMIT 10",
    id,
  );
  return result;
}

async function stopOtherContacts(excludingTask: number, customerId: number, reply: string, actorId: number): Promise<void> {
  const refused = reply === "REFUSED";
  const status = refused ? "REFUSED" : "RESPONDED";
  await execute("UPDATE customers SET status=?,do_not_contact=? WHERE id=?", status, refused, customerId);
  const others = await list(
    "SELECT id,assignee_id FROM tasks WHERE customer_id=? AND id<>? AND type IN ('CONTACT_AUTHOR','CONTACT_ASSISTANT','FOLLOWUP') AND status IN ('PENDING','REWORK') FOR UPDATE",
    customerId,
    excludingTask,
  );
  for (const target of others) {
    const otherId = num(target.id);
    await execute("UPDATE tasks SET status='STOPPED',next_remind_at=NULL WHERE id=?", otherId);
    await notifyTask(otherId, num(target.assignee_id), "TASK_STOPPED", "客户已经回复或拒绝联系，停止重复联系", `TASK:${otherId}:STOP`);
  }
  await execute("UPDATE contact_rounds SET status=? WHERE customer_id=? AND status='ACTIVE'", status, customerId);
  await recordAudit(actorId, "customer", customerId, refused ? "DO_NOT_CONTACT" : "RESPONDED", { stop_count: others.length });
}

/* ------------------------------------------------------------------ */
/* HTTP handlers                                                       */
/* ------------------------------------------------------------------ */

const TASK_LIST_SQL =
  "SELECT t.*,p.person_no,p.name AS assignee_name,p.group_name,s.response_due_at,s.resolution_due_at,s.first_response_at,s.resolved_at, " +
  "CASE WHEN s.response_breached_at IS NOT NULL OR s.resolution_breached_at IS NOT NULL " +
  "OR (s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED') AND ((s.first_response_at IS NULL AND s.response_due_at < now()) OR (s.resolved_at IS NULL AND s.resolution_due_at < now()))) THEN 'BREACHED' " +
  "WHEN t.status IN ('COMPLETED','CANCELLED','STOPPED') THEN 'MET' " +
  "WHEN s.paused_at IS NOT NULL THEN 'CLOCK_PAUSED' " +
  "WHEN (s.first_response_at IS NULL AND s.response_due_at <= (now() + (s.response_warning_minutes * INTERVAL '1 minute'))) " +
  "OR (s.resolved_at IS NULL AND s.resolution_due_at <= (now() + (s.resolution_warning_minutes * INTERVAL '1 minute'))) THEN 'AT_RISK' ELSE 'ON_TRACK' END AS sla_state " +
  "FROM tasks t JOIN people p ON p.id=t.assignee_id LEFT JOIN task_sla s ON s.task_id=t.id LEFT JOIN sla_policies sp ON sp.id=s.policy_id WHERE 1=1";

async function taskList(ctx: Ctx, withFilters: boolean): Promise<Row[]> {
  const actor = who(ctx);
  let sql = TASK_LIST_SQL;
  const args: unknown[] = [];
  if (!isAdmin(actor)) {
    if (actor.personId === null) return [];
    sql += " AND t.assignee_id=?";
    args.push(actor.personId);
  }
  let slaFilter: string | null = null;
  if (withFilters) {
    const q = nonBlank(ctx.query.get("q"));
    if (q !== null) {
      const text = `%${q.trim()}%`;
      sql += " AND (t.task_no LIKE ? OR t.title LIKE ? OR p.name LIKE ?)";
      args.push(text, text, text);
    }
    const status = nonBlank(ctx.query.get("status"));
    if (status !== null) {
      sql += " AND t.status=?";
      args.push(status);
    }
    const type = nonBlank(ctx.query.get("type"));
    if (type !== null) {
      sql += " AND t.type=?";
      args.push(type);
    }
    const group = nonBlank(ctx.query.get("group"));
    if (group !== null) {
      sql += " AND p.group_name=?";
      args.push(group);
    }
    const tagRaw = ctx.query.get("tagId");
    if (tagRaw !== null && tagRaw.trim() !== "") {
      sql += " AND EXISTS(SELECT 1 FROM people_tag_links l WHERE l.person_id=p.id AND l.tag_id=?)";
      args.push(intOf(tagRaw));
    }
    const priority = nonBlank(ctx.query.get("priority"));
    if (priority !== null) {
      sql += " AND t.priority=?";
      args.push(priority);
    }
    const sla = nonBlank(ctx.query.get("sla"));
    if (sla !== null) {
      if (!SLA_FILTERS.has(sla)) throw new ApiError(400, "SLA 筛选值不合法");
      slaFilter = sla;
    }
  }
  if (slaFilter === null) {
    return list(`${sql} ORDER BY t.id DESC LIMIT 500`, ...args);
  }
  return list(`SELECT * FROM (${sql} ) sla_view WHERE sla_view.sla_state=? ORDER BY sla_view.id DESC LIMIT 500`, ...args, slaFilter);
}

export async function listBatches(ctx: Ctx): Promise<Row[]> {
  requireAdmin(who(ctx));
  return list(
    "SELECT b.*,c.title AS content_title,(SELECT COUNT(*) FROM tasks t WHERE t.batch_id=b.id) AS task_count FROM publish_batches b JOIN content_packages c ON b.content_id=c.id ORDER BY b.id DESC LIMIT 300",
  );
}

export async function createBatch(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = requireAdmin(who(ctx));
  const body = ctx.body;
  required(body.title, "批次名称", 200);
  const title = typeof body.title === "string" ? body.title : "";
  const contentId = intOrDefault(body.contentId, 0);
  const content = await one("SELECT id,review_status FROM content_packages WHERE id=?", contentId);
  ensure(str(content.review_status) === "APPROVED", "只有审核通过的内容包可以下发");
  const rawIds = body.assigneeIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 500) throw new ApiError(400, "单批次分派人员须为 1–500 人");
  const assigneeIds: number[] = [];
  for (const value of rawIds) {
    const personId = Number(value);
    if (!Number.isInteger(personId) || personId < 1) throw new ApiError(400, "单批次分派人员须为 1–500 人");
    assigneeIds.push(personId);
  }
  if (new Set(assigneeIds).size !== assigneeIds.length) throw new ApiError(400, "批次人员不能重复");
  const due = parseDeadline(body.deadline);
  const interval = body.reminderInterval === undefined || body.reminderInterval === null ? 60 : intOf(body.reminderInterval);
  const max = body.reminderMax === undefined || body.reminderMax === null ? 10 : intOf(body.reminderMax);
  if (interval < 5 || interval > 1440 || max < 1 || max > 10) throw new ApiError(400, "催办参数超出范围");
  for (const assignee of assigneeIds) {
    const person = await one("SELECT person_type,status FROM people WHERE id=?", assignee);
    ensure(
      str(person.status) === "ACTIVE" && (str(person.person_type) === "creator" || str(person.person_type) === "author"),
      "发布人必须为在用作者/素人",
    );
  }
  const batch = await insert(
    "INSERT INTO publish_batches(title,content_id,deadline_at,created_by) VALUES(?,?,?,?)",
    title,
    contentId,
    stamp(due),
    actor.id,
  );
  const priority = body.priority === undefined || body.priority === null ? "NORMAL" : String(body.priority);
  for (const assignee of assigneeIds) {
    const taskId = await newTask("PUBLISH", title, assignee, due, batch, null, null, null, { content_id: contentId }, interval, max, actor.id);
    if (priority !== "NORMAL") await reprioritizeSla(taskId, priority, actor);
  }
  await recordAudit(actor.id, "publish_batch", batch, "CREATE", { count: assigneeIds.length });
  return { id: batch, task_count: assigneeIds.length, title };
}

export async function listTasks(ctx: Ctx): Promise<Row[]> {
  return taskList(ctx, true);
}

export async function listMyTasks(ctx: Ctx): Promise<Row[]> {
  return taskList(ctx, false);
}

export async function createTicket(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = requireAdmin(who(ctx));
  const body = ctx.body;
  const title = required(body.title, "工单标题", 240);
  const description = required(body.description, "工单描述", 3000);
  const assigneeId = intOrDefault(body.assigneeId, 0);
  const assignee = await one("SELECT person_type,status FROM people WHERE id=?", assigneeId);
  ensure(
    str(assignee.status) === "ACTIVE" && (str(assignee.person_type) === "support" || str(assignee.person_type) === "assistant"),
    "普通服务工单须分配给在用客服或官方助理",
  );
  const source = body.sourceMessageId === undefined || body.sourceMessageId === null ? null : intOf(body.sourceMessageId);
  if (source !== null) {
    const message = await one("SELECT direction,delivery_status FROM wecom_messages WHERE id=? FOR UPDATE", source);
    ensure(str(message.direction) === "INBOUND" && str(message.delivery_status) !== "REDACTED", "只可关联未清理的真实入站应用消息");
  }
  const payload: Record<string, unknown> = { description };
  let snapshot: TemplateSnapshot | null = null;
  const hasTemplate = (body.templateKey !== undefined && body.templateKey !== null) || (body.templateVersion !== undefined && body.templateVersion !== null);
  if (body.fieldValues !== undefined && body.fieldValues !== null) {
    if (typeof body.fieldValues !== "object" || Array.isArray(body.fieldValues)) throw new ApiError(400, "回传字段须为对象");
  }
  const fieldValues = body.fieldValues;
  const hasFieldValues = fieldValues !== undefined && fieldValues !== null && Object.keys(fieldValues).length > 0;
  if (hasTemplate || hasFieldValues) {
    snapshot = await dispatchTemplate(body.templateKey, body.templateVersion, fieldValues);
    payload.template_snapshot = snapshot;
  }
  const id = await newTask(
    "SERVICE_TICKET",
    title,
    assigneeId,
    parseDeadline(body.deadline),
    null,
    null,
    null,
    null,
    payload,
    30,
    5,
    actor.id,
  );
  if (snapshot !== null) {
    for (const assetId of snapshotAssetIds(snapshot.values)) {
      await execute("INSERT INTO ticket_material_assets(task_id,attachment_id) VALUES(?,?)", id, assetId);
    }
  }
  if (source !== null) await execute("UPDATE tasks SET source_message_id=? WHERE id=?", source, id);
  const priority = body.priority === undefined || body.priority === null ? "NORMAL" : String(body.priority);
  if (priority !== "NORMAL") await reprioritizeSla(id, priority, actor);
  return getTaskById(id, actor);
}

export async function getTask(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = who(ctx);
  const id = parseId(ctx.params.id);
  return getTaskById(id, actor);
}

export async function submitTask(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = who(ctx);
  const taskId = parseId(ctx.params.id);
  const preview = await one("SELECT customer_id,type FROM tasks WHERE id=?", taskId);
  const isContact = CONTACT_TYPES.has(str(preview.type) ?? "");
  if (isContact) await one("SELECT * FROM customers WHERE id=? FOR UPDATE", preview.customer_id);
  const task = await one("SELECT * FROM tasks WHERE id=? FOR UPDATE", taskId);
  if (actor.personId === null || actor.personId !== num(task.assignee_id)) throw new ApiError(403, "任务只能由当前执行人员提交");
  ensure(maySubmit(str(task.status)), "该任务不能再次提交");
  await requireSlaRunning(taskId);
  if (ctx.body.payload !== undefined && ctx.body.payload !== null) {
    if (typeof ctx.body.payload !== "object" || Array.isArray(ctx.body.payload)) throw new ApiError(400, "参数有误");
  }
  const payload: Record<string, unknown> = { ...((ctx.body.payload as Record<string, unknown> | undefined) ?? {}) };
  const attachmentId = ctx.body.attachmentId === undefined || ctx.body.attachmentId === null ? null : intOf(ctx.body.attachmentId);
  const type = str(task.type) ?? "";
  if (!isContact && attachmentId !== null) throw new ApiError(400, "当前任务类型不需要截图附件");
  if (type === "PUBLISH") {
    const url = canonicalDouyin(payload.work_url);
    const hash = sha256(url);
    const current = await optional("SELECT id FROM works WHERE task_id=?", taskId);
    const another = await optional("SELECT id,task_id FROM works WHERE url_hash=?", hash);
    ensure(another === null || num(another.task_id) === taskId, "该作品链接已经被其他任务使用");
    if (current === null) {
      const workId = await insert(
        "INSERT INTO works(task_id,author_person_id,work_url,url_hash) VALUES(?,?,?,?)",
        taskId,
        task.assignee_id,
        url,
        hash,
      );
      await execute("UPDATE tasks SET work_id=? WHERE id=?", workId, taskId);
    } else {
      await execute("UPDATE works SET work_url=?,url_hash=?,verify_status='PENDING' WHERE task_id=?", url, hash, taskId);
    }
    payload.work_url = url;
  } else if (type === "OFFICIAL_COMMENT") {
    if (payload.confirmed !== true) throw new ApiError(400, "必须由执行人确认已发布官方评论");
    if (attachmentId !== null) throw new ApiError(400, "官方助理评论无需上传截图");
  } else if (isContact) {
    const customer = await one("SELECT * FROM customers WHERE id=?", task.customer_id);
    requireContactPermission(bool(customer.contact_allowed), bool(customer.do_not_contact), str(customer.consent_basis));
    if (attachmentId === null) throw new ApiError(400, "联系任务必须上传真实沟通截图");
    const attachment = await one("SELECT owner_user_id,purpose FROM attachments WHERE id=?", attachmentId);
    if (num(attachment.owner_user_id) !== actor.id || str(attachment.purpose) !== "PRIVATE_MESSAGE") {
      throw new ApiError(403, "截图不属于当前执行人或用途不匹配");
    }
    const reply = str(payload.reply_status);
    if (reply === null || !["REPLIED", "NO_REPLY", "UNKNOWN", "REFUSED"].includes(reply)) throw new ApiError(400, "联系结果无效");
    await execute(
      "INSERT INTO contact_attempts(round_id,task_id,person_id,reply_status,attachment_id) VALUES(?,?,?,?,?) ON CONFLICT (task_id) DO UPDATE SET reply_status=EXCLUDED.reply_status,attachment_id=EXCLUDED.attachment_id,created_at=now()",
      task.round_id,
      taskId,
      task.assignee_id,
      reply,
      attachmentId,
    );
    if (reply === "REPLIED" || reply === "REFUSED") await stopOtherContacts(taskId, num(task.customer_id), reply, actor.id);
  } else if (type === "SERVICE_TICKET") {
    required(payload.notes, "工单处理结果", 3000);
    const ticketPayload = object(task.payload_json);
    const stored = ticketPayload.template_snapshot;
    if (stored !== null && stored !== undefined && typeof stored === "object" && !Array.isArray(stored)) {
      const record = stored as Record<string, unknown>;
      const requested = payload.fieldValues;
      if (requested !== null && requested !== undefined && (typeof requested !== "object" || Array.isArray(requested))) {
        throw new ApiError(400, "回传字段须为对象");
      }
      payload.fieldValues = await responseValues(record.template, requested);
    } else {
      if (Object.prototype.hasOwnProperty.call(payload, "fieldValues")) throw new ApiError(400, "工单未配置自定义回传字段");
    }
  } else {
    throw new ApiError(400, "未知任务类型");
  }
  const revision = num(task.version);
  await insert(
    "INSERT INTO task_submissions(task_id,actor_user_id,revision,payload_json,attachment_id) VALUES(?,?,?,CAST(? AS jsonb),?)",
    taskId,
    actor.id,
    revision,
    json(payload),
    attachmentId,
  );
  await execute("UPDATE tasks SET status='SUBMITTED',next_remind_at=NULL,version=version+1 WHERE id=?", taskId);
  await markSlaResponded(taskId);
  await recordAudit(actor.id, "task", taskId, "SUBMIT", { revision });
  return getTaskById(taskId, actor);
}

function requireContactPermission(allowed: boolean, doNotContact: boolean, basis: string | null): void {
  if (!allowed || doNotContact || basis === null || basis.trim().length < 4) {
    throw new ApiError(400, "客户联系许可不足或已经拒绝联系");
  }
}

export async function reviewTask(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = requireAdmin(who(ctx));
  const id = parseId(ctx.params.id);
  const task = await one("SELECT * FROM tasks WHERE id=? FOR UPDATE", id);
  ensure(mayReview(str(task.status)), "仅已提交任务可审核");
  await requireSlaRunning(id);
  const decision = str(ctx.body.decision);
  if (decision !== "APPROVE" && decision !== "REJECT") throw new ApiError(400, "审核状态错误");
  const reason = typeof ctx.body.reason === "string" ? ctx.body.reason : null;
  if (decision === "REJECT" && (reason === null || reason.trim() === "")) throw new ApiError(400, "退回原因必填");
  const approved = decision === "APPROVE";
  await execute(
    "UPDATE tasks SET status=?,next_remind_at=?,version=version+1 WHERE id=?",
    approved ? "COMPLETED" : "REWORK",
    approved ? null : stamp(new Date(Date.now() + 60_000)),
    id,
  );
  await execute(
    "UPDATE task_submissions SET review_status=? WHERE task_id=? AND revision=(SELECT mx FROM (SELECT MAX(revision) mx FROM task_submissions WHERE task_id=?) d)",
    approved ? "APPROVED" : "REJECTED",
    id,
    id,
  );
  if (approved) await markSlaResolved(id);
  if (str(task.type) === "PUBLISH") await execute("UPDATE works SET verify_status=? WHERE task_id=?", approved ? "VERIFIED" : "REJECTED", id);
  await notifyTask(
    id,
    num(task.assignee_id),
    approved ? "REVIEW_APPROVED" : "REVIEW_REWORK",
    approved ? "任务审核已通过" : `任务被退回：${reason ?? ""}`,
    `TASK:${id}:REVIEW:${num(task.version)}`,
  );
  await recordAudit(actor.id, "task", id, approved ? "APPROVE" : "REJECT", { reason: reason ?? "" });
  return getTaskById(id, actor);
}

export async function cancelTask(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = requireAdmin(who(ctx));
  const id = parseId(ctx.params.id);
  const task = await one("SELECT * FROM tasks WHERE id=? FOR UPDATE", id);
  ensure(!TERMINAL.has(str(task.status) ?? ""), "终态任务不能取消");
  await execute("UPDATE tasks SET status='CANCELLED',next_remind_at=NULL,version=version+1 WHERE id=?", id);
  await recordAudit(actor.id, "task", id, "CANCEL", { previous_status: task.status });
  return getTaskById(id, actor);
}

export async function transferTask(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = requireAdmin(who(ctx));
  const id = parseId(ctx.params.id);
  const task = await one("SELECT * FROM tasks WHERE id=? FOR UPDATE", id);
  ensure(maySubmit(str(task.status)) || str(task.status) === "PAUSED", "仅未提交或暂停的任务可转派");
  const assigneeId = intOrDefault(ctx.body.assigneeId, 0);
  const person = await one("SELECT * FROM people WHERE id=?", assigneeId);
  ensure(str(person.status) === "ACTIVE", "人员不在用");
  const type = str(task.type) ?? "";
  const needed =
    type === "OFFICIAL_COMMENT" || type === "CONTACT_ASSISTANT"
      ? "assistant"
      : type === "CONTACT_AUTHOR"
        ? "author"
        : type === "FOLLOWUP" || type === "SERVICE_TICKET"
          ? "support"
          : "creator";
  if (type === "PUBLISH") {
    ensure(str(person.person_type) === "creator" || str(person.person_type) === "author", "发布任务只能转给作者或素人");
  } else if (type === "SERVICE_TICKET") {
    ensure(str(person.person_type) === "support" || str(person.person_type) === "assistant", "普通服务工单只能转派授权客服或官方助理");
  } else {
    ensure(needed === str(person.person_type), "接收人角色不符");
  }
  const reason = required(ctx.body.reason, "转派原因", 500);
  const due = ctx.body.deadline === undefined || ctx.body.deadline === null ? at(task.due_at) : parseDeadline(ctx.body.deadline);
  await execute(
    "UPDATE tasks SET assignee_id=?,due_at=?,next_remind_at=?,reminder_count=0,status=CASE WHEN status='PAUSED' THEN 'PENDING' ELSE status END,version=version+1 WHERE id=?",
    assigneeId,
    stamp(due),
    stamp(new Date(Date.now() + 60_000)),
    id,
  );
  await notifyTask(id, assigneeId, "TASK_TRANSFERRED", "任务转派给您", `TASK:${id}:TRANSFER:${num(task.version)}`);
  await recordAudit(actor.id, "task", id, "TRANSFER", { from: task.assignee_id, to: assigneeId, reason });
  return getTaskById(id, actor);
}

export async function listTicketTemplates(ctx: Ctx): Promise<TicketTemplate[]> {
  requireAdmin(who(ctx));
  const rows = await list(
    "SELECT t.schema_json FROM ticket_templates t WHERE t.version=(SELECT MAX(n.version) FROM ticket_templates n WHERE n.template_key=t.template_key) ORDER BY t.template_key",
  );
  return rows.map((row) => buildTemplateFromStored(row.schema_json));
}

export async function publishTicketTemplate(ctx: Ctx): Promise<TicketTemplate> {
  const actor = requireAdmin(who(ctx));
  const body = ctx.body;
  const expected = body.expectedVersion;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0 || expected === 2147483647) {
    throw new ApiError(400, "须提供合法的上一版本号");
  }
  const next = buildTemplate(body.key, expected + 1, body.title, body.fields);
  const previous = await optional("SELECT MAX(version) latest FROM ticket_templates WHERE template_key=?", next.key);
  const current = previous === null || previous.latest === null || previous.latest === undefined ? 0 : num(previous.latest);
  ensure(current === expected, "模板版本已变化，请重新加载");
  try {
    await insert(
      "INSERT INTO ticket_templates(template_key,version,schema_json,published_by) VALUES(?,?,CAST(? AS jsonb),?)",
      next.key,
      next.version,
      json(next),
      actor.id,
    );
  } catch (error) {
    if (error instanceof DbConflictError) throw new ApiError(409, "模板版本已变化，请重新加载");
    throw error;
  }
  return next;
}
