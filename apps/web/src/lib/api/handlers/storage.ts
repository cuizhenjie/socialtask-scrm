import { createHash, randomUUID } from "node:crypto";
import { bool, execute, list, one, optional, str, stamp, instant } from "../db";
import { readAttachment, removeAttachment, storeAttachment } from "../object-storage";
import { ApiError } from "../errors";
import { isAdmin, requireAdmin, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import sharp from "sharp";

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

async function sniff(bytes: Buffer): Promise<string> {
  const png = prefix(bytes, PNG_MAGIC);
  const jpeg = prefix(bytes, JPEG_MAGIC);
  if (!png && !jpeg) throw new ApiError(400, "只允许真实 PNG/JPEG 图片文件");
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 12_000_000, sequentialRead: true });
    const { format, width, height, pages } = await image.metadata();
    if (format !== (png ? "png" : "jpeg") || !width || !height || width > 4096 || height > 4096 ||
        width * height > 12_000_000 || (pages ?? 1) !== 1) throw new Error("invalid image dimensions");
    // Metadata alone accepts truncated and header-only images.
    await image.raw().toBuffer();
  } catch {
    throw new ApiError(400, "图片内容无法解码、尺寸超限或格式不一致");
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

const MAX_MULTIPART = MAX_UPLOAD + 64 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

async function boundedForm(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(type) || !request.body) throw new ApiError(400, "请使用 multipart 上传图片");
  if (Number(request.headers.get("content-length")) > MAX_MULTIPART) throw new ApiError(413, "上传请求超过 5 MB 文件限制");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_MULTIPART) {
        void reader.cancel().catch(() => undefined);
        throw new ApiError(413, "上传请求超过 5 MB 文件限制");
      }
      chunks.push(value);
    }
    return await new Response(Buffer.concat(chunks, length), { headers: { "Content-Type": type } }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "图片上传请求不完整或格式错误");
  } finally {
    reader.releaseLock();
  }
}

export async function attachmentUpload(ctx: Ctx): Promise<Record<string, unknown>> {
  const actor = caller(ctx);
  const requestId = ctx.request.headers.get("idempotency-key") ?? randomUUID();
  if (!UUID.test(requestId)) throw new ApiError(400, "上传凭据须为 UUID v4");
  const form = await boundedForm(ctx.request);
  const rawPurpose = form.get("purpose");
  if (form.getAll("purpose").length !== 1 || typeof rawPurpose !== "string" || !["CONTENT", "PRIVATE_MESSAGE"].includes(rawPurpose)) {
    throw new ApiError(400, "附件用途不合法");
  }
  if (rawPurpose === "CONTENT") requireAdmin(actor);
  const file = form.get("file");
  if (form.getAll("file").length !== 1 || file === null || typeof file === "string" || file.size === 0) {
    throw new ApiError(400, "请仅上传一张非空图片");
  }
  if (file.size > MAX_UPLOAD) throw new ApiError(413, "图片不能超过 5 MB");
  const body = Buffer.from(await file.arrayBuffer());
  const mime = await sniff(body);
  const name = Array.from(file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_")).slice(-200).join("") || "attachment";
  const sha256 = createHash("sha256").update(body).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify([rawPurpose, name, mime, sha256])).digest("hex");
  const key = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const days = rawPurpose === "PRIVATE_MESSAGE"
    ? envInt("ATTACHMENT_PM_RETENTION_DAYS", 90)
    : envInt("ATTACHMENT_CONTENT_RETENTION_DAYS", 0);
  const retention = days >= 1 && days <= 3650 ? new Date(Date.now() + days * 86_400_000) : null;
  const lease = await optional(
    "INSERT INTO socialtask_attachment_uploads(owner_user_id,request_id,fingerprint,storage_key,retention_until) "
    + "VALUES(?,CAST(? AS uuid),?,?,CAST(? AS timestamptz)) ON CONFLICT(owner_user_id,request_id) DO UPDATE "
    + "SET expires_at=CURRENT_TIMESTAMP+INTERVAL '24 hours' WHERE socialtask_attachment_uploads.fingerprint=EXCLUDED.fingerprint "
    + "AND NOT socialtask_attachment_uploads.cleanup_only RETURNING storage_key,attachment_id",
    actor.id, requestId, fingerprint, key, stamp(retention),
  );
  if (!lease) throw new ApiError(409, "上传凭据已过期或用于另一张图片，请重新选图");
  let id = lease.attachment_id;
  if (id === null) {
    await storeAttachment(String(lease.storage_key), body, mime, sha256);
    const finished = await one(
      "SELECT public.socialtask_finish_upload(?,CAST(? AS uuid),?,?,?,?,?) AS id",
      actor.id, requestId, fingerprint, rawPurpose, name, mime, body.length,
    );
    id = finished.id;
    if (id === null) throw new ApiError(409, "上传凭据已过期，请重新选图");
  }
  const row = await one("SELECT id,filename,mime,file_size,retention_until,purged_at FROM attachments WHERE id=?", id);
  if (expired(row)) throw new ApiError(410, "该附件已过期，请重新选图");
  const result: Record<string, unknown> = { id: Number(row.id), filename: row.filename, mime: row.mime, file_size: Number(row.file_size) };
  if (row.retention_until != null) result.retention_until = instant(row.retention_until)?.toISOString();
  return result;
}

function expired(row: Record<string, unknown>): boolean {
  return row.purged_at != null || (row.retention_until != null && (instant(row.retention_until)?.getTime() ?? 0) <= Date.now());
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
  if (expired(meta)) {
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
  let abandoned = 0;
  const pending = await list(
    "SELECT owner_user_id,request_id,storage_key FROM socialtask_attachment_uploads "
    + "WHERE attachment_id IS NULL AND cleaned_at IS NULL AND expires_at<=CURRENT_TIMESTAMP ORDER BY expires_at LIMIT 20",
  );
  for (const row of pending) {
    const claimed = await execute(
      "UPDATE socialtask_attachment_uploads SET cleanup_only=true WHERE owner_user_id=? AND request_id=CAST(? AS uuid) "
      + "AND attachment_id IS NULL AND cleaned_at IS NULL AND expires_at<=CURRENT_TIMESTAMP", row.owner_user_id, row.request_id,
    );
    if (!claimed) continue;
    try {
      await removeAttachment(String(row.storage_key));
      await execute(
        "UPDATE socialtask_attachment_uploads SET cleaned_at=CURRENT_TIMESTAMP WHERE owner_user_id=? AND request_id=CAST(? AS uuid) AND cleaned_at IS NULL",
        row.owner_user_id, row.request_id,
      );
      abandoned++;
    } catch {
      failed++;
    }
  }
  return { purged, abandoned, failed };
}
