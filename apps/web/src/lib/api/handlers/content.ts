import { execute, insert, list, one, required, str, type Row } from "../db";
import { ApiError } from "../errors";
import { requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function pathId(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ApiError(400, "编号格式错误");
  return parsed;
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

export async function contentList(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  return list("SELECT * FROM content_packages ORDER BY id DESC LIMIT 300");
}

export async function createContent(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const rawTitle = ctx.body.title;
  const rawBody = ctx.body.body;
  if (typeof rawTitle !== "string" || typeof rawBody !== "string") {
    throw new ApiError(400, "标题不能为空或过长");
  }
  required(rawTitle, "标题", 220);
  required(rawBody, "正文", 60000);
  const rawHashtags = ctx.body.hashtags;
  const hashtags = rawHashtags === null || rawHashtags === undefined ? "" : String(rawHashtags);
  const rawAssets = ctx.body.assetIds;
  let assets: number[] = [];
  if (rawAssets !== null && rawAssets !== undefined) {
    if (!Array.isArray(rawAssets)) throw new ApiError(400, "素材编号错误");
    assets = rawAssets.map((item) => Number(item));
    assets = [...new Set(assets)];
    for (const assetId of assets) {
      if (!Number.isInteger(assetId)) throw new ApiError(400, "素材编号错误");
      await one("SELECT id FROM attachments WHERE id=? AND purpose='CONTENT' AND purged_at IS NULL AND (retention_until IS NULL OR retention_until>CURRENT_TIMESTAMP)", assetId);
    }
  }
  const contentId = await insert(
    "INSERT INTO content_packages(title,body,hashtags,asset_ids_json,created_by) VALUES(?,?,?,CAST(? AS jsonb),?)",
    rawTitle,
    rawBody,
    hashtags,
    JSON.stringify(assets),
    user.id,
  );
  await audit(user.id, "content", contentId, "CREATE", { title: rawTitle });
  return one("SELECT * FROM content_packages WHERE id=?", contentId);
}

export async function reviewContent(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const contentId = pathId(ctx.params.id);
  const pack = await one("SELECT * FROM content_packages WHERE id=? FOR UPDATE", contentId);
  if (str(pack.review_status) !== "DRAFT") throw new ApiError(409, "素材仅可从草稿审核");
  const decision = ctx.body.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") throw new ApiError(400, "审核结论错误");
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  await execute("UPDATE content_packages SET review_status=?,reviewed_by=? WHERE id=?", status, user.id, contentId);
  await audit(user.id, "content", contentId, "REVIEW", { status });
  return one("SELECT * FROM content_packages WHERE id=?", contentId);
}
