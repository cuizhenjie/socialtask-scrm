import { createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  badIf,
  ensure,
  execute,
  insert,
  list,
  one,
  optional,
  required,
  stamp,
  str,
  type Row,
} from "../db";
import { ApiError } from "../errors";
import { requireAdmin, sha256, type RequestUser } from "../context";
import type { Ctx } from "../dispatch";
import { afterLoginPath, cardReturnPath } from "../../login-return";
import { parseAttempt } from "../../wecom-oauth";
import { loginWecom } from "./auth";
import { createTicket } from "./task";

/**
 * 企业微信自建应用：加密回调、消息收件箱、出站回复、临时媒体与 OAuth 免登。
 * 对应 Spring 的 WecomCrypto / WecomInboxController / WecomInboxService /
 * WecomDispatchService / WecomMediaPolicy / WecomOAuthController / WecomGateway。
 */

const SPRING_TRUE = ["true", "on", "yes", "1"];
const SPRING_FALSE = ["false", "off", "no", "0"];
const USERID = /^[A-Za-z0-9_.@-]{1,128}$/;
const OAUTH_USERID = /^[A-Za-z0-9_.@-]{1,64}$/;
const NONCE = /^[0-9a-f]{64}$/;
const MEDIA_ID = /^[A-Za-z0-9_.@=+/-]{1,512}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

const MESSAGE_VIEW =
  "SELECT id,conversation_id,direction,message_type,content,provider_msgid,message_at,CASE WHEN delivery_status='SENDING' AND created_at < (CURRENT_TIMESTAMP - INTERVAL '5 minutes') THEN 'UNKNOWN' ELSE delivery_status END AS delivery_status,media_filename,media_bytes FROM wecom_messages WHERE id=?";

/* ------------------------------------------------------------------ 配置 */

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (SPRING_TRUE.includes(value)) return true;
  if (SPRING_FALSE.includes(value)) return false;
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envText(name: string, fallback = ""): string {
  return process.env[name] === undefined ? fallback : String(process.env[name]);
}

type WecomConfig = {
  enabled: boolean;
  mediaEnabled: boolean;
  oauthEnabled: boolean;
  corpId: string;
  agentId: number;
  secret: string;
  callbackEnabled: boolean;
  callbackToken: string;
  aesKey: string;
  retentionDays: number;
  publicUrl: string;
};

function config(): WecomConfig {
  return {
    enabled: flag("WECOM_ENABLED", false),
    mediaEnabled: flag("WECOM_MEDIA_ENABLED", false),
    oauthEnabled: flag("WECOM_OAUTH_ENABLED", false),
    corpId: envText("WECOM_CORP_ID"),
    agentId: envInt("WECOM_AGENT_ID", 0),
    secret: envText("WECOM_AGENT_SECRET"),
    callbackEnabled: flag("WECOM_CALLBACK_ENABLED", false),
    callbackToken: envText("WECOM_CALLBACK_TOKEN"),
    aesKey: envText("WECOM_ENCODING_AES_KEY"),
    retentionDays: envInt("WECOM_RETENTION_DAYS", 90),
    publicUrl: envText("APP_PUBLIC_URL", "http://localhost:3000"),
  };
}

export function outboundConfigured(): boolean {
  const cfg = config();
  return cfg.enabled && cfg.corpId.trim() !== "" && cfg.secret.trim() !== "" && cfg.agentId > 0;
}

export function mediaConfigured(): boolean {
  const cfg = config();
  return cfg.mediaEnabled && cfg.corpId.trim() !== "" && cfg.secret.trim() !== "" && cfg.agentId > 0;
}

/* ------------------------------------------------------------------ 通用 */

function caller(ctx: Ctx): RequestUser {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return ctx.user;
}

function longParam(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "编号格式错误");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function nonBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function parseObject(body: string): Record<string, unknown> {
  const node: unknown = JSON.parse(body);
  if (!isRecord(node)) throw new Error("企业微信响应无效");
  return node;
}

/** Java URLEncoder(UTF-8)：空格转 +，~!*'() 按表单规则编码。 */
function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()~]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

async function record(actor: number | null, entity: string, entityId: number, action: string, after: unknown): Promise<void> {
  await execute(
    "INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,CAST(? AS jsonb))",
    actor,
    entity,
    String(entityId),
    action,
    after === null || after === undefined ? null : JSON.stringify(after),
  );
}

function plainText(value: string, status: number): Response {
  return new Response(value, {
    status,
    headers: { "Content-Type": "text/plain;charset=UTF-8", "Cache-Control": "no-store" },
  });
}

/* ------------------------------------------------------------------ XML */

export class WecomSecurityError extends Error {}

function decodeXml(raw: string): string {
  if (/&(?!#\d+;|#x[0-9a-fA-F]+;|amp;|lt;|gt;|quot;|apos;)/.test(raw)) {
    throw new WecomSecurityError("回调 XML 无效");
  }
  return raw.replace(/&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = entity.startsWith("#x") || entity.startsWith("#X")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new WecomSecurityError("回调 XML 无效");
        return String.fromCodePoint(code);
      }
    }
  });
}

