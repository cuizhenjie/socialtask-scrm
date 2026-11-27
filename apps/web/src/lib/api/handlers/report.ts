import { list, one, type Row } from "../db";
import { ApiError } from "../errors";
import { requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function validateDate(value: string, message: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, message);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, message);
  }
  return value;
}

function optionalLong(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "参数有误");
  return parsed;
}

export async function ticketReport(ctx: Ctx): Promise<Row> {
  requireAdmin(caller(ctx));
  const from = ctx.query.get("from");
  const to = ctx.query.get("to");
  const group = ctx.query.get("group");
  const tagId = optionalLong(ctx.query.get("tagId"));
  const type = ctx.query.get("type");
  const status = ctx.query.get("status");
  const priority = ctx.query.get("priority");
  let where = " WHERE 1=1";
  const args: unknown[] = [];
  let fromDate: string | null = null;
  let toDate: string | null = null;
  if (from !== null && from.trim() !== "") {
    fromDate = validateDate(from.trim(), "开始日期格式应为 YYYY-MM-DD");
    where += " AND t.created_at>=CAST(? AS timestamptz)";
    args.push(`${fromDate} 00:00:00`);
  }
  if (to !== null && to.trim() !== "") {
    toDate = validateDate(to.trim(), "结束日期格式应为 YYYY-MM-DD");
    where += " AND t.created_at<(CAST(? AS timestamptz) + INTERVAL '1 day')";
    args.push(`${toDate} 00:00:00`);
  }
  if (fromDate !== null && toDate !== null && fromDate > toDate) {
    throw new ApiError(400, "开始日期不能晚于结束日期");
  }
  if (group !== null && group.trim() !== "") {
    where += " AND p.group_name=?";
    args.push(group);
  }
  if (tagId !== null) {
    where += " AND EXISTS(SELECT 1 FROM people_tag_links pl WHERE pl.person_id=p.id AND pl.tag_id=?)";
    args.push(tagId);
  }
  if (type !== null && type.trim() !== "") {
    where += " AND t.type=?";
    args.push(type);
  }
  if (status !== null && status.trim() !== "") {
    where += " AND t.status=?";
    args.push(status);
  }
  if (priority !== null && priority.trim() !== "") {
    where += " AND t.priority=?";
    args.push(priority);
  }

  const base = " FROM tasks t JOIN people p ON p.id=t.assignee_id LEFT JOIN task_sla s ON s.task_id=t.id" + where;
  const responseBreach =
    "(s.response_breached_at IS NOT NULL OR (s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED') AND s.first_response_at IS NULL AND s.response_due_at < now()))";
  const resolveBreach =
    "(s.resolution_breached_at IS NOT NULL OR (s.paused_at IS NULL AND t.status NOT IN ('CANCELLED','STOPPED') AND s.resolved_at IS NULL AND s.resolution_due_at < now()))";
  const metrics =
    "SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN t.status IN ('PENDING','REWORK') THEN 1 ELSE 0 END),0) AS pending," +
    "COALESCE(SUM(CASE WHEN t.status='SUBMITTED' THEN 1 ELSE 0 END),0) AS awaiting_review,COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed," +
    "COALESCE(SUM(CASE WHEN t.status IN ('CANCELLED','STOPPED') THEN 1 ELSE 0 END),0) AS stopped," +
    "COALESCE(SUM(CASE WHEN s.paused_at IS NOT NULL AND t.status NOT IN ('COMPLETED','CANCELLED','STOPPED') THEN 1 ELSE 0 END),0) AS sla_paused," +
    "COALESCE(SUM(CASE WHEN t.overdue_at IS NOT NULL OR (t.due_at<now() AND t.status IN ('PENDING','REWORK')) THEN 1 ELSE 0 END),0) AS deadline_overdue," +
    "COALESCE(SUM(CASE WHEN " + responseBreach + " THEN 1 ELSE 0 END),0) AS response_breached," +
    "COALESCE(SUM(CASE WHEN " + resolveBreach + " THEN 1 ELSE 0 END),0) AS resolution_breached," +
    "COALESCE(SUM(CASE WHEN t.status='COMPLETED' AND s.resolved_at<=s.resolution_due_at THEN 1 ELSE 0 END),0) AS resolution_sla_met," +
    "ROUND(AVG(CASE WHEN s.resolved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (s.resolved_at - t.created_at))/60 END)::numeric,1) AS avg_resolution_minutes" +
    base;

  const summary = await one(metrics, ...args);
  const dimensionHead = (dimension: string) =>
    `SELECT ${dimension} AS dimension,COUNT(*) AS total,COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN ${resolveBreach} THEN 1 ELSE 0 END),0) AS sla_breached`;
  const byStatus = await list(
    dimensionHead("t.status") + base + " GROUP BY t.status ORDER BY total DESC LIMIT 100",
    ...args,
  );
  const byType = await list(
    dimensionHead("t.type") + base + " GROUP BY t.type ORDER BY total DESC LIMIT 100",
    ...args,
  );
  const byGroup = await list(
    dimensionHead("p.group_name") + base + " GROUP BY p.group_name ORDER BY total DESC LIMIT 100",
    ...args,
  );
  const byPriority = await list(
    dimensionHead("t.priority") + base + " GROUP BY t.priority ORDER BY total DESC LIMIT 100",
    ...args,
  );
  const byAssignee = await list(
    "SELECT p.id AS person_id,p.name,p.person_no,p.group_name,COUNT(*) AS total,COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed,COALESCE(SUM(CASE WHEN " +
      resolveBreach +
      " THEN 1 ELSE 0 END),0) AS sla_breached" +
      base +
      " GROUP BY p.id,p.name,p.person_no,p.group_name ORDER BY total DESC LIMIT 100",
    ...args,
  );
  const daily = await list(
    "SELECT CAST(t.created_at AS date) AS day,COUNT(*) AS created,COALESCE(SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completed" +
      base +
      " GROUP BY CAST(t.created_at AS date) ORDER BY day DESC LIMIT 60",
    ...args,
  );

  return {
    summary,
    by_status: byStatus,
    by_type: byType,
    by_group: byGroup,
    by_priority: byPriority,
    by_assignee: byAssignee,
    daily,
    filters: {
      time_basis: "created_at UTC",
      scope: "all ticket types",
      sla_definition: "review-approved completion",
    },
  };
}
