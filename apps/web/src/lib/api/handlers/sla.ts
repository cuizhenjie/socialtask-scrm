import {
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
import { ApiError } from "../errors";
import { requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";

/**
 * 移植自 services/api 的 com.socialtask.sla：
 * - SlaClock：纯日历运算（7×24 / 营业时间 / 例外日 / 调休）
 * - SlaService：策略校验、挂接、改优先级、暂停/恢复、违约与升级
 * SQL 全部保留 `?` 占位符。
 */

/* ------------------------------------------------------------------ */
/* SlaClock                                                            */
/* ------------------------------------------------------------------ */

const MAX_MILLIS = 525_600 * 60_000;
const MAX_DAYS = 6000;

type LocalDate = { year: number; month: number; day: number };
type TimeOfDay = { hour: number; minute: number; second: number; millisecond: number };

type BusinessSpec = {
  mode: "BUSINESS_HOURS";
  zone: string;
  opens: TimeOfDay;
  closes: TimeOfDay;
  weekdays: Set<number>;
  closed: Set<string>;
  extraWorking: Set<string>;
};

type CalendarSpec = { mode: "24X7" } | BusinessSpec;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatDate(date: LocalDate): string {
  return `${String(date.year).padStart(4, "0")}-${pad2(date.month)}-${pad2(date.day)}`;
}

function partsOf(date: Date, zone: string): { date: LocalDate; hour: number; minute: number; second: number } {
  const values: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    date: { year: values.year, month: values.month, day: values.day },
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zoneOffsetMs(date: Date, zone: string): number {
  const parts = partsOf(date, zone);
  const utc = Date.UTC(parts.date.year, parts.date.month - 1, parts.date.day, parts.hour, parts.minute, parts.second);
  return utc - Math.floor(date.getTime() / 1000) * 1000;
}

/** 等价于 LocalDate.atTime(opens).atZone(zone).toInstant()。 */
function localToInstant(date: LocalDate, time: TimeOfDay, zone: string): Date {
  const utc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second, time.millisecond);
  const first = utc - zoneOffsetMs(new Date(utc), zone);
  return new Date(utc - zoneOffsetMs(new Date(first), zone));
}

/** 等价于 LocalDate.atStartOfDay(zone).toInstant()。 */
function startOfDay(date: LocalDate, zone: string): Date {
  return localToInstant(date, { hour: 0, minute: 0, second: 0, millisecond: 0 }, zone);
}

function addDays(date: LocalDate, days: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/** 等价于 DayOfWeek.getValue()：周一=1 … 周日=7。 */
function weekdayValue(date: LocalDate): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return ((day + 6) % 7) + 1;
}

function isBusinessDay(spec: BusinessSpec, date: LocalDate): boolean {
  const key = formatDate(date);
  if (spec.closed.has(key)) return false;
  return spec.extraWorking.has(key) || spec.weekdays.has(weekdayValue(date));
}

function addMillis(spec: CalendarSpec, start: Date, millis: number): Date {
  if (!Number.isFinite(millis) || millis < 0 || millis > MAX_MILLIS) throw new Error("SLA 时长超出范围");
  if (millis === 0) return start;
  if (spec.mode === "24X7") return new Date(start.getTime() + millis);
  let cursor = start;
  let remaining = millis;
  for (let day = 0; day < MAX_DAYS; day++) {
    const date = partsOf(cursor, spec.zone).date;
    if (isBusinessDay(spec, date)) {
      const from = localToInstant(date, spec.opens, spec.zone);
      const to = localToInstant(date, spec.closes, spec.zone);
      const beginAt = cursor.getTime() > from.getTime() ? cursor : from;
      if (beginAt.getTime() < to.getTime()) {
        const available = to.getTime() - beginAt.getTime();
        if (remaining <= available) return new Date(beginAt.getTime() + remaining);
        remaining -= available;
      }
    }
    cursor = startOfDay(addDays(date, 1), spec.zone);
  }
  throw new Error("SLA 配置的日历无法在可计算范围内完成目标");
}

function workingMillis(spec: CalendarSpec, start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) throw new Error("SLA 时间区间无效");
  if (spec.mode === "24X7") return end.getTime() - start.getTime();
  let date = partsOf(start, spec.zone).date;
  let sum = 0;
  for (let day = 0; day < MAX_DAYS; day++) {
    const dayStart = startOfDay(date, spec.zone);
    if (!(dayStart.getTime() < end.getTime())) return sum;
    if (!isBusinessDay(spec, date)) {
      date = addDays(date, 1);
      continue;
    }
    let from = localToInstant(date, spec.opens, spec.zone);
    let to = localToInstant(date, spec.closes, spec.zone);
    if (from.getTime() < start.getTime()) from = start;
    if (to.getTime() > end.getTime()) to = end;
    if (from.getTime() < to.getTime()) sum += to.getTime() - from.getTime();
    date = addDays(date, 1);
  }
  throw new Error("SLA 时间区间超出可计算范围");
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?$/;

function parseTime(raw: string | null): TimeOfDay {
  const match = raw === null ? null : TIME_RE.exec(raw);
  if (!match) throw new Error("营业时间格式无效");
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: match[3] === undefined ? 0 : Number(match[3]),
    millisecond: 0,
  };
}

function timeValue(time: TimeOfDay): number {
  return time.hour * 3600 + time.minute * 60 + time.second;
}

function validZone(zone: string | null): string {
  if (!zone) throw new Error("SLA 日历类型无效");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    throw new Error(`未知时区：${zone}`);
  }
}