/** 与 WecomCrypto.parseXml 等价：只接受 <xml> 根与一级子元素，禁用 DTD/实体。 */
export function parseWecomXml(xml: string | null | undefined): Record<string, string> {
  if (xml === null || xml === undefined || xml.length > 1_000_000) throw new WecomSecurityError("回调超过大小限制");
  const source = xml.trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new WecomSecurityError("回调 XML 无效");
  let index = 0;
  const length = source.length;

  const skipProlog = (): void => {
    for (;;) {
      if (source.startsWith("<?", index)) {
        const end = source.indexOf("?>", index);
        if (end < 0) throw new WecomSecurityError("回调 XML 无效");
        index = end + 2;
      } else if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index);
        if (end < 0) throw new WecomSecurityError("回调 XML 无效");
        index = end + 3;
      } else if (index < length && /\s/.test(source[index])) {
        index++;
      } else {
        return;
      }
    }
  };

  const skipBetween = (): void => {
    for (;;) {
      if (index < length && /\s/.test(source[index])) index++;
      else if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index);
        if (end < 0) throw new WecomSecurityError("回调 XML 无效");
        index = end + 3;
      } else return;
    }
  };

  const readOpenTag = (): { name: string; selfClosing: boolean } => {
    if (source[index] !== "<") throw new WecomSecurityError("回调 XML 无效");
    index++;
    const match = /^[A-Za-z_][\w:.-]*/.exec(source.slice(index));
    if (!match) throw new WecomSecurityError("回调 XML 无效");
    const name = match[0];
    index += name.length;
    let quote = "";
    while (index < length) {
      const char = source[index];
      if (quote) {
        if (char === quote) quote = "";
        index++;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        index++;
        continue;
      }
      if (char === "<") throw new WecomSecurityError("回调 XML 无效");
      if (char === ">") {
        const selfClosing = source[index - 1] === "/";
        index++;
        return { name, selfClosing };
      }
      index++;
    }
    throw new WecomSecurityError("回调 XML 无效");
  };

  skipProlog();
  const root = readOpenTag();
  if (root.name !== "xml") throw new WecomSecurityError("回调 XML 根标签错误");
  if (root.selfClosing) return {};
  const result: Record<string, string> = {};
  for (;;) {
    skipBetween();
    if (index >= length) throw new WecomSecurityError("回调 XML 无效");
    if (source.startsWith("</", index)) {
      index += 2;
      const end = source.indexOf(">", index);
      if (end < 0) throw new WecomSecurityError("回调 XML 无效");
      index = end + 1;
      break;
    }
    const tag = readOpenTag();
    let text = "";
    if (!tag.selfClosing) {
      for (;;) {
        if (source.startsWith("<![CDATA[", index)) {
          const end = source.indexOf("]]>", index);
          if (end < 0) throw new WecomSecurityError("回调 XML 无效");
          text += source.slice(index + 9, end);
          index = end + 3;
          continue;
        }
        if (source.startsWith("</", index)) {
          index += 2;
          const end = source.indexOf(">", index);
          if (end < 0) throw new WecomSecurityError("回调 XML 无效");
          const closing = source.slice(index, end).trim();
          if (closing !== tag.name) throw new WecomSecurityError("回调 XML 无效");
          index = end + 1;
          break;
        }
        if (source.startsWith("<!--", index)) {
          const end = source.indexOf("-->", index);
          if (end < 0) throw new WecomSecurityError("回调 XML 无效");
          index = end + 3;
          continue;
        }
        // 一级子元素里出现嵌套标签时与原 DOM getTextContent 行为不同，直接拒绝。
        if (source[index] === "<") throw new WecomSecurityError("回调 XML 无效");
        const next = source.indexOf("<", index);
        if (next < 0) throw new WecomSecurityError("回调 XML 无效");
        text += decodeXml(source.slice(index, next));
        index = next;
      }
    }
    result[tag.name] = text;
  }
  return result;
}

/* ------------------------------------------------------------------ 加解密 */

function aesKey(raw: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}$/.test(raw)) throw new Error("EncodingAESKey 必须为 43 字符的企业微信密钥");
  const key = Buffer.from(raw + "=", "base64");
  if (key.length !== 32) throw new Error("EncodingAESKey 必须为 43 字符的企业微信密钥");
  return key;
}

export class WecomCrypto {
  private readonly token: string;
  private readonly corpId: string;
  private readonly key: Buffer;

  constructor(token: string, encodingAESKey: string, corpId: string) {
    if (token.trim() === "" || corpId.trim() === "") throw new Error("回调 Token 和 CorpID 未配置");
    this.key = aesKey(encodingAESKey);
    this.token = token;
    this.corpId = corpId;
  }

  signature(timestamp: string, nonce: string, encrypted: string): string {
    const items = [this.token, timestamp, nonce, encrypted].sort();
    return createHash("sha1").update(items.join(""), "utf8").digest("hex");
  }

  valid(signature: string | null, timestamp: string | null, nonce: string | null, encrypted: string | null): boolean {
    if (signature === null || timestamp === null || nonce === null || encrypted === null) return false;
    const given = Buffer.from(signature.toLowerCase(), "ascii");
    const expected = Buffer.from(this.signature(timestamp, nonce, encrypted), "ascii");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  decrypt(encrypted: string): string {
    try {
      if (!BASE64.test(encrypted)) throw new WecomSecurityError("加密回调格式非法");
      const ciphertext = Buffer.from(encrypted, "base64");
      if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) throw new WecomSecurityError("加密回调格式非法");
      const decipher = createDecipheriv("aes-256-cbc", this.key, this.key.subarray(0, 16));
      decipher.setAutoPadding(false);
      const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const padding = bytes[bytes.length - 1];
      if (padding < 1 || padding > 32 || bytes.length <= padding) throw new WecomSecurityError("回调填充非法");
      for (let i = bytes.length - padding; i < bytes.length; i++) {
        if (bytes[i] !== padding) throw new WecomSecurityError("回调填充不匹配");
      }
      const length = bytes.length - padding;
      if (length < 20) throw new WecomSecurityError("回调内容不足");
      const contentLength = bytes.readUInt32BE(16);
      if (contentLength > 1024 * 1024 || 20 + contentLength > length) throw new WecomSecurityError("回调内容长度非法");
      const payload = bytes.subarray(20, 20 + contentLength).toString("utf8");
      const receiver = bytes.subarray(20 + contentLength, length).toString("utf8");
      if (receiver !== this.corpId) throw new WecomSecurityError("回调目标企业不匹配");
      return payload;
    } catch (error) {
      if (error instanceof WecomSecurityError) throw error;
      throw new WecomSecurityError("回调无法解密或未通过校验");
    }
  }

