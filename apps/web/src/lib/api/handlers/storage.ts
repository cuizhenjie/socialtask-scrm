import { randomUUID } from "node:crypto";
import { bool, list, one, optional, str, stamp } from "../db";
import { readAttachment, removeAttachment, storeAttachment } from "../object-storage";
import { ApiError } from "../errors";
import { isAdmin, requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import { inspectImage } from "./wecom";

/**
 * 附件：multipart 上传（PNG/JPEG 真实解码校验）、二进制下载与保留期清理。
 * 对应 Spring 的 AttachmentController 与 AttachmentRetentionService。
 */

const MAX_UPLOAD = 5 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function longParam(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "编号格式错误");
  return parsed;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function prefix(bytes: Buffer, expected: Buffer): boolean {
  return bytes.length >= expected.length && bytes.subarray(0, expected.length).equals(expected);
}

function sniff(bytes: Buffer): string {
  const png = prefix(bytes, PNG_MAGIC);
  const jpeg = prefix(bytes, JPEG_MAGIC);
  if (!png && !jpeg) throw new ApiError(400, "只允许真实 PNG/JPEG 图片文件");
  const info = inspectImage(bytes);
  if (
    info === null ||
    !((png && info.format === "png") || (jpeg && info.format === "jpeg")) ||
    info.width < 1 ||
    info.width > 4096 ||
    info.height < 1 ||
    info.height > 4096 ||
    info.width * info.height > 12_000_000
  ) {
    throw new ApiError(400, "图片内容无法解析、尺寸超限或格式不一致");
  }
  return png ? "image/png" : "image/jpeg";
}

function contentDisposition(filename: string): string {
  const fallback = Array.from(filename, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code > 0x7e || char === '"' || char === "\\" ? "_" : char;
  }).join("");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function attachmentUpload(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = caller(ctx);
  const form = await ctx.request.formData();
  const rawPurpose = form.get("purpose");
  if (typeof rawPurpose !== "string" || !["CONTENT", "PRIVATE_MESSAGE"].includes(rawPurpose)) {
    throw new ApiError(400, "附件用途不合法");
  }
  if (rawPurpose === "CONTENT") requireAdmin(actor);
  const file = form.get("file");
  if (file === null || typeof file === "string") throw new ApiError(400, "图片大小须为 1B–5MB");
  if (file.size === 0 || file.size > MAX_UPLOAD) throw new ApiError(400, "图片大小须为 1B–5MB");
  const body = Buffer.from(await file.arrayBuffer());
  const mime = sniff(body);
  const key = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  let name = file.name.replace(/[\r\n\u0000/\\]/g, "_");
  if (name.length > 200) name = name.slice(name.length - 200);
  const days = rawPurpose === "PRIVATE_MESSAGE"
    ? envInt("ATTACHMENT_PM_RETENTION_DAYS", 90)
    : envInt("ATTACHMENT_CONTENT_RETENTION_DAYS", 0);
  const retentionUntil = days >= 1 && days <= 3650 ? new Date(Date.now() + days * 86_400_000) : null;
  await storeAttachment(key, body, mime);
  // Metadata and audit are committed together. On an ambiguous RPC failure, do not
  // delete the object: the transaction may already have committed.
  const created = await one(
    "SELECT public.socialtask_register_attachment(?, ?, ?, ?, ?, ?, CAST(? AS timestamptz)) AS id",
    actor.id, rawPurpose, name, key, mime, body.length, stamp(retentionUntil),
  );
  const result: Record<string, unknown> = { id: Number(created.id), filename: name, mime, file_size: body.length };
  if (retentionUntil !== null) result.retention_until = retentionUntil.toISOString();
  return result;
}

export async function attachmentDownload(ctx: Ctx): Promise<Response> {
  const actor = caller(ctx);
  const attachmentId = longParam(ctx.params.id);
  const meta = await one("SELECT * FROM attachments WHERE id=?", attachmentId);
  const purpose = str(meta.purpose);
  if (purpose === "PRIVATE_MESSAGE" && !isAdmin(actor)) throw new ApiError(403, "私信截图仅管理人员可下载");
  if (purpose === "CONTENT" && !isAdmin(actor)) {
    if (actor.personId === null) throw new ApiError(403, "无素材访问权限");
    const jsonId = JSON.stringify(attachmentId);
    let allowed = await optional(
      "SELECT t.id FROM tasks t JOIN publish_batches b ON b.id=t.batch_id JOIN content_packages p ON p.id=b.content_id WHERE t.assignee_id=? AND (p.asset_ids_json @> CAST(? AS jsonb)) LIMIT 1",
      actor.personId,
      jsonId,
    );
    if (allowed === null) {
      allowed = await optional(
        "SELECT t.id FROM tasks t JOIN ticket_material_assets m ON m.task_id=t.id WHERE t.assignee_id=? AND m.attachment_id=? AND t.status NOT IN ('CANCELLED','STOPPED') LIMIT 1",
        actor.personId,
        attachmentId,
      );
    }
    if (allowed === null) throw new ApiError(403, "无素材访问权限");
  }
  if (meta.purged_at !== null && meta.purged_at !== undefined) {
    throw new ApiError(410, "该附件已超过保留期并按隐私策略清理");
  }
  const key = str(meta.storage_key);
  if (key === null) throw new ApiError(404, "附件文件不存在");
  const object = await readAttachment(key);
  const headers = new Headers();
  headers.set("Content-Type", str(meta.mime) ?? "application/octet-stream");
  headers.set("Content-Disposition", contentDisposition(str(meta.filename) ?? "attachment"));
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { status: 200, headers });
}

/** 物理删除过期附件文件，保留数据库元数据以维持外键与审计历史。 */
export async function purgeExpiredAttachments(): Promise<Record<string, unknown>> {
  const pmRetention = envInt("ATTACHMENT_PM_RETENTION_DAYS", 90);
  const fallbackDays = pmRetention >= 1 && pmRetention <= 3650 ? pmRetention : 90;
  const rows = await list(
    "SELECT id, purpose, storage_key FROM attachments WHERE purged_at IS NULL AND ((retention_until IS NOT NULL AND retention_until <= CURRENT_TIMESTAMP) OR (retention_until IS NULL AND purpose='PRIVATE_MESSAGE' AND created_at < (CURRENT_TIMESTAMP - (? * INTERVAL '1 day')))) ORDER BY id LIMIT 100",
    fallbackDays,
  );
  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    const key = str(row.storage_key);
    if (!key) { failed++; continue; }
    try {
      await removeAttachment(key);
      const updated = await one("SELECT public.socialtask_record_attachment_purge(?) AS purged", Number(row.id));
      if (bool(updated.purged)) purged++;
    } catch {
      failed++;
    }
  }
  return { purged, failed };
}