function parseDays(weekdays: string | null): Set<number> {
  if (!weekdays || !/^[1-7](,[1-7]){0,6}$/.test(weekdays)) throw new Error("工作日填写 1-7，使用逗号分隔");
  const set = new Set<number>();
  for (const text of weekdays.split(",")) {
    const value = Number(text);
    if (set.has(value)) throw new Error("工作日重复");
    set.add(value);
  }
  return set;
}

function isValidDate(part: string): boolean {
  const [year, month, day] = part.split("-").map((value) => Number(value));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDates(raw: string | null): Set<string> {
  const collected = new Set<string>();
  if (raw === null || raw.trim() === "") return collected;
  if (raw.length > 12000) throw new Error("例外日过多");
  for (const part of raw.trim().split(/[,\s，]+/)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(part) || !isValidDate(part)) throw new Error("例外日期须为 YYYY-MM-DD");
    if (collected.has(part) || collected.size >= 730) throw new Error("例外日期重复或超过 730 天");
    collected.add(part);
  }
  return new Set([...collected].sort());
}

function escalationSteps(raw: string | null): number[] {
  if (raw === null || raw.trim() === "") return [];
  if (raw.length > 80) throw new Error("升级规则过长");
  const result: number[] = [];
  let last = 0;
  for (const part of raw.trim().split(/[,\s，]+/)) {
    if (!/^\d{1,5}$/.test(part)) throw new Error("升级时长须为整数分钟");
    const value = Number(part);
    if (value <= last || value > 43200 || result.length >= 5) throw new Error("最多五级升级，分钟数严格递增且不超过 43200");
    result.push(value);
    last = value;
  }
  return result;
}

function calendar(
  mode: string | null,
  timezone: string | null,
  begin: string | null,
  end: string | null,
  workingDays: string | null,
  closedDates: string | null,
  openDates: string | null,
): CalendarSpec {
  const closed = parseDates(closedDates);
  const opened = parseDates(openDates);
  for (const date of closed) {
    if (opened.has(date)) throw new Error("同一天不可同时设置休息与调休工作");
  }
  if (mode === "24X7") {
    if (closed.size > 0 || opened.size > 0) throw new Error("7×24 模式不能设置工作日例外");
    return { mode: "24X7" };
  }
  if (mode !== "BUSINESS_HOURS") throw new Error("SLA 日历类型无效");
  const zone = validZone(timezone);
  const opens = parseTime(begin);
  const closes = parseTime(end);
  if (!(timeValue(closes) > timeValue(opens))) throw new Error("营业结束时间应晚于开始时间");
  return { mode: "BUSINESS_HOURS", zone, opens, closes, weekdays: parseDays(workingDays), closed, extraWorking: opened };
}