  verify(
    given: string | null,
    timestamp: string | null,
    nonce: string | null,
    encrypted: string | null,
  ): string {
    if (!this.valid(given, timestamp, nonce, encrypted)) throw new WecomSecurityError("签名校验失败");
    return this.decrypt(encrypted as string);
  }
}

function callbackCrypto(): WecomCrypto {
  const cfg = config();
  if (!cfg.callbackEnabled) throw new ApiError(503, "企业微信消息回调未启用");
  try {
    return new WecomCrypto(cfg.callbackToken, cfg.aesKey, cfg.corpId);
  } catch {
    throw new ApiError(503, "企业微信回调尚未完成配置");
  }
}

/* ------------------------------------------------------------------ 媒体策略 */

export type WecomUpload = { type: string; filename: string; mime: string; bytes: Buffer };
export type ImageInfo = { format: "png" | "jpeg"; width: number; height: number };

export function validMediaId(value: string | null | undefined): boolean {
  return typeof value === "string" && MEDIA_ID.test(value);
}

export function mediaDigest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function prefix(bytes: Buffer, expected: Buffer): boolean {
  if (bytes.length < expected.length) return false;
  return bytes.subarray(0, expected.length).equals(expected);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const AMR_MAGIC = Buffer.from("#!AMR\n", "ascii");

/** 仅做结构校验：PNG IHDR + IEND；JPEG SOFn + EOI。与 ImageIO 解码等价性有限但无新增依赖。 */
export function inspectImage(bytes: Buffer): ImageInfo | null {
  if (prefix(bytes, PNG_MAGIC)) {
    if (bytes.length < 32 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
      return null;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (bytes.subarray(bytes.length - 8, bytes.length - 4).toString("ascii") !== "IEND") return null;
    return { format: "png", width, height };
  }
  if (prefix(bytes, JPEG_MAGIC)) {
    if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      let marker = bytes[offset + 1];
      while (marker === 0xff) {
        offset++;
        if (offset + 1 >= bytes.length) return null;
        marker = bytes[offset + 1];
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) return null;
      const segment = bytes.readUInt16BE(offset + 2);
      if (segment < 2) return null;
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isStartOfFrame) {
        if (offset + 9 > bytes.length) return null;
        return { format: "jpeg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + segment;
    }
    return null;
  }
  return null;
}

function acceptImage(bytes: Buffer): string {
  const png = prefix(bytes, PNG_MAGIC);
  const jpeg = prefix(bytes, JPEG_MAGIC);
  if (!png && !jpeg) throw new ApiError(400, "只允许 PNG/JPEG 图片");
  const info = inspectImage(bytes);
  if (
    info === null ||
    !((png && info.format === "png") || (jpeg && info.format === "jpeg")) ||
    info.width <= 0 ||
    info.height <= 0 ||
    info.width > 4096 ||
    info.height > 4096 ||
    info.width * info.height > 12_000_000
  ) {
    throw new ApiError(400, "图片无法解析或尺寸超限");
  }
  return png ? "image/png" : "image/jpeg";
}

function acceptVoice(bytes: Buffer): void {
  if (!prefix(bytes, AMR_MAGIC)) throw new ApiError(400, "语音仅支持 AMR-NB");
  const sizes = [12, 13, 15, 17, 19, 20, 26, 31, 5];
  let offset = 6;
  let frames = 0;
  while (offset < bytes.length) {
    const frameType = (bytes[offset] >> 3) & 15;
    if (frameType >= sizes.length) throw new ApiError(400, "AMR 帧格式不支持");
    offset += 1 + sizes[frameType];
    frames++;
    if (offset > bytes.length || frames > 3000) throw new ApiError(400, "语音帧不完整或超过 60 秒");
  }
  if (frames === 0) throw new ApiError(400, "语音无有效帧");
}

export function validateWecomMedia(
  rawType: string | null | undefined,
  rawFilename: string | null | undefined,
  bytes: Buffer | null | undefined,
): WecomUpload {
  const type = rawType ?? "";
  if (!["image", "voice", "video", "file"].includes(type)) throw new ApiError(400, "不支持的媒体类型");
  const max = type === "image" || type === "voice" ? 2 * 1024 * 1024 : MAX_MEDIA_BYTES;
  if (bytes === null || bytes === undefined || bytes.length <= 5 || bytes.length > max) {
    throw new ApiError(400, "媒体须大于 5 字节且不超过本系统类型上限");
  }
  let name = rawFilename === null || rawFilename === undefined ? "file" : rawFilename.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (name.length > 100) name = name.slice(name.length - 100);
  if (name.trim() === "" || name === "." || name === "..") name = "file";
  let mime: string;
  if (type === "image") {
    mime = acceptImage(bytes);
  } else if (type === "voice") {
    acceptVoice(bytes);
    mime = "voice/amr";
  } else if (type === "video") {
    if (bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") {
      throw new ApiError(400, "视频仅支持 MP4 容器");
    }
    mime = "video/mp4";
  } else {
    mime = "application/octet-stream";
  }
  return { type, filename: name, mime, bytes };
}

/* ------------------------------------------------------------------ 出站网关 */

export class WecomRejected extends Error {
  constructor() {
    super("企业微信明确拒绝请求");
  }
}

let cachedToken: string | null = null;
let tokenExpiry = 0;

function invalidateToken(used: string): void {
  if (used === cachedToken) {
    cachedToken = null;
    tokenExpiry = 0;
  }
}

async function accessToken(): Promise<string> {
  const cfg = config();
  if (cachedToken !== null && Date.now() < tokenExpiry) return cachedToken;
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encode(cfg.corpId)}&corpsecret=${encode(cfg.secret)}`,
    { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(6000) },
  );
  if (response.status !== 200) throw new Error(`企业微信 token HTTP ${response.status}`);
  const node = parseObject(await response.text());
  if (integer(node.errcode, -1) !== 0) throw new WecomRejected();
  const token = node.access_token;
  if (typeof token !== "string" || token.trim() === "") throw new Error("企业微信凭证响应无效");
  cachedToken = token;
  tokenExpiry = Date.now() + Math.max(0, integer(node.expires_in, 7200) - 180) * 1000;
  return token;
}

async function postMessage(payload: Record<string, unknown>): Promise<string> {
  if (!outboundConfigured()) throw new Error("企业微信自建应用未完成出站配置");
  const token = await accessToken();
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encode(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const node = parseObject(await response.text());
  const code = node.errcode;
  if (response.status !== 200 || typeof code !== "number" || !Number.isInteger(code)) {
    throw new Error("企业微信响应异常");
  }
  if (code === 40014 || code === 42001) invalidateToken(token);
  if (code !== 0) throw new WecomRejected();
  if (nonBlank(node.invaliduser) || nonBlank(node.unlicenseduser)) throw new WecomRejected();
  return typeof node.msgid === "string" ? node.msgid : "";
}

function limited(input: string | null | undefined, maxBytes: number): string {
  const source = input ?? "";
  let out = "";
  let bytes = 0;
  for (const char of source) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}

function escapeXml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function checkUser(userid: string | null): asserts userid is string {
  if (userid === null || !USERID.test(userid)) throw new Error("企业微信 UserID 格式不合法");
}

export async function sendTextCard(
  userid: string,
  title: string | null,
  description: string | null,
  taskId: number | null,
): Promise<string> {
  checkUser(userid);
  const link = config().publicUrl.replace(/\/+$/, "") + (taskId === null ? "/m" : `/m/tasks/${taskId}`);
  const safeTitle = limited(escapeXml(title === null ? "SocialTask 工单通知" : title), 128);
  const safeDescription = limited(escapeXml(description === null ? "请打开任务中心处理" : description), 512);
  return postMessage({
    touser: userid,
    msgtype: "textcard",
    agentid: config().agentId,
    textcard: { title: safeTitle, description: safeDescription, url: link, btntxt: "查看" },
    enable_duplicate_check: 1,
  });
}

export async function sendText(userid: string, content: string | null): Promise<string> {
  checkUser(userid);
  const safe = content;
  if (safe === null || safe.trim() === "" || Buffer.byteLength(safe, "utf8") > 2048) {
    throw new Error("企业微信文本须为 1–2048 UTF-8 字节");
  }
  return postMessage({
    touser: userid,
    msgtype: "text",
    agentid: config().agentId,
    text: { content: safe },
  });
}

export async function sendMedia(userid: string, upload: WecomUpload): Promise<string> {
  checkUser(userid);
  if (!outboundConfigured() || !mediaConfigured()) throw new Error("企业微信媒体发送未启用");
  const token = await accessToken();
  const boundary = `SocialTask${randomUUID().replace(/-/g, "")}`;
  const begin = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${upload.filename}"; filelength=${upload.bytes.length}\r\nContent-Type: ${upload.mime}\r\n\r\n`,
    "ascii",
  );
  const end = Buffer.from(`\r\n--${boundary}--\r\n`, "ascii");
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encode(token)}&type=${upload.type}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat([begin, upload.bytes, end]),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (response.status !== 200) throw new Error("企业微信媒体响应异常");
  const node = parseObject(await response.text());
  if (typeof node.errcode !== "number" || !Number.isInteger(node.errcode)) throw new Error("企业微信媒体响应无效");
  const code = node.errcode;
  if (code === 40014 || code === 42001) invalidateToken(token);
  if (code !== 0) throw new WecomRejected();
  const mediaId = node.media_id;
  if (typeof mediaId !== "string" || !validMediaId(mediaId)) throw new Error("企业微信媒体响应无效");
  return postMessage({
    touser: userid,
    msgtype: upload.type,
    agentid: config().agentId,
    [upload.type]: { media_id: mediaId },
  });
}

