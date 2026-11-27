import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DbConflictError, ApiError } from "../errors";
import { bool, execute, num, object, one, optional, required, str, type Row } from "../db";
import type { RequestUser } from "../context";
import type { Ctx } from "../dispatch";

/**
 * 全局配置与 LLM 模型配置（对应 Spring 的 SettingsController/LlmSettingsController/
 * LlmProfileService/SecretBox/ModelEndpoint/LlmReviewTransport）。
 * 只读取服务端环境变量，绝不回显任何密钥原值。
 */

const SPRING_TRUE = ["true", "on", "yes", "1"];
const SPRING_FALSE = ["false", "off", "no", "0"];
const TEMPLATE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const PRINTABLE_KEY = /^[\x21-\x7e]+$/;
const CONTROL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const MODEL_PATH = /^[A-Za-z0-9_./~-]*$/;
const KF_ACCOUNT = /^wk[A-Za-z0-9_-]{1,126}$/;

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

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
  if (raw === undefined || !/^[+-]?\d+$/.test(raw.trim())) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (SPRING_TRUE.includes(lower)) return true;
    if (SPRING_FALSE.includes(lower)) return false;
  }
  return null;
}

async function record(actor: number, entity: string, entityId: number, action: string, after: unknown): Promise<void> {
  await execute(
    "INSERT INTO audit_logs(actor_user_id,entity,entity_id,action,after_json) VALUES(?,?,?,?,CAST(? AS jsonb))",
    actor,
    entity,
    String(entityId),
    action,
    after === null || after === undefined ? null : JSON.stringify(after),
  );
}

/* ---------------------------------------------------------------- 环境变量配置检查 */

function callbackReady(token: string | undefined, aesKey: string | undefined, corpId: string): boolean {
  if (!present(token) || corpId.trim() === "") return false;
  const encoded = (aesKey ?? "") + "=";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  try {
    return Buffer.from(encoded, "base64").length === 32;
  } catch {
    return false;
  }
}

function publicHttps(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) return false;
    return url.pathname === "" || url.pathname === "/";
  } catch {
    return false;
  }
}

function check(id: string, label: string, enabled: boolean, configured: boolean, hint: string) {
  return {
    id,
    label,
    enabled,
    configured,
    state: !enabled ? "DISABLED" : configured ? "CONFIGURED" : "INCOMPLETE",
    hint,
  };
}