function calendarDeadline(
  start: Date,
  minutes: number,
  mode: string,
  timezone: string,
  begin: string,
  end: string,
  workingDays: string,
  closedDates: string,
  openDates: string,
): Date {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600) throw new Error("SLA 目标分钟须在 1 至 525600 之间");
  return addMillis(calendar(mode, timezone, begin, end, workingDays, closedDates, openDates), start, minutes * 60_000);
}

/* ------------------------------------------------------------------ */
/* SlaService                                                          */
/* ------------------------------------------------------------------ */

const TASK_TYPES = new Set([
  "ALL",
  "PUBLISH",
  "OFFICIAL_COMMENT",
  "CONTACT_AUTHOR",
  "CONTACT_ASSISTANT",
  "FOLLOWUP",
  "SERVICE_TICKET",
]);
const PRIORITIES = new Set(["NORMAL", "HIGH", "URGENT"]);
const ACTIVE_STATUSES = new Set(["PENDING", "REWORK", "SUBMITTED", "PAUSED"]);
const CALENDAR_KEYS = ["calendar_mode", "timezone", "business_start", "business_end", "working_days", "closed_dates", "open_dates"];
const UNITS = ["response", "resolution"] as const;

type Unit = (typeof UNITS)[number];

type PolicyValues = {
  name: string;
  task_type: string;
  priority: string;
  response_minutes: number;
  resolution_minutes: number;
  response_warning_minutes: number;
  resolution_warning_minutes: number;
  calendar_mode: string;
  timezone: string;
  business_start: string;
  business_end: string;
  working_days: string;
  closed_dates: string;
  open_dates: string;
  escalation_minutes: string;
  enabled: boolean;
};

function textOrEmpty(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function who(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) throw new ApiError(400, "参数有误");
  return id;
}

function optString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ApiError(400, "参数有误");
  return value;
}

function optInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ApiError(400, "参数有误");
  return value;
}

function optBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ApiError(400, "参数有误");
  return value;
}

function at(value: unknown): Date {
  const date = instant(value);
  if (!date) throw new Error("SLA 时间字段缺失");
  return date;
}

function calendarOf(policy: Row): CalendarSpec {
  return calendar(
    str(policy.calendar_mode),
    str(policy.timezone),
    str(policy.business_start),
    str(policy.business_end),
    str(policy.working_days),
    textOrEmpty(policy.closed_dates),
    textOrEmpty(policy.open_dates),
  );
}

function calendarSnapshot(policy: Row): string {
  const copy: Record<string, string> = {};
  for (const key of CALENDAR_KEYS) copy[key] = textOrEmpty(policy[key]);
  return json(copy);
}

function dueAt(start: Date, policy: Row, unit: Unit): Date {
  return addMillis(calendarOf(policy), start, num(policy[`${unit}_minutes`]) * 60_000);
}