async function boundedBody(response: Response, max: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) {
      total += next.value.length;
      if (total > max) {
        await reader.cancel();
        throw new Error("媒体超过大小上限");
      }
      chunks.push(next.value);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function downloadMedia(mediaId: string): Promise<Buffer> {
  if (!mediaConfigured() || !validMediaId(mediaId)) throw new Error("媒体下载未启用或媒体标识无效");
  const token = await accessToken();
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${encode(token)}&media_id=${encode(mediaId)}`,
    { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000) },
  );
  const bytes = await boundedBody(response, MAX_MEDIA_BYTES);
  if (response.status !== 200 || bytes.length === 0) throw new Error("媒体暂不可用");
  const mime = (response.headers.get("content-type") ?? "").toLowerCase();
  if (mime.includes("json") || bytes[0] === 0x7b) throw new Error("媒体已失效或无访问权限");
  return bytes;
}

/* ------------------------------------------------------------------ 收件箱 */

async function receive(xml: Record<string, string>): Promise<void> {
  if (xml.Event === "kf_msg_or_event") return;
  const user = xml.FromUserName;
  const type = xml.MsgType;
  if (user === undefined || user.trim() === "" || user.length > 128 || type === undefined || type.length > 32) {
    throw new WecomSecurityError("企业微信消息缺少合法发送人或类型");
  }
  let key = xml.MsgId;
  if (key === undefined || key.trim() === "") {
    key = sha256([user, xml.CreateTime ?? "", xml.Event ?? "", xml.EventKey ?? "", xml.Content ?? ""].join("|"));
  }
  const hash = sha256(`WECOM_APP:${key}`);
  const matches = await list("SELECT id FROM people WHERE wecom_userid=? AND status='ACTIVE' LIMIT 2", user);
  const personId = matches.length === 1 ? Number(matches[0].id) : 0;
  await execute(
    "INSERT INTO wecom_conversations(channel,peer_userid,person_id,last_message_at) VALUES('WECOM_APP',?,?,CURRENT_TIMESTAMP) ON CONFLICT (channel,peer_userid) DO UPDATE SET person_id=EXCLUDED.person_id",
    user,
    personId === 0 ? null : personId,
  );
  const thread = await one(
    "SELECT id FROM wecom_conversations WHERE channel='WECOM_APP' AND peer_userid=? FOR UPDATE",
    user,
  );
  const threadId = Number(thread.id);
  if ((await optional("SELECT id FROM wecom_messages WHERE msg_key=?", hash)) !== null) return;
  let content: string;
  if (type === "text") content = xml.Content ?? "";
  else if (["image", "voice", "video"].includes(type)) content = `[${type} 媒体消息：原件须在有效期内授权下载]`;
  else if (type === "link") content = `[链接消息] ${xml.Title ?? ""}\n${xml.Description ?? ""}\n${xml.Url ?? ""}`;
  else if (type === "location") content = `[位置消息] ${xml.Label ?? ""}`;
  else if (type === "event") content = `[应用事件：${xml.Event ?? "unknown"}]`;
  else content = `[${type} 类型消息：请在企业微信中查看原件]`;
  if (content.length > 4000) content = content.slice(0, 4000);
  let when = new Date();
  const rawTime = xml.CreateTime ?? "";
  if (/^[+-]?\d+$/.test(rawTime)) {
    const timestamp = Number(rawTime);
    if (Number.isSafeInteger(timestamp) && timestamp > 0 && Math.abs(timestamp - Math.floor(Date.now() / 1000)) < 86400) {
      when = new Date(timestamp * 1000);
    }
  }
  await execute(
    "INSERT INTO wecom_messages(conversation_id,msg_key,direction,message_type,content,provider_msgid,message_at) VALUES(?,?,'INBOUND',?,?,?,?)",
    threadId,
    hash,
    type.toUpperCase(),
    content,
    xml.MsgId ?? null,
    stamp(when),
  );
  if (["image", "voice", "video"].includes(type) && validMediaId(xml.MediaId)) {
    await execute("UPDATE wecom_messages SET provider_media_id=? WHERE msg_key=?", xml.MediaId, hash);
  }
  await execute(
    "UPDATE wecom_conversations SET unread_count=unread_count+1,last_message_at=GREATEST(last_message_at,?) WHERE id=?",
    stamp(when),
    threadId,
  );
}

export async function wecomConfig(ctx: Ctx): Promise<Record<string, unknown>> {
  requireAdmin(caller(ctx));
  const cfg = config();
  const callbackConfigured =
    cfg.callbackEnabled && cfg.callbackToken.trim() !== "" && cfg.aesKey.trim() !== "" && cfg.corpId.trim() !== "";
  return {
    outbound_enabled: outboundConfigured(),
    media_enabled: mediaConfigured(),
    callback_configured: callbackConfigured,
    channel: "WECOM_APP",
    external_customer_chats_supported: false,
  };
}

export async function wecomThreads(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  const q = ctx.query.get("q");
  const base =
    "SELECT c.*,p.name AS person_name,p.group_name,(SELECT m.content FROM wecom_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message FROM wecom_conversations c LEFT JOIN people p ON p.id=c.person_id ";
  if (q === null || q.trim() === "") return list(base + "ORDER BY c.last_message_at DESC LIMIT 300");
  const pattern = `%${q.trim()}%`;
  return list(
    base + "WHERE c.peer_userid LIKE ? OR p.name LIKE ? ORDER BY c.last_message_at DESC LIMIT 300",
    pattern,
    pattern,
  );
}

export async function wecomMessages(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  const threadId = longParam(ctx.params.id);
  await one("SELECT id FROM wecom_conversations WHERE id=?", threadId);
  return list(
    "SELECT id,conversation_id,direction,message_type,content,provider_msgid,message_at,CASE WHEN delivery_status='SENDING' AND created_at < (CURRENT_TIMESTAMP - INTERVAL '5 minutes') THEN 'UNKNOWN' ELSE delivery_status END AS delivery_status,media_filename,media_bytes,(provider_media_id IS NOT NULL AND message_at > (CURRENT_TIMESTAMP - INTERVAL '3 days')) AS media_available FROM wecom_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 200",
    threadId,
  );
}

export async function wecomMarkRead(ctx: Ctx): Promise<Row> {
  requireAdmin(caller(ctx));
  const threadId = longParam(ctx.params.id);
  await execute("UPDATE wecom_conversations SET unread_count=0 WHERE id=?", threadId);
  return one("SELECT * FROM wecom_conversations WHERE id=?", threadId);
}

async function send(
  actor: RequestUser,
  threadId: number,
  request: string,
  type: string,
  content: string,
  digest: string,
  upload: WecomUpload | null,
): Promise<Row> {
  badIf(!UUID.test(request), "请求编号须为 UUID");
  const key = sha256(`OUT_REQ:${actor.id}:${threadId}:${request.toLowerCase()}`);
  const fingerprint = sha256(`${type}:${digest}:${content}`);

  const thread = await one("SELECT * FROM wecom_conversations WHERE id=? FOR UPDATE", threadId);
  ensure(str(thread.channel) === "WECOM_APP", "仅自建应用会话支持此发送接口");
  const previous = await optional("SELECT id,request_fingerprint FROM wecom_messages WHERE msg_key=?", key);
  let claimId: number;
  let claimUser: string | null;
  let fresh: boolean;
  if (previous !== null) {
    ensure(fingerprint === str(previous.request_fingerprint), "同一请求编号不能更换消息内容");
    claimId = Number(previous.id);
    claimUser = null;
    fresh = false;
  } else {
    ensure(outboundConfigured() && (upload === null || mediaConfigured()), "应用出站或媒体未完成配置");
    ensure(thread.person_id !== null && thread.person_id !== undefined, "未绑定成员禁止直接回复");
    const uid = str(thread.peer_userid);
    const matches = await list(
      "SELECT id,wecom_userid FROM people WHERE wecom_userid=? AND status='ACTIVE' LIMIT 2",
      uid,
    );
    ensure(
      matches.length === 1 && Number(matches[0].id) === Number(thread.person_id) && uid === str(matches[0].wecom_userid),
      "成员已停用、绑定冲突或 UserID 已变更",
    );
    claimId = await insert(
      "INSERT INTO wecom_messages(conversation_id,msg_key,direction,message_type,content,message_at,delivery_status,request_fingerprint,media_filename,media_bytes) VALUES(?,?,'OUTBOUND',?,?,CURRENT_TIMESTAMP,'SENDING',?,?,?)",
      threadId,
      key,
      type,
      content,
      fingerprint,
      upload === null ? null : upload.filename,
      upload === null ? null : upload.bytes.length,
    );
    await execute("UPDATE wecom_conversations SET last_message_at=CURRENT_TIMESTAMP WHERE id=?", threadId);
    await record(actor.id, "wecom_message", claimId, "SEND_CLAIM", { thread: threadId, type });
    claimUser = uid;
    fresh = true;
  }

  if (!fresh) return one(MESSAGE_VIEW, claimId);

  if (claimUser === null) throw new ApiError(409, "成员已停用、绑定冲突或 UserID 已变更");
  let state: string;
  let provider: string | null = null;
  try {
    provider = upload === null ? await sendText(claimUser, content) : await sendMedia(claimUser, upload);
    state = "ACCEPTED";
  } catch (error) {
    state = error instanceof WecomRejected ? "FAILED" : "UNKNOWN";
  }
  await execute(
    "UPDATE wecom_messages SET delivery_status=?,provider_msgid=? WHERE id=? AND delivery_status='SENDING'",
    state,
    provider,
    claimId,
  );
  await record(actor.id, "wecom_message", claimId, "SEND_RESULT", { state });
  return one(MESSAGE_VIEW, claimId);
}

export async function wecomReply(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const threadId = longParam(ctx.params.id);
  const rawRequest = ctx.body.requestId;
  const request = typeof rawRequest === "string" && rawRequest !== "" ? rawRequest : randomUUID();
  const content = typeof ctx.body.content === "string" ? ctx.body.content : null;
  const clean = required(content, "回复内容", 1000);
  badIf(Buffer.byteLength(clean, "utf8") > 2048, "文本超过 2048 UTF-8 字节");
  return send(user, threadId, request, "TEXT", clean, sha256(clean), null);
}

export async function wecomReplyMedia(ctx: Ctx): Promise<Row> {
  const user = requireAdmin(caller(ctx));
  const threadId = longParam(ctx.params.id);
  const form = await ctx.request.formData();
  const rawRequest = form.get("requestId");
  const rawType = form.get("type");
  const file = form.get("file");
  if (typeof rawRequest !== "string") throw new ApiError(400, "请求编号不能为空");
  if (typeof rawType !== "string") throw new ApiError(400, "媒体类型不能为空");
  if (file === null || typeof file === "string") throw new ApiError(400, "缺少上传文件");
  if (file.size > MAX_MEDIA_BYTES) throw new ApiError(400, "媒体超过大小上限");
  const bytes = Buffer.from(await file.arrayBuffer());
  const upload = validateWecomMedia(rawType, file.name, bytes);
  return send(
    user,
    threadId,
    rawRequest,
    upload.type.toUpperCase(),
    `[发送媒体] ${upload.filename}`,
    mediaDigest(upload.bytes),
    upload,
  );
}

export async function wecomDownloadMedia(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(caller(ctx));
  const messageId = longParam(ctx.params.id);
  if (!mediaConfigured()) throw new ApiError(409, "媒体下载未启用");
  const row = await optional(
    "SELECT m.provider_media_id FROM wecom_messages m JOIN wecom_conversations c ON c.id=m.conversation_id WHERE m.id=? AND c.channel='WECOM_APP' AND m.direction='INBOUND' AND m.delivery_status='RECEIVED' AND m.message_type IN ('IMAGE','VOICE','VIDEO') AND m.message_at > (CURRENT_TIMESTAMP - INTERVAL '3 days')",
    messageId,
  );
  const mediaId = row === null ? null : str(row.provider_media_id);
  if (row === null || !validMediaId(mediaId)) throw new ApiError(404, "媒体不存在、已清理或超过有效期");
  let bytes: Buffer;
  try {
    bytes = await downloadMedia(mediaId as string);
  } catch {
    throw new ApiError(502, "媒体暂不可下载，请核对授权及有效期");
  }
  await record(actor.id, "wecom_message", messageId, "MEDIA_DOWNLOAD", { bytes: bytes.length });
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="wecom-media-${messageId}.bin"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export async function wecomConversationTickets(ctx: Ctx): Promise<Row[]> {
  requireAdmin(caller(ctx));
  const conversationId = longParam(ctx.params.conversationId);
  await one("SELECT id FROM wecom_conversations WHERE id=? AND channel='WECOM_APP'", conversationId);
  return list(
    "SELECT t.id,t.task_no,t.title,t.status,t.priority,t.due_at,t.source_message_id,p.name AS assignee_name FROM wecom_messages m JOIN tasks t ON t.source_message_id=m.id JOIN people p ON p.id=t.assignee_id WHERE m.conversation_id=? AND m.direction='INBOUND' ORDER BY t.id DESC LIMIT 50",
    conversationId,
  );
}

export async function wecomCreateTicket(ctx: Ctx): Promise<Record<string, unknown>> {
  requireAdmin(caller(ctx));
  const conversationId = longParam(ctx.params.conversationId);
  await one("SELECT id FROM wecom_conversations WHERE id=? AND channel='WECOM_APP'", conversationId);
  const rawSource = ctx.body.sourceMessageId;
  const sourceId = rawSource === null || rawSource === undefined || rawSource === "" ? Number.NaN : Number(rawSource);
  badIf(!Number.isInteger(sourceId) || sourceId <= 0, "必须选择当前会话的入站来源消息");
  // 先锁定来源消息，再复用 TaskService.createTicket 的完整建单/模板/SLA 逻辑。
  const source = await optional(
    "SELECT id FROM wecom_messages WHERE id=? AND conversation_id=? AND direction='INBOUND' AND delivery_status<>'REDACTED' FOR UPDATE",
    sourceId,
    conversationId,
  );
  ensure(source !== null, "来源消息不属于当前会话、已清理或并非入站消息");
  return createTicket(ctx);
}

/* ------------------------------------------------------------------ 回调 */

export async function wecomCallbackVerify(ctx: Ctx): Promise<Response> {
  const signature = ctx.query.get("msg_signature");
  const timestamp = ctx.query.get("timestamp");
  const nonce = ctx.query.get("nonce");
  const echo = ctx.query.get("echostr");
  try {
    return plainText(callbackCrypto().verify(signature, timestamp, nonce, echo), 200);
  } catch (error) {
    if (error instanceof WecomSecurityError) return plainText("invalid signature", 403);
    throw error;
  }
}

export async function wecomCallbackReceive(ctx: Ctx): Promise<Response> {
  const signature = ctx.query.get("msg_signature");
  const timestamp = ctx.query.get("timestamp");
  const nonce = ctx.query.get("nonce");
  const body = await ctx.request.text();
  try {
    const payload = parseWecomXml(body);
    const decrypted = callbackCrypto().verify(signature, timestamp, nonce, payload.Encrypt ?? null);
    await receive(parseWecomXml(decrypted));
    return plainText("success", 200);
  } catch (error) {
    if (error instanceof WecomSecurityError) return plainText("invalid callback", 403);
    throw error;
  }
}

/* ------------------------------------------------------------------ OAuth */

export type WecomSession = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: { id: number; username: string; role: string; person_id: number | null };
};

let oauthToken: string | null = null;
let oauthExpiry = 0;

function invalidateOauthToken(used: string): void {
  if (used === oauthToken) {
    oauthToken = null;
    oauthExpiry = 0;
  }
}

function oauthCallback(publicUrl: string): string {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error("OAuth requires a canonical HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("OAuth requires a canonical HTTPS origin");
  }
  return `https://${url.host}/api/auth/wecom/callback`;
}

function requireOAuthConfigured(): WecomConfig {
  const cfg = config();
  if (!cfg.oauthEnabled) throw new ApiError(404, "企业微信登录未启用");
  if (cfg.corpId.trim() === "" || cfg.secret.trim() === "" || cfg.agentId <= 0) {
    throw new ApiError(503, "企业微信登录配置不完整");
  }
  try {
    oauthCallback(cfg.publicUrl);
  } catch {
    throw new ApiError(503, "企业微信登录需要 HTTPS 公网地址");
  }
  return cfg;
}

function authorizationUrl(corpId: string, agentId: number, callback: string, state: string): string {
  return (
    `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encode(corpId)}` +
    `&redirect_uri=${encode(callback)}&response_type=code&scope=snsapi_base&agentid=${agentId}` +
    `&state=${encode(state)}#wechat_redirect`
  );
}

async function oauthAccessToken(cfg: WecomConfig): Promise<string> {
  if (oauthToken !== null && Date.now() < oauthExpiry) return oauthToken;
  const response = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encode(cfg.corpId)}&corpsecret=${encode(cfg.secret)}`,
    { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(6000) },
  );
  if (response.status !== 200) throw new Error("OAuth upstream HTTP failure");
  const node = parseObject(await response.text());
  if (integer(node.errcode, -1) !== 0) throw new Error("OAuth token rejected");
  const token = node.access_token;
  if (typeof token !== "string" || token.trim() === "") throw new Error("OAuth token rejected");
  oauthToken = token;
  oauthExpiry = Date.now() + Math.max(0, integer(node.expires_in, 0) - 180) * 1000;
  return token;
}

function isNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE.test(value);
}

function validCode(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    !CONTROL.test(value) &&
    !/\s/.test(value)
  );
}

async function providerUserId(code: string): Promise<string> {
  const cfg = requireOAuthConfigured();
  if (!validCode(code)) throw new ApiError(400, "授权码无效");
  try {
    const used = await oauthAccessToken(cfg);
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encode(used)}&code=${encode(code)}`,
      { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    if (response.status !== 200) throw new Error("OAuth upstream HTTP failure");
    const node = parseObject(await response.text());
    const error = integer(node.errcode, -1);
    if (error === 40014 || error === 42001) invalidateOauthToken(used);
    if (error !== 0) throw new ApiError(401, "企业微信授权失败，请重新授权");
    const userid = node.userid;
    if (typeof userid !== "string" || !OAUTH_USERID.test(userid)) {
      throw new ApiError(403, "企业微信身份未获授权");
    }
    return userid;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "企业微信授权服务暂不可用");
  }
}

