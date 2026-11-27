import bcrypt from "bcryptjs";
import { bool, list, one, optional, str } from "../db";
import { ApiError } from "../errors";
import { verifyAttachmentBucket } from "../object-storage";
import { bearerToken, issueSession, revokeSession, userView } from "../context";
import type { Ctx as DispatchCtx } from "../dispatch";

export function health() {
  return { ok: true, service: "socialtask", version: "1.1.0" };
}

export async function readiness() {
  try {
    const row = await one(
      "SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.socialtask_job_leases') IS NOT NULL AND to_regprocedure('public.socialtask_bootstrap_admin(text,text)') IS NOT NULL AS ready",
    );
    if (!bool(row.ready)) throw new Error("schema");
    await verifyAttachmentBucket();
    return { ok: true };
  } catch {
    throw new ApiError(503, "Supabase 数据库或私有附件桶未就绪");
  }
}

async function bootstrapAdmin(username: string) {
  const initialUsername = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const initialPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  // The database serializes first-admin creation; never changes any existing user.
  if (!initialUsername || initialUsername !== username || !initialPassword) return;
  if (initialUsername.length > 80 || initialPassword.length < 16 || Buffer.byteLength(initialPassword) > 72) {
    throw new ApiError(503, "首个管理员配置不合法");
  }
  const existing = await optional("SELECT id FROM users LIMIT 1");
  if (!existing) {
    const hash = await bcrypt.hash(initialPassword, 12);
    await one("SELECT public.socialtask_bootstrap_admin(?, ?) AS created", initialUsername, hash);
  }
}

export async function login(body: Record<string, unknown>) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) throw new ApiError(400, "请输入账号和密码");
  await bootstrapAdmin(username);
  const user = await optional("SELECT * FROM users WHERE username=?", username);
  const hash = user ? str(user.password_hash) ?? "" : "";
  if (!user || !bool(user.active) || !hash || !(await bcrypt.compare(password, hash))) {
    throw new ApiError(401, "用户名或密码错误");
  }
  return issueSession(user, "PASSWORD");
}

export async function logout(ctx: DispatchCtx) {
  await revokeSession(ctx.token ?? bearerToken(ctx.request));
  return { ok: true };
}

export function me(ctx: DispatchCtx) {
  if (!ctx.user) throw new ApiError(401, "请先登录");
  return userView(ctx.user);
}

/** 企业微信登录：仅接受由企业 OAuth 回调确认过的 userid。 */
export async function loginWecom(userid: string) {
  if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(userid)) throw new ApiError(403, "企业微信身份未获授权");
  const rows = await list(
    "SELECT u.*,p.status AS person_status,p.wecom_userid AS bound_userid FROM people p LEFT JOIN users u ON u.person_id=p.id WHERE p.wecom_userid=?",
    userid,
  );
  if (rows.length !== 1) throw new ApiError(403, "企业微信身份未获授权");
  const user = rows[0];
  const allowed = ["admin", "manager", "author", "creator", "assistant", "support"];
  if (
    user.id === null || user.id === undefined ||
    !bool(user.active) ||
    user.person_status !== "ACTIVE" ||
    userid.toLowerCase() !== (str(user.bound_userid) ?? "").toLowerCase() ||
    !allowed.includes(str(user.role) ?? "")
  ) {
    throw new ApiError(403, "企业微信身份未获授权");
  }
  return issueSession(user, "WECOM");
}