function validatePolicy(body: Record<string, unknown>): PolicyValues {
  const type = optString(body.taskType) ?? "ALL";
  const priority = optString(body.priority) ?? "NORMAL";
  if (!TASK_TYPES.has(type) || !PRIORITIES.has(priority)) throw new ApiError(400, "SLA 工单类型或优先级不合法");
  const response = optInteger(body.responseMinutes) ?? 120;
  const resolution = optInteger(body.resolutionMinutes) ?? 1440;
  if (response < 1 || resolution < 1 || response > 525600 || resolution > 525600 || response > resolution) {
    throw new ApiError(400, "首次响应须小于等于解决时限，范围 1 至 525600 分钟");
  }
  const mode = optString(body.calendarMode) ?? "24X7";
  const zone = optString(body.timezone) ?? "Asia/Shanghai";
  const start = optString(body.businessStart) ?? "09:00";
  const end = optString(body.businessEnd) ?? "18:00";
  const days = optString(body.workingDays) ?? "1,2,3,4,5";
  let closed = optString(body.closedDates) ?? "";
  let opened = optString(body.openDates) ?? "";
  let escalations = optString(body.escalationMinutes) ?? "";
  try {
    calendarDeadline(new Date(), response, mode, zone, start, end, days, closed, opened);
    closed = [...parseDates(closed)].join(",");
    opened = [...parseDates(opened)].join(",");
    escalations = escalationSteps(escalations).join(",");
  } catch (error) {
    throw new ApiError(400, `SLA 日历或升级配置错误：${(error as Error).message}`);
  }
  const responseWarning = optInteger(body.responseWarningMinutes) ?? Math.min(response, 30);
  const resolutionWarning = optInteger(body.resolutionWarningMinutes) ?? Math.min(resolution, 60);
  if (responseWarning < 0 || resolutionWarning < 0 || responseWarning > response || resolutionWarning > resolution) {
    throw new ApiError(400, "SLA 预警分钟数必须在 0 至目标时长之间");
  }
  return {
    name: required(body.name, "策略名称", 120),
    task_type: type,
    priority,
    response_minutes: response,
    resolution_minutes: resolution,
    response_warning_minutes: responseWarning,
    resolution_warning_minutes: resolutionWarning,
    calendar_mode: mode,
    timezone: zone,
    business_start: start,
    business_end: end,
    working_days: days,
    closed_dates: closed,
    open_dates: opened,
    escalation_minutes: escalations,
    enabled: optBoolean(body.enabled) ?? true,
  };
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

async function findPolicy(type: string, priority: string): Promise<Row> {
  const policy = await optional(
    "SELECT * FROM sla_policies WHERE enabled=TRUE AND priority=? AND task_type IN (?, 'ALL') ORDER BY CASE WHEN task_type=? THEN 0 ELSE 1 END LIMIT 1",
    priority,
    type,
    type,
  );
  if (!policy) throw new ApiError(409, `没有匹配的 SLA 策略（类型=${type}，优先级=${priority}）`);
  return policy;
}

async function remainingBudget(
  row: Row,
  unit: Unit,
  finished: string,
  now: Date,
  spec: CalendarSpec,
): Promise<number | null> {
  if (row[finished] !== null && row[finished] !== undefined) return null;
  const due = at(row[`${unit}_due_at`]);
  if (!(due.getTime() > now.getTime())) throw new ApiError(409, "已到期的 SLA 不允许暂停");
  const budget = workingMillis(spec, now, due);
  if (!(budget > 0)) throw new ApiError(409, "SLA 无可暂停的剩余工作时间");
  return budget;
}

/** TaskService 建单时挂接 SLA；缺少策略时抛 409。 */
export async function attachSla(taskId: number, type: string, priority: string, startedAt: Date): Promise<void> {
  const policy = await findPolicy(type, priority);
  await execute(
    "INSERT INTO task_sla(task_id,policy_id,response_due_at,resolution_due_at,calendar_snapshot,response_warning_minutes,resolution_warning_minutes,escalation_minutes) VALUES(?,?,?,?,CAST(? AS jsonb),?,?,?)",
    taskId,
    num(policy.id),
    stamp(dueAt(startedAt, policy, "response")),
    stamp(dueAt(startedAt, policy, "resolution")),
    calendarSnapshot(policy),
    policy.response_warning_minutes,
    policy.resolution_warning_minutes,
    policy.escalation_minutes,
  );
}

/** 改优先级并重建 SLA 快照（仅 PENDING 且未响应、未暂停、未违约）。 */
export async function reprioritizeSla(taskId: number, priority: string, actor: RequestUser): Promise<Row> {
  requireAdmin(actor);
  if (!PRIORITIES.has(priority)) throw new ApiError(400, "优先级不合法");
  const task = await one("SELECT id,type,status,created_at,priority FROM tasks WHERE id=? FOR UPDATE", taskId);
  if (str(task.status) !== "PENDING") throw new ApiError(409, "仅尚未提交的待处理工单允许改变优先级及 SLA 快照");
  const snapshot = await one("SELECT * FROM task_sla WHERE task_id=? FOR UPDATE", taskId);
  const responseDue = at(snapshot.response_due_at);
  const resolutionDue = at(snapshot.resolution_due_at);
  if (
    !(
      (snapshot.first_response_at === null || snapshot.first_response_at === undefined) &&
      (snapshot.response_breached_at === null || snapshot.response_breached_at === undefined) &&
      (snapshot.resolution_breached_at === null || snapshot.resolution_breached_at === undefined) &&
      num(snapshot.pause_count) === 0 &&
      responseDue.getTime() > Date.now() &&
      resolutionDue.getTime() > Date.now()
    )
  ) {
    throw new ApiError(409, "已有响应、暂停或违约不可重置 SLA，须通过审计建立新工单");
  }
  const policy = await findPolicy(str(task.type) ?? "", priority);
  const created = at(task.created_at);
  await execute(
    "UPDATE task_sla SET policy_id=?,response_due_at=?,resolution_due_at=?,calendar_snapshot=CAST(? AS jsonb),response_warning_minutes=?,resolution_warning_minutes=?,escalation_minutes=?,response_breached_at=NULL,resolution_breached_at=NULL,response_warned_at=NULL,resolution_warned_at=NULL WHERE task_id=?",
    num(policy.id),
    stamp(dueAt(created, policy, "response")),
    stamp(dueAt(created, policy, "resolution")),
    calendarSnapshot(policy),
    policy.response_warning_minutes,
    policy.resolution_warning_minutes,
    policy.escalation_minutes,
    taskId,
  );
  await execute("UPDATE tasks SET priority=? WHERE id=?", priority, taskId);
  await recordAudit(actor.id, "task", taskId, "PRIORITY_CHANGE", { from: task.priority, to: priority });
  return one("SELECT * FROM task_sla WHERE task_id=?", taskId);
}

/** 提交或审核前校验 SLA 未暂停。 */
export async function requireSlaRunning(taskId: number): Promise<void> {
  const row = await optional("SELECT paused_at FROM task_sla WHERE task_id=? FOR UPDATE", taskId);
  if (!(row === null || row.paused_at === null || row.paused_at === undefined)) {
    throw new ApiError(409, "SLA 已暂停，请管理员恢复后再提交或审核");
  }
}

/** 首次提交（即使后续被退回）即视为首次响应。 */
export async function markSlaResponded(taskId: number): Promise<void> {
  await execute(
    "UPDATE task_sla SET response_breached_at=CASE WHEN first_response_at IS NULL AND now()>response_due_at THEN COALESCE(response_breached_at,now()) ELSE response_breached_at END,first_response_at=COALESCE(first_response_at,now()),next_response_escalation_at=NULL WHERE task_id=?",
    taskId,
  );
}

/** 审核通过即视为解决。 */
export async function markSlaResolved(taskId: number): Promise<void> {
  await execute(
    "UPDATE task_sla SET resolved_at=COALESCE(resolved_at,now()),resolution_breached_at=CASE WHEN resolution_breached_at IS NULL AND now()>resolution_due_at THEN now() ELSE resolution_breached_at END,next_resolution_escalation_at=NULL WHERE task_id=?",
    taskId,
  );
}

function nextEscalation(row: Row, unit: Unit, level: number): string | null {
  const steps = escalationSteps(str(row.escalation_minutes));
  if (level >= steps.length) return null;
  const due = at(row[`${unit}_due_at`]);
  return stamp(new Date(due.getTime() + steps[level] * 60_000));
}

async function workbenchNotification(key: string, taskId: number, eventType: string, details: string): Promise<void> {
  await execute(
    "INSERT INTO notifications(event_key,task_id,person_id,event_type,state,details) VALUES(?, ?,NULL,?, 'WORKBENCH',?) ON CONFLICT (event_key) DO NOTHING",
    key,
    taskId,
    eventType,
    details,
  );
}

async function escalate(): Promise<number> {
  let count = 0;
  const now = new Date();
  const rows = await list(
    "SELECT s.* FROM task_sla s JOIN tasks t ON t.id=s.task_id WHERE s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED','COMPLETED') AND ((s.first_response_at IS NULL AND s.next_response_escalation_at<=now()) OR (s.resolved_at IS NULL AND s.next_resolution_escalation_at<=now())) ORDER BY s.task_id LIMIT 200 FOR UPDATE SKIP LOCKED",
  );
  for (const row of rows) {
    const taskId = num(row.task_id);
    for (const unit of UNITS) {
      const finished = unit === "response" ? "first_response_at" : "resolved_at";
      const next = `next_${unit}_escalation_at`;
      const levelKey = `${unit}_escalation_level`;
      const nextAt = instant(row[next]);
      if ((row[finished] !== null && row[finished] !== undefined) || nextAt === null || nextAt.getTime() > now.getTime()) continue;
      const level = num(row[levelKey]) + 1;
      await execute(`UPDATE task_sla SET ${levelKey}=?,${next}=? WHERE task_id=?`, level, nextEscalation(row, unit, level), taskId);
      const stage = unit.toUpperCase();
      await workbenchNotification(
        `TASK:${taskId}:SLA:${stage}:LEVEL:${level}`,
        taskId,
        `SLA_${stage}_ESCALATION`,
        `${unit === "response" ? "首次响应" : "解决"} SLA 第 ${level} 级升级，请管理人员人工处理`,
      );
      count++;
    }
  }
  return count;
}

/**
 * 对应 SlaService.tick()：Java 由 @Scheduled 每 60 秒调用；Next 侧暴露为可被外部定时任务调用的函数，
 * 未注册 HTTP 路由（Java 也没有对应接口）。
 */
export async function runSlaTick(): Promise<{ response_breaches: number; resolution_breaches: number; warnings: number; escalations: number }> {
  let response = 0;
  let resolution = 0;
  let warnings = 0;
  const rows = await list(
    "SELECT s.*,t.status,t.assignee_id FROM task_sla s JOIN tasks t ON t.id=s.task_id WHERE s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED','COMPLETED') AND (" +
      "(s.first_response_at IS NULL AND (s.response_breached_at IS NULL AND s.response_due_at<now() OR s.response_warned_at IS NULL AND s.response_warning_minutes>0 AND s.response_due_at BETWEEN now() AND (now() + (s.response_warning_minutes * INTERVAL '1 minute')))) OR " +
      "(s.resolved_at IS NULL AND (s.resolution_breached_at IS NULL AND s.resolution_due_at<now() OR s.resolution_warned_at IS NULL AND s.resolution_warning_minutes>0 AND s.resolution_due_at BETWEEN now() AND (now() + (s.resolution_warning_minutes * INTERVAL '1 minute'))))) " +
      "ORDER BY s.task_id LIMIT 200 FOR UPDATE SKIP LOCKED",
  );
  for (const row of rows) {
    const taskId = num(row.task_id);
    const now = new Date();
    const responseDue = instant(row.response_due_at);
    const resolutionDue = instant(row.resolution_due_at);
    const responseWarning = num(row.response_warning_minutes);
    const resolutionWarning = num(row.resolution_warning_minutes);
    if (
      (row.first_response_at === null || row.first_response_at === undefined) &&
      (row.response_warned_at === null || row.response_warned_at === undefined) &&
      responseWarning > 0 &&
      responseDue !== null &&
      responseDue.getTime() > now.getTime() &&
      responseDue.getTime() <= now.getTime() + responseWarning * 60_000
    ) {
      await execute("UPDATE task_sla SET response_warned_at=now() WHERE task_id=?", taskId);
      await workbenchNotification(`TASK:${taskId}:SLA:RESPONSE:WARN`, taskId, "SLA_RESPONSE_WARNING", "首次响应 SLA 即将到期，请关注执行进度");
      warnings++;
    }
    if (
      (row.resolved_at === null || row.resolved_at === undefined) &&
      (row.resolution_warned_at === null || row.resolution_warned_at === undefined) &&
      resolutionWarning > 0 &&
      resolutionDue !== null &&
      resolutionDue.getTime() > now.getTime() &&
      resolutionDue.getTime() <= now.getTime() + resolutionWarning * 60_000
    ) {
      await execute("UPDATE task_sla SET resolution_warned_at=now() WHERE task_id=?", taskId);
      await workbenchNotification(`TASK:${taskId}:SLA:RESOLUTION:WARN`, taskId, "SLA_RESOLUTION_WARNING", "解决 SLA 即将到期，请关注处理进度");
      warnings++;
    }
    if (
      (row.first_response_at === null || row.first_response_at === undefined) &&
      (row.response_breached_at === null || row.response_breached_at === undefined) &&
      responseDue !== null &&
      responseDue.getTime() < Date.now()
    ) {
      await execute("UPDATE task_sla SET response_breached_at=now(),next_response_escalation_at=? WHERE task_id=?", nextEscalation(row, "response", 0), taskId);
      await workbenchNotification(`TASK:${taskId}:SLA:RESPONSE`, taskId, "SLA_RESPONSE_BREACH", "工单首次响应超过 SLA，请检查处理人及任务状态");
      response++;
    }
    if (
      (row.resolved_at === null || row.resolved_at === undefined) &&
      (row.resolution_breached_at === null || row.resolution_breached_at === undefined) &&
      resolutionDue !== null &&
      resolutionDue.getTime() < Date.now()
    ) {
      await execute("UPDATE task_sla SET resolution_breached_at=now(),next_resolution_escalation_at=? WHERE task_id=?", nextEscalation(row, "resolution", 0), taskId);
      await workbenchNotification(`TASK:${taskId}:SLA:RESOLUTION`, taskId, "SLA_RESOLUTION_BREACH", "工单解决时间超过 SLA，请管理员升级或转派");
      resolution++;
    }
  }
  const escalations = await escalate();
  return {
    response_breaches: response,
    resolution_breaches: resolution,
    warnings,
    escalations,
  };
}

/* ------------------------------------------------------------------ */
/* HTTP handlers                                                       */
/* ------------------------------------------------------------------ */

export async function listPolicies(ctx: Ctx): Promise<Row[]> {
  requireAdmin(who(ctx));
  return list("SELECT * FROM sla_policies ORDER BY task_type,priority,id");
}

export async function createPolicy(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(who(ctx));
  const values = validatePolicy(ctx.body);
  const id = await insert(
    "INSERT INTO sla_policies(name,task_type,priority,response_minutes,resolution_minutes,calendar_mode,timezone,business_start,business_end,working_days,enabled,response_warning_minutes,resolution_warning_minutes,closed_dates,open_dates,escalation_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    values.name,
    values.task_type,
    values.priority,
    values.response_minutes,
    values.resolution_minutes,
    values.calendar_mode,
    values.timezone,
    values.business_start,
    values.business_end,
    values.working_days,
    values.enabled,
    values.response_warning_minutes,
    values.resolution_warning_minutes,
    values.closed_dates,
    values.open_dates,
    values.escalation_minutes,
  );
  await recordAudit(actor.id, "sla_policy", id, "CREATE", values);
  return one("SELECT * FROM sla_policies WHERE id=?", id);
}

export async function updatePolicy(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(who(ctx));
  const id = parseId(ctx.params.id);
  await one("SELECT id FROM sla_policies WHERE id=? FOR UPDATE", id);
  const values = validatePolicy(ctx.body);
  await execute(
    "UPDATE sla_policies SET name=?,task_type=?,priority=?,response_minutes=?,resolution_minutes=?,calendar_mode=?,timezone=?,business_start=?,business_end=?,working_days=?,enabled=?,response_warning_minutes=?,resolution_warning_minutes=?,closed_dates=?,open_dates=?,escalation_minutes=? WHERE id=?",
    values.name,
    values.task_type,
    values.priority,
    values.response_minutes,
    values.resolution_minutes,
    values.calendar_mode,
    values.timezone,
    values.business_start,
    values.business_end,
    values.working_days,
    values.enabled,
    values.response_warning_minutes,
    values.resolution_warning_minutes,
    values.closed_dates,
    values.open_dates,
    values.escalation_minutes,
    id,
  );
  await recordAudit(actor.id, "sla_policy", id, "UPDATE", values);
  return one("SELECT * FROM sla_policies WHERE id=?", id);
}

export async function slaView(ctx: Ctx): Promise<Row> {
  requireAdmin(who(ctx));
  const id = parseId(ctx.params.id);
  return one(
    "SELECT s.*,p.name AS policy_name,COALESCE(s.calendar_snapshot->>'calendar_mode',p.calendar_mode) AS calendar_mode,COALESCE(s.calendar_snapshot->>'timezone',p.timezone) AS timezone FROM task_sla s JOIN sla_policies p ON p.id=s.policy_id WHERE s.task_id=?",
    id,
  );
}

export async function pauseSla(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(who(ctx));
  const taskId = parseId(ctx.params.id);
  const why = required(ctx.body.reason, "暂停原因", 300);
  const task = await one("SELECT id,status FROM tasks WHERE id=? FOR UPDATE", taskId);
  if (!ACTIVE_STATUSES.has(str(task.status) ?? "")) throw new ApiError(409, "只有进行中的工单可以暂停 SLA");
  const row = await one("SELECT * FROM task_sla WHERE task_id=? FOR UPDATE", taskId);
  if (!((row.paused_at === null || row.paused_at === undefined) && (row.resolved_at === null || row.resolved_at === undefined))) {
    throw new ApiError(409, "SLA 已暂停或已解决");
  }
  if (!((row.response_breached_at === null || row.response_breached_at === undefined) && (row.resolution_breached_at === null || row.resolution_breached_at === undefined))) {
    throw new ApiError(409, "已有违约记录的工单不得暂停以隐藏违约");
  }
  const now = new Date();
  const spec = calendarOf(object(row.calendar_snapshot));
  const response = await remainingBudget(row, "response", "first_response_at", now, spec);
  const resolution = await remainingBudget(row, "resolution", "resolved_at", now, spec);
  await execute(
    "UPDATE task_sla SET paused_at=?,pause_reason=?,response_remaining_ms=?,resolution_remaining_ms=?,pause_count=pause_count+1 WHERE task_id=?",
    stamp(now),
    why,
    response,
    resolution,
    taskId,
  );
  await recordAudit(actor.id, "task", taskId, "SLA_PAUSE", { reason: why });
  return one("SELECT * FROM task_sla WHERE task_id=?", taskId);
}

export async function resumeSla(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(who(ctx));
  const taskId = parseId(ctx.params.id);
  const task = await one("SELECT id,status FROM tasks WHERE id=? FOR UPDATE", taskId);
  if (!ACTIVE_STATUSES.has(str(task.status) ?? "")) throw new ApiError(409, "只有进行中的工单可以恢复 SLA");
  const row = await one("SELECT * FROM task_sla WHERE task_id=? FOR UPDATE", taskId);
  if (row.paused_at === null || row.paused_at === undefined) throw new ApiError(409, "SLA 当前未暂停");
  const spec = calendarOf(object(row.calendar_snapshot));
  const now = new Date();
  const response =
    row.response_remaining_ms === null || row.response_remaining_ms === undefined
      ? at(row.response_due_at)
      : addMillis(spec, now, num(row.response_remaining_ms));
  const resolution =
    row.resolution_remaining_ms === null || row.resolution_remaining_ms === undefined
      ? at(row.resolution_due_at)
      : addMillis(spec, now, num(row.resolution_remaining_ms));
  const elapsed = Math.max(0, now.getTime() - at(row.paused_at).getTime());
  await execute(
    "UPDATE task_sla SET response_due_at=?,resolution_due_at=?,paused_at=NULL,pause_reason=NULL,response_remaining_ms=NULL,resolution_remaining_ms=NULL,paused_total_ms=paused_total_ms+? WHERE task_id=?",
    stamp(response),
    stamp(resolution),
    elapsed,
    taskId,
  );
  await recordAudit(actor.id, "task", taskId, "SLA_RESUME", { paused_wall_ms: elapsed });
  return one("SELECT * FROM task_sla WHERE task_id=?", taskId);
}

export async function changePriority(ctx: Ctx): Promise<Row> {
  const actor = requireAdmin(who(ctx));
  const taskId = parseId(ctx.params.id);
  if (typeof ctx.body.priority !== "string") throw new ApiError(400, "优先级不合法");
  return reprioritizeSla(taskId, ctx.body.priority, actor);
}