export type WecomOAuthStartInput = { browserNonce?: unknown; next?: unknown };
export type WecomOAuthExchangeInput = { state?: unknown; browserNonce?: unknown; code?: unknown };

export async function wecomOAuthStart(input: WecomOAuthStartInput): Promise<{ authorization_url: string }> {
  const cfg = requireOAuthConfigured();
  const browserNonce = input.browserNonce;
  if (!isNonce(browserNonce)) throw new ApiError(400, "OAuth 浏览器状态无效");
  const state = randomBytes(32).toString("hex");
  const now = new Date();
  await execute("DELETE FROM wecom_oauth_states WHERE expires_at<=?", stamp(now));
  await execute(
    "INSERT INTO wecom_oauth_states(state_hash,browser_hash,return_path,expires_at) VALUES(?,?,?,?)",
    sha256(state),
    sha256(browserNonce),
    cardReturnPath(input.next),
    stamp(new Date(now.getTime() + 300 * 1000)),
  );
  return { authorization_url: authorizationUrl(cfg.corpId, cfg.agentId, oauthCallback(cfg.publicUrl), state) };
}

async function consumeState(state: unknown, browserNonce: unknown): Promise<{ next: string | null }> {
  const invalid = new ApiError(400, "OAuth 状态无效或已过期，请重新授权");
  const stateValue = typeof state === "string" ? state : null;
  const browserValue = typeof browserNonce === "string" ? browserNonce : null;
  if (!isNonce(stateValue) || !isNonce(browserValue)) throw invalid;
  const stateHash = sha256(stateValue);
  const browserHash = sha256(browserValue);
  const now = new Date();
  const row = await optional(
    "SELECT return_path FROM wecom_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>?",
    stateHash,
    browserHash,
    stamp(now),
  );
  if (row === null) throw invalid;
  const affected = await execute(
    "DELETE FROM wecom_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>?",
    stateHash,
    browserHash,
    stamp(now),
  );
  if (affected !== 1) throw invalid;
  return { next: cardReturnPath(str(row.return_path)) };
}

