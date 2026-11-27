import { list, num, one, type Row } from "../db";
import { ApiError } from "../errors";
import { requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

async function count(sql: string): Promise<number> {
  return num((await one(sql)).n);
}

export async function dashboard(ctx: Ctx): Promise<Row> {
  requireAdmin(caller(ctx));
  const summary: Row = {};
  summary.total_tasks = await count("SELECT COUNT(*) n FROM tasks");
  summary.pending = await count("SELECT COUNT(*) n FROM tasks WHERE status IN ('PENDING','REWORK')");
  summary.completed = await count("SELECT COUNT(*) n FROM tasks WHERE status='COMPLETED'");
  summary.need_review = await count("SELECT COUNT(*) n FROM tasks WHERE status='SUBMITTED'");
  summary.overdue = await count(
    "SELECT COUNT(*) n FROM tasks WHERE overdue_at IS NOT NULL OR (due_at < now() AND status IN ('PENDING','REWORK'))",
  );
  summary.works = await count("SELECT COUNT(*) n FROM works");
  summary.customers = await count("SELECT COUNT(*) n FROM customers");
  summary.people = await count("SELECT COUNT(*) n FROM people");
  summary.by_type = await list(
    "SELECT type,COUNT(*) total,SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) done FROM tasks GROUP BY type",
  );
  summary.recent_tasks = await list(
    "SELECT t.id,t.task_no,t.title,t.type,t.status,t.due_at,p.name AS assignee_name FROM tasks t JOIN people p ON p.id=t.assignee_id ORDER BY t.id DESC LIMIT 12",
  );
  return summary;
}
