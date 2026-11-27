import { createHash, randomBytes } from "node:crypto";
import { execute, bool, optional, str, type Row } from "./db";
import { ApiError } from "./errors";

export type RequestUser = { id: number; username: string; role: string; personId: number | null };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header && header.startsWith("Bearer ") ? header.slice(7) : null;
}

export function principal(row: Row): RequestUser {
  return {
    id: Number(row.id),
    username: str(row.username) ?? "",
    role: str(row.role) ?? "",
    personId: row.person_id === null || row.person_id === undefined ? null : Number(row.person_id),
  };
}

export async function authenticate(token: string | null | undefined): Promise<RequestUser | null> {
  if (!token || token.length < 35 || token.length > 150) return null;
  const row = await optional(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked=FALSE AND s.expires_at>CURRENT_TIMESTAMP AND u.active=TRUE",
    sha256(token),
  );
  return row ? principal(row) : null;
}

export async function requireUser(request: Request, token?: string | null): Promise<RequestUser> {
  const user = await authenticate(token ?? bearerToken(request));
  if (!user) throw new ApiError(401, "请先登录");
  return user;
}

export function isAdmin(user: RequestUser): boolean {
  return user.role === "admin" || user.role === "manager";
}

export function requireAdmin(user: RequestUser): RequestUser {
  if (!isAdmin(user)) throw new ApiError(403, "仅管理员可操作");
  return user;
}

export function ownsTask(user: RequestUser, assigneeId: number): void {
  if (!isAdmin(user) && (user.personId === null || user.personId !== assigneeId)) {
    throw new ApiError(403, "不能访问其他人员任务");
  }
}

export function userView(user: RequestUser) {
  return { id: user.id, username: user.username, role: user.role, person_id: user.personId };
}

/** 生成会话 token 并落库，返回 access_token 与用户信息。 */
export async function issueSession(user: Row, method: "PASSWORD" | "WECOM") {
  const token = randomBytes(32).toString("base64url");
  await execute(
    "INSERT INTO sessions(user_id,token_hash,expires_at,auth_method) VALUES(?,?,?,?)",
    Number(user.id),
    sha256(token),
    new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    method,
  );
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 43200,
    user: userView(principal(user)),
  };
}

export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token || !token.trim()) return;
  await execute("UPDATE sessions SET revoked=TRUE WHERE token_hash=?", sha256(token));
}

export function userActive(row: Row): boolean {
  return bool(row.active);
}