export async function wecomOAuthExchange(input: WecomOAuthExchangeInput): Promise<WecomSession & { next: string | null }> {
  requireOAuthConfigured();
  const code = typeof input.code === "string" ? input.code : null;
  if (!validCode(code)) throw new ApiError(400, "授权码无效");
  const attempt = await consumeState(input.state, input.browserNonce);
  const session: WecomSession = await loginWecom(await providerUserId(code));
  return { ...session, next: attempt.next };
}

/* ------------------------------------------------------- 浏览器端 OAuth 辅助 */

export type WecomOAuthAttempt = { browserNonce: string; next: string | null };
export type WecomLoginResult = { location: string; attempt?: WecomOAuthAttempt; accessToken?: string };

function failure(reason: string, next: unknown): WecomLoginResult {
  const params = new URLSearchParams({ wecom_error: reason });
  const target = cardReturnPath(next);
  if (target !== null) params.set("next", target);
  return { location: `/login?${params.toString()}` };
}

function reason(status: number): string {
  if (status === 404) return "disabled";
  if (status === 403) return "unbound";
  if (status === 400 || status === 401) return "invalid";
  return "unavailable";
}

export async function startWecomLogin(next: unknown): Promise<WecomLoginResult> {
  const attempt: WecomOAuthAttempt = { browserNonce: randomBytes(32).toString("hex"), next: cardReturnPath(next) };
  try {
    const body = await wecomOAuthStart(attempt);
    const url = new URL(body.authorization_url);
    if (
      url.origin !== "https://open.weixin.qq.com" ||
      url.pathname !== "/connect/oauth2/authorize" ||
      url.username ||
      url.password ||
      url.hash !== "#wechat_redirect" ||
      !isNonce(url.searchParams.get("state"))
    ) {
      throw new Error("invalid authorization URL");
    }
    return { location: url.href, attempt };
  } catch (error) {
    if (error instanceof ApiError) return failure(reason(error.status), attempt.next);
    return failure("unavailable", attempt.next);
  }
}

export async function finishWecomLogin(params: URLSearchParams, cookie: string | undefined): Promise<WecomLoginResult> {
  const attempt = parseAttempt(cookie);
  const state = params.get("state");
  const code = params.get("code");
  const stateValue = isNonce(state) ? state : null;
  const codeValue = validCode(code) ? code : null;
  if (
    attempt === null ||
    params.getAll("state").length !== 1 ||
    params.getAll("code").length !== 1 ||
    stateValue === null ||
    codeValue === null
  ) {
    return failure("invalid", attempt?.next ?? null);
  }
  try {
    const body = await wecomOAuthExchange({ state: stateValue, browserNonce: attempt.browserNonce, code: codeValue });
    if (
      typeof body.access_token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.access_token) ||
      body.access_token.length !== 43 ||
      body.expires_in !== 43200 ||
      body.user === null ||
      !["admin", "manager", "author", "creator", "assistant", "support"].includes(body.user.role)
    ) {
      throw new Error("invalid session response");
    }
    return { location: afterLoginPath(body.next, body.user.role), accessToken: body.access_token };
  } catch (error) {
    if (error instanceof ApiError) return failure(reason(error.status), attempt.next);
    return failure("unavailable", attempt.next);
  }
}