export function settingsView(ctx: Ctx) {
  const user = ctx.user!;
  if (user.role !== "admin") throw new ApiError(403, "仅系统管理员可以查看全局配置");

  const corp = process.env.WECOM_CORP_ID ?? "";
  const agent = envInt("WECOM_AGENT_ID", 0);
  const retention = envInt("WECOM_RETENTION_DAYS", 90);
  const secret = process.env.WECOM_AGENT_SECRET;
  const core = corp.trim() !== "" && agent > 0 && present(secret);

  const callback = callbackReady(process.env.WECOM_CALLBACK_TOKEN, process.env.WECOM_ENCODING_AES_KEY, corp);
  const https = publicHttps(process.env.APP_PUBLIC_URL ?? "http://localhost:3000");

  const kfSecret = process.env.WECOM_KF_SECRET;
  const kfRetention = envInt("WECOM_KF_RETENTION_DAYS", 30);
  const kfReady =
    flag("WECOM_KF_ENABLED", false) &&
    flag("WECOM_KF_AUTHORIZED", false) &&
    corp.trim() !== "" &&
    KF_ACCOUNT.test(process.env.WECOM_KF_ACCOUNT_ID ?? "") &&
    present(kfSecret) &&
    (kfSecret ?? "") !== (secret ?? "") &&
    kfRetention >= 1 &&
    kfRetention <= 90;

  const pmDays = envInt("ATTACHMENT_PM_RETENTION_DAYS", 90);
  const contentDays = envInt("ATTACHMENT_CONTENT_RETENTION_DAYS", 0);

  return {
    configuration_source: "SERVER_ENV",
    connection_tested: false,
    checks: [
      check(
        "app_send",
        "企业微信应用发送",
        flag("WECOM_ENABLED", false),
        core,
        "WECOM_ENABLED / WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_AGENT_SECRET",
      ),
      check(
        "app_callback",
        "加密消息回调",
        flag("WECOM_CALLBACK_ENABLED", false),
        callback && https,
        "WECOM_CALLBACK_ENABLED / WECOM_CALLBACK_TOKEN / WECOM_ENCODING_AES_KEY / APP_PUBLIC_URL",
      ),
      check(
        "app_oauth",
        "企业微信 OAuth",
        flag("WECOM_OAUTH_ENABLED", false),
        core && https,
        "WECOM_OAUTH_ENABLED / APP_PUBLIC_URL",
      ),
      check(
        "app_media",
        "临时媒体能力",
        flag("WECOM_MEDIA_ENABLED", false),
        core,
        "独立媒体开关 WECOM_MEDIA_ENABLED；仅在已授权环境启用",
      ),
    ],
    wecom: {
      corp_id_configured: corp.trim() !== "",
      agent_id: agent,
      secret_configured: present(secret),
      callback_token_configured: present(process.env.WECOM_CALLBACK_TOKEN),
      encoding_aes_key_configured: present(process.env.WECOM_ENCODING_AES_KEY),
      public_https: https,
      retention_days: retention,
      retention_valid: retention >= 1 && retention <= 3650,
    },
    scheduler_enabled: flag("SCHEDULER_ENABLED", true),
    followup_max_active_tasks: envInt("FOLLOWUP_MAX_ACTIVE_TASKS", 10),
    attachments: {
      pm_retention_days: pmDays,
      content_retention_days: contentDays,
      retention_valid: pmDays >= 1 && pmDays <= 3650 && contentDays >= 0 && contentDays <= 3650,
    },
    external_channels: [
      {
        id: "WECHAT_KF",
        label: "微信客服",
        state: kfReady ? "CONFIGURED" : flag("WECOM_KF_ENABLED", false) ? "INCOMPLETE" : "DISABLED",
        hint: "独立客服 Secret 与账号授权；已实现手动只读 sync_msg，不使用自建应用 Secret",
      },
      {
        id: "CHAT_ARCHIVE",
        label: "会话内容存档",
        state: "NOT_CONNECTED",
        hint: "独立许可、员工告知、客户同意及官方存档 SDK；不是实时回复渠道",
      },
    ],
    model: {
      source: "DSH_HOST_ENV",
      protocol: "OPENAI_CHAT_COMPLETIONS",
      state: "EXTERNAL_CONFIGURATION",
      variables: [
        "SOCIALTASK_LLM_ENABLED",
        "SOCIALTASK_LLM_BASE_URL",
        "SOCIALTASK_LLM_ENDPOINT",
        "SOCIALTASK_LLM_MODEL",
        "SOCIALTASK_LLM_API_KEY",
      ],
    },
  };
}

/* ------------------------------------------------------------------------- SecretBox */

function masterKey(): Buffer | null {
  const encoded = process.env.SOCIALTASK_CONFIG_KEY ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const key = Buffer.from(encoded, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function aad(version: number): string {
  return `socialtask:llm:profile:${version}`;
}

function encryptSecret(clear: string, context: string): string {
  const key = masterKey();
  if (!key) throw new ApiError(503, "配置主密钥未设置");
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(clear, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
  } catch {
    throw new ApiError(503, "凭据加密失败");
  }
}

function decryptSecret(encrypted: string, context: string): string {
  const key = masterKey();
  if (!key) throw new ApiError(503, "配置主密钥未设置");
  try {
    const data = Buffer.from(encrypted, "base64");
    if (data.length < 29) throw new Error("short");
    const nonce = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const body = data.subarray(12, data.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new ApiError(503, "凭据解密失败，请恢复正确主密钥或显式重新设置凭据");
  }
}

/* ---------------------------------------------------------------------- ModelEndpoint */

type ModelUrl = { origin: string; path: string };

function parseModelUrl(value: string): ModelUrl {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("invalid");
  }
  if (url.port !== "") {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("invalid");
  }
  const path = url.pathname === "" ? "/" : url.pathname;
  if (
    path.includes("%") ||
    path.includes("\\") ||
    path.includes("//") ||
    !MODEL_PATH.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("invalid");
  }
  const host = url.hostname.toLowerCase();
  const origin = "https://" + host + (url.port === "" || url.port === "443" ? "" : ":" + url.port);
  return { origin, path };
}

function allowedOrigins(): Set<string> {
  const raw = process.env.SOCIALTASK_LLM_ALLOWED_ORIGINS ?? "";
  const origins = new Set<string>();
  if (raw.trim() === "") return origins;
  try {
    for (const item of raw.split(",")) {
      const parsed = parseModelUrl(item.trim());
      if (parsed.path !== "" && parsed.path !== "/") throw new Error("path");
      origins.add(parsed.origin);
    }
  } catch {
    return new Set<string>();
  }
  return origins;
}

function modelEndpoint(input: string, baseUrl: boolean): string {
  if (input === null || input.trim() === "" || input.length > 1024) throw new ApiError(400, "模型地址不能为空或过长");
  let parsed: ModelUrl;
  try {
    parsed = parseModelUrl(input.trim());
  } catch {
    throw new ApiError(400, "仅支持无用户名、查询参数、片段和路径穿越的 HTTPS 模型地址");
  }
  if (!allowedOrigins().has(parsed.origin)) throw new ApiError(400, "模型服务源不在部署允许名单中");
  let path = parsed.path;
  if (baseUrl) path = path.replace(/\/+$/, "") + "/chat/completions";
  if (path === "" || path === "/" || !path.endsWith("/chat/completions")) {
    throw new ApiError(400, "请输入 Chat Completions 完整路径或 Base URL");
  }
  return parsed.origin + path;
}

/* ------------------------------------------------------------------------ 模型评审传输 */

async function postModel(endpoint: string, key: string, payload: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json;charset=utf-8", Authorization: `Bearer ${key}` },
      body: payload,
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status !== 200) throw new Error("model response rejected");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 65536) throw new Error("model response exceeds limit");
    return new TextDecoder().decode(buffer);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- LLM profile */

function requireModelAdmin(user: RequestUser): void {
  if (user.role !== "admin") throw new ApiError(403, "仅系统管理员可管理模型配置");
}

function profileView(row: Row | null): Record<string, unknown> {
  const result: Record<string, unknown> = {
    version: row === null ? 0 : num(row.version),
    enabled: row !== null && bool(row.enabled),
    endpoint: row === null ? "" : (str(row.endpoint) ?? ""),
    model: row === null ? "" : (str(row.model_id) ?? ""),
    key_configured: row !== null && row.key_cipher !== null && row.key_cipher !== undefined,
    storage_ready: masterKey() !== null,
    allowed_origin_count: allowedOrigins().size,
    connection_tested: false,
  };
  if (row !== null) result.updated_at = row.updated_at;
  return result;
}

async function profileRow(): Promise<Row | null> {
  return optional("SELECT * FROM llm_profile WHERE id=1");
}

type ActiveProfile = { endpoint: string; model: string; key: string };

async function activeProfile(): Promise<ActiveProfile> {
  const row = await profileRow();
  if (row === null || !bool(row.enabled) || row.key_cipher === null || row.key_cipher === undefined) {
    throw new ApiError(409, "服务端模型尚未启用");
  }
  return {
    endpoint: modelEndpoint(str(row.endpoint) ?? "", false),
    model: str(row.model_id) ?? "",
    key: decryptSecret(str(row.key_cipher) ?? "", aad(num(row.version))),
  };
}

export async function llmView(ctx: Ctx) {
  const user = ctx.user!;
  requireModelAdmin(user);
  return profileView(await profileRow());
}

export async function saveLlm(ctx: Ctx) {
  const user = ctx.user!;
  requireModelAdmin(user);
  if (masterKey() === null || allowedOrigins().size === 0) {
    throw new ApiError(503, "须先由部署管理员配置主密钥及 HTTPS 模型服务允许名单");
  }

  const expectedVersion = optionalInt(ctx.body.expectedVersion);
  const enabled = optionalBoolean(ctx.body.enabled);
  if (expectedVersion === null || expectedVersion < 0 || expectedVersion === 2147483647 || enabled === null) {
    throw new ApiError(400, "缺少版本或启用状态");
  }

  const target = modelEndpoint(optionalText(ctx.body.url) ?? "", optionalBoolean(ctx.body.baseUrl) === true);
  const model = required(ctx.body.model, "模型 ID", 160);
  if (CONTROL_CHAR.test(model)) throw new ApiError(400, "模型 ID 含非法控制字符");

  const clear = optionalBoolean(ctx.body.clearKey) === true;
  const supplied = optionalText(ctx.body.apiKey);
  const hasSupplied = supplied !== null && supplied !== "";
  if (clear && hasSupplied) throw new ApiError(400, "不能同时清除和替换密钥");
  if (hasSupplied && ((supplied as string).length > 2048 || !PRINTABLE_KEY.test(supplied as string))) {
    throw new ApiError(400, "API Key 含非法字符或过长");
  }

  const old = await optional("SELECT * FROM llm_profile WHERE id=1 FOR UPDATE");
  const version = old === null ? 0 : num(old.version);
  if (version !== expectedVersion) throw new ApiError(409, "配置版本已变化，请刷新后重试");
  const next = version + 1;

  let key: string | null = null;
  if (!clear) {
    if (hasSupplied) key = supplied as string;
    else if (old !== null && old.key_cipher !== null && old.key_cipher !== undefined) {
      key = decryptSecret(str(old.key_cipher) ?? "", aad(version));
    }
  }
  if (enabled && key === null) throw new ApiError(400, "启用模型前须设置 API Key");
  if (old !== null && str(old.endpoint) !== target && key !== null && !hasSupplied) {
    throw new ApiError(400, "更改模型地址时须重新输入 API Key 或显式清除");
  }

  const cipher = key === null ? null : encryptSecret(key, aad(next));
  try {
    if (old === null) {
      await execute(
        "INSERT INTO llm_profile(id,version,enabled,endpoint,model_id,key_cipher,updated_by) VALUES(1,?,?,?,?,?,?)",
        next,
        enabled,
        target,
        model,
        cipher,
        user.id,
      );
    } else {
      await execute(
        "UPDATE llm_profile SET version=?,enabled=?,endpoint=?,model_id=?,key_cipher=?,updated_by=? WHERE id=1",
        next,
        enabled,
        target,
        model,
        cipher,
        user.id,
      );
    }
  } catch (error) {
    if (error instanceof DbConflictError) throw new ApiError(409, "配置版本已变化，请刷新后重试");
    throw error;
  }
  await record(user.id, "llm_profile", 1, "UPDATE", {
    version: next,
    enabled,
    key_changed: clear || hasSupplied,
  });
  return profileView(await one("SELECT * FROM llm_profile WHERE id=1"));
}

export async function reviewLlm(ctx: Ctx) {
  const user = ctx.user!;
  requireModelAdmin(user);
  if (optionalBoolean(ctx.body.approveSanitized) !== true) {
    throw new ApiError(400, "须明确确认仅向指定模型发送脱敏字段结构");
  }
  const templateKey = optionalText(ctx.body.templateKey);
  const version = optionalInt(ctx.body.version);
  if (templateKey === null || !TEMPLATE_KEY.test(templateKey) || version === null || version < 1) {
    throw new ApiError(400, "须指定已发布模板版本");
  }

  const active = await activeProfile();
  const saved = await one("SELECT schema_json FROM ticket_templates WHERE template_key=? AND version=?", templateKey, version);
  const schema = object(saved.schema_json);
  const rawFields = Array.isArray(schema.fields) ? (schema.fields as unknown[]) : [];
  if (rawFields.length < 1 || rawFields.length > 30) throw new ApiError(400, "参数有误");
  const fields: { position: number; phase: string; kind: string; required: boolean }[] = [];
  for (const item of rawFields) {
    const field = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const phase = field === null ? "" : str(field.phase) ?? "";
    const kind = field === null ? "" : str(field.kind) ?? "";
    if (
      field === null ||
      (phase !== "DISPATCH" && phase !== "RESPONSE") ||
      (kind !== "TEXT" && kind !== "HTTPS_URL" && kind !== "CHECKBOX" && kind !== "MATERIAL_PACKAGE") ||
      typeof field.required !== "boolean"
    ) {
      throw new ApiError(400, "参数有误");
    }
    fields.push({ position: fields.length + 1, phase, kind, required: field.required });
  }

  const request = {
    model: active.model,
    stream: false,
    max_tokens: 600,
    messages: [
      {
        role: "system",
        content:
          "Review only the provided anonymous ticket field sequence, phase, type and required flag. Suggest ordering/requiredness improvements, do not invent business facts or request identity, content or secrets. Return concise text in Chinese.",
      },
      { role: "user", content: JSON.stringify({ fields }) },
    ],
  };

  try {
    const raw = await postModel(active.endpoint, active.key, JSON.stringify(request));
    const parsed = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") throw new Error("invalid");
    let output = content.split(active.key).join("[REDACTED]");
    output = output.replace(CONTROL_CHARS, "");
    if (output.length > 4000) output = output.slice(0, 4000);
    await record(user.id, "llm_profile", 1, "SANITIZED_TEMPLATE_REVIEW", {
      fields: fields.length,
      outcome: "SUCCESS",
    });
    return { review: output, fields_sent: fields.length, applied: false };
  } catch {
    throw new ApiError(502, "模型评审暂不可用；未自动重试，也未修改模板");
  }
}
