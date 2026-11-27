import bcrypt from "bcryptjs";
import { DbConflictError, DbIntegrityError, ApiError } from "../errors";
import { execute, insert, list, one, optional, required, str } from "../db";
import { requireAdmin } from "../context";
import type { Ctx } from "../dispatch";

/** 人员、分组、标签与社交账号档案（对应 Spring 的 PeopleController/PeopleService）。 */

const PERSON_TYPES = ["author", "creator", "assistant", "support"];
const ROLES = ["admin", "manager", "author", "creator", "assistant", "support"];

function pathId(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new ApiError(400, "参数有误");
  return value;
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === "";
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

function normalizeType(raw: string | null): string {
  if (raw === null) return "";
  const value = raw.trim().toLowerCase();
  switch (value) {
    case "author":
    case "作者":
      return "author";
    case "creator":
    case "素人":
    case "创作者":
    case "合作创作者":
      return "creator";
    case "assistant":
    case "助理":
    case "官方助理":
      return "assistant";
    case "support":
    case "客服":
    case "授权客服":
      return "support";
    default:
      return value;
  }
}

function trustedDouyinHost(host: string): boolean {
  const value = host.toLowerCase();
  return (
    value === "douyin.com" ||
    value.endsWith(".douyin.com") ||
    value === "iesdouyin.com" ||
    value.endsWith(".iesdouyin.com")
  );
}

function canonicalProfileDouyin(input: string): string {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !host ||
      !trustedDouyinHost(host) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname === "" ||
      url.pathname === "/"
    ) {
      throw new Error("invalid");
    }
    return "https://" + host + url.pathname.replace(/\/+$/, "");
  } catch {
    throw new ApiError(400, "需要人工核验且为 HTTPS 的抖音账号主页");
  }
}

async function checkedWecom(userid: string | null, excluding: number | null): Promise<void> {
  if (blank(userid)) return;
  const value = userid as string;
  if (value.length > 120) throw new ApiError(400, "企业微信 UserID 过长");
  const existing =
    excluding === null
      ? await optional("SELECT id FROM people WHERE wecom_userid=? LIMIT 1", value)
      : await optional("SELECT id FROM people WHERE wecom_userid=? AND id<>? LIMIT 1", value, excluding);
  if (existing) throw new ApiError(409, "企业微信 UserID 已绑定其他人员，请复用同一人员档案下的社交账号");
}

async function checkedGroup(group: string): Promise<string> {
  const normalized = required(group, "分组", 100);
  const row = await optional("SELECT id FROM people_groups WHERE name=? AND active=TRUE", normalized);
  if (!row) throw new ApiError(400, "分组尚未创建，请先在分组管理中添加");
  return normalized;
}

async function createUser(username: string | null, password: string | null, role: string | null, personId: number): Promise<number> {
  const name = required(username, "用户名", 80);
  if (password === null || password.length < 12 || password.length > 128) {
    throw new ApiError(400, "密码至少 12 位，至多 128 位");
  }
  if (role === null || !ROLES.includes(role)) throw new ApiError(400, "角色不合法");
  const hash = await bcrypt.hash(password, 12);
  return insert("INSERT INTO users(username,password_hash,role,person_id) VALUES(?,?,?,?)", name, hash, role, personId);
}

export async function listPeople(ctx: Ctx) {
  requireAdmin(ctx.user!);
  let sql =
    "SELECT p.*, (SELECT STRING_AGG(t.name, ',' ORDER BY t.name) FROM people_tag_links l JOIN tags t ON t.id=l.tag_id WHERE l.person_id=p.id) AS tag_names, (SELECT STRING_AGG(l.tag_id::text, ',' ORDER BY l.tag_id) FROM people_tag_links l WHERE l.person_id=p.id) AS tag_ids FROM people p WHERE 1=1";
  const args: unknown[] = [];
  const q = ctx.query.get("q");
  if (q !== null && q.trim() !== "") {
    sql += " AND (p.name LIKE ? OR p.person_no LIKE ? OR p.wecom_userid LIKE ?)";
    const like = "%" + q.trim() + "%";
    args.push(like, like, like);
  }
  const role = ctx.query.get("role");
  if (role !== null && role.trim() !== "") {
    sql += " AND p.person_type=?";
    args.push(role);
  }
  const group = ctx.query.get("group");
  if (group !== null && group.trim() !== "") {
    sql += " AND p.group_name=?";
    args.push(group);
  }
  const status = ctx.query.get("status");
  if (status !== null && status.trim() !== "") {
    sql += " AND p.status=?";
    args.push(status);
  }
  const tagRaw = ctx.query.get("tagId");
  if (tagRaw !== null && tagRaw.trim() !== "") {
    const tagId = Number(tagRaw);
    if (!Number.isInteger(tagId)) throw new ApiError(400, "参数有误");
    sql += " AND EXISTS(SELECT 1 FROM people_tag_links l WHERE l.person_id=p.id AND l.tag_id=?)";
    args.push(tagId);
  }
  sql += " ORDER BY p.id DESC LIMIT 500";
  return list(sql, ...args);
}

export async function listGroups(ctx: Ctx) {
  requireAdmin(ctx.user!);
  return list(
    "SELECT g.*, (SELECT COUNT(*) FROM people p WHERE p.group_name=g.name) AS person_count FROM people_groups g ORDER BY g.id",
  );
}

export async function listTags(ctx: Ctx) {
  requireAdmin(ctx.user!);
  return list(
    "SELECT t.*, (SELECT COUNT(*) FROM people_tag_links l WHERE l.tag_id=t.id) AS person_count FROM tags t ORDER BY t.id",
  );
}

export async function createGroup(ctx: Ctx) {
  const user = requireAdmin(ctx.user!);
  const name = required(ctx.body.name, "分组名称", 100);
  const description = blank(textValue(ctx.body.description)) ? "" : (textValue(ctx.body.description) as string).trim();
  const id = await insert("INSERT INTO people_groups(name,description) VALUES(?,?)", name, description);
  await record(user.id, "people_group", id, "CREATE", { name });
  return one("SELECT * FROM people_groups WHERE id=?", id);
}

export async function createTag(ctx: Ctx) {
  const user = requireAdmin(ctx.user!);
  const name = required(ctx.body.name, "标签名称", 60);
  const id = await insert("INSERT INTO tags(name) VALUES(?)", name);
  await record(user.id, "tag", id, "CREATE", { name });
  return one("SELECT * FROM tags WHERE id=?", id);
}

export async function setPersonTags(ctx: Ctx) {
  const user = requireAdmin(ctx.user!);
  const personId = pathId(ctx.params.id);
  await one("SELECT id FROM people WHERE id=? FOR UPDATE", personId);

  const raw = ctx.body.tagIds;
  if (raw === null || raw === undefined || !Array.isArray(raw)) {
    throw new ApiError(400, "单人最多 30 个不同标签");
  }
  const values = raw as unknown[];
  const ids = values.map((item) => (item === null || item === undefined ? Number.NaN : Number(item)));
  if (ids.length > 30 || new Set(ids).size !== ids.length) {
    throw new ApiError(400, "单人最多 30 个不同标签");
  }
  for (const tagId of ids) {
    if (!Number.isInteger(tagId)) throw new ApiError(400, "标签编号错误");
    await one("SELECT id FROM tags WHERE id=?", tagId);
  }
  await execute("DELETE FROM people_tag_links WHERE person_id=?", personId);
  for (const tagId of ids) await execute("INSERT INTO people_tag_links(person_id,tag_id) VALUES(?,?)", personId, tagId);
  await record(user.id, "person", personId, "SET_TAGS", { tag_ids: ids });
  return one(
    "SELECT p.*,(SELECT STRING_AGG(t.name, ',' ORDER BY t.name) FROM people_tag_links l JOIN tags t ON t.id=l.tag_id WHERE l.person_id=p.id) AS tag_names FROM people p WHERE p.id=?",
    personId,
  );
}

export async function listAssignees(ctx: Ctx) {
  requireAdmin(ctx.user!);
  return list("SELECT id,person_no,name,person_type,group_name,wecom_userid FROM people WHERE status='ACTIVE' ORDER BY person_no");
}

export async function createPerson(ctx: Ctx) {
  const actor = requireAdmin(ctx.user!);
  const personNo = required(ctx.body.personNo, "人员编号", 40);
  const name = required(ctx.body.name, "人员名称", 120);
  const wecomRaw = textValue(ctx.body.wecomUserId);
  const wecom = blank(wecomRaw) ? null : (wecomRaw as string).trim();
  await checkedWecom(wecom, null);
  const type = normalizeType(textValue(ctx.body.personType));
  if (!PERSON_TYPES.includes(type)) throw new ApiError(400, "人员类型无效");
  const idTypeRaw = textValue(ctx.body.identityType);
  const idType = blank(idTypeRaw) ? "合作账号" : required(idTypeRaw, "身份类型", 40);
  const groupRaw = textValue(ctx.body.groupName);
  const groupName = await checkedGroup(blank(groupRaw) ? "第一组" : (groupRaw as string));

  const id = await insert(
    "INSERT INTO people(person_no,name,person_type,group_name,wecom_userid,identity_type) VALUES(?,?,?,?,?,?)",
    personNo,
    name,
    type,
    groupName,
    wecom,
    idType,
  );
  await record(actor.id, "person", id, "CREATE", { person_no: personNo });
  return one("SELECT * FROM people WHERE id=?", id);
}

export async function bulkImportPeople(ctx: Ctx) {
  const actor = requireAdmin(ctx.user!);
  const rawRows = ctx.body.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new ApiError(400, "导入名单不能为空");
  if (rawRows.length > 500) throw new ApiError(400, "单次最多导入 500 条人员记录");

  const imported: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];
  for (let index = 0; index < rawRows.length; index++) {
    const rowNum = index + 1;
    const rawRow: unknown = rawRows[index];
    const row = rawRow !== null && typeof rawRow === "object" && !Array.isArray(rawRow) ? (rawRow as Record<string, unknown>) : null;
    const rawNo = row === null ? "" : (textValue(row.personNo) ?? "").trim();
    try {
      if (row === null) throw new ApiError(400, "空行");
      const personNo = required(row.personNo, "人员编号", 40);
      const name = required(row.name, "人员名称", 120);
      const type = normalizeType(textValue(row.personType));
      if (!PERSON_TYPES.includes(type)) {
        throw new ApiError(400, "人员类型无效（支持 author/creator/assistant/support 或 作者/素人/官方助理/客服）");
      }
      const groupRaw = textValue(row.groupName);
      const groupName = await checkedGroup(blank(groupRaw) ? "第一组" : (groupRaw as string));
      const wecomRaw = textValue(row.wecomUserId);
      const wecom = blank(wecomRaw) ? null : (wecomRaw as string).trim();
      await checkedWecom(wecom, null);
      const idTypeRaw = textValue(row.identityType);
      const idType = blank(idTypeRaw) ? "合作账号" : required(idTypeRaw, "身份类型", 40);
      const existing = await optional("SELECT id FROM people WHERE person_no=? LIMIT 1", personNo);
      if (existing) throw new ApiError(409, "人员编号已存在，未覆盖历史档案");
      const id = await insert(
        "INSERT INTO people(person_no,name,person_type,group_name,wecom_userid,identity_type) VALUES(?,?,?,?,?,?)",
        personNo,
        name,
        type,
        groupName,
        wecom,
        idType,
      );
      imported.push({ row: rowNum, id, person_no: personNo, name });
    } catch (error) {
      if (error instanceof ApiError) {
        errors.push({ row: rowNum, person_no: rawNo, error: error.message });
      } else if (error instanceof DbIntegrityError || error instanceof DbConflictError) {
        errors.push({ row: rowNum, person_no: rawNo, error: "人员编号或企业微信 UserID 冲突，未覆盖历史档案" });
      } else {
        throw error;
      }
    }
  }
  await record(actor.id, "person", 0, "BULK_IMPORT", {
    total: rawRows.length,
    imported: imported.length,
    failed: errors.length,
  });
  return {
    total: rawRows.length,
    imported_count: imported.length,
    failed_count: errors.length,
    imported,
    errors,
  };
}

export async function updatePerson(ctx: Ctx) {
  const actor = requireAdmin(ctx.user!);
  const personId = pathId(ctx.params.id);
  const previous = await one("SELECT * FROM people WHERE id=? FOR UPDATE", personId);

  if (ctx.body.name !== null && ctx.body.name !== undefined) {
    await execute("UPDATE people SET name=? WHERE id=?", required(ctx.body.name, "名称", 120), personId);
  }
  if (ctx.body.status !== null && ctx.body.status !== undefined) {
    const status = String(ctx.body.status);
    if (status !== "ACTIVE" && status !== "INACTIVE") throw new ApiError(400, "状态错误");
    await execute("UPDATE people SET status=? WHERE id=?", status, personId);
    if (status === "INACTIVE") {
      await execute("UPDATE users SET active=FALSE WHERE person_id=?", personId);
      await execute(
        "UPDATE tasks SET status='PAUSED',next_remind_at=NULL WHERE assignee_id=? AND status IN ('PENDING','REWORK')",
        personId,
      );
      await execute("UPDATE sessions SET revoked=TRUE WHERE user_id IN (SELECT id FROM users WHERE person_id=?)", personId);
    }
  }
  if (ctx.body.groupName !== null && ctx.body.groupName !== undefined) {
    await execute("UPDATE people SET group_name=? WHERE id=?", await checkedGroup(String(ctx.body.groupName)), personId);
  }
  if (ctx.body.wecomUserId !== null && ctx.body.wecomUserId !== undefined) {
    const raw = String(ctx.body.wecomUserId);
    await checkedWecom(raw, personId);
    const next = raw.trim() === "" ? null : raw;
    await execute("UPDATE people SET wecom_userid=? WHERE id=?", next, personId);
    if (next !== str(previous.wecom_userid)) {
      await execute(
        "UPDATE sessions SET revoked=TRUE WHERE auth_method='WECOM' AND user_id IN (SELECT id FROM users WHERE person_id=?)",
        personId,
      );
    }
  }
  await record(actor.id, "person", personId, "UPDATE", { changed: true });
  return one("SELECT * FROM people WHERE id=?", personId);
}

export async function listAccounts(ctx: Ctx) {
  requireAdmin(ctx.user!);
  const personId = pathId(ctx.params.id);
  return list("SELECT * FROM social_accounts WHERE person_id=? ORDER BY id DESC", personId);
}

export async function createAccount(ctx: Ctx) {
  const actor = requireAdmin(ctx.user!);
  const personId = pathId(ctx.params.id);
  await one("SELECT id FROM people WHERE id=?", personId);
  const nickname = required(ctx.body.nickname, "账号昵称", 160);
  required(ctx.body.profileUrl, "主页链接", 600);
  const platformRaw = textValue(ctx.body.platform);
  const platform = platformRaw === null ? "douyin" : platformRaw.trim();
  if (platform !== "douyin") throw new ApiError(400, "首版仅支持抖音账号档案");
  const url = canonicalProfileDouyin(String(ctx.body.profileUrl));
  const externalUid = textValue(ctx.body.externalUid);
  const id = await insert(
    "INSERT INTO social_accounts(person_id,platform,nickname,external_uid,profile_url) VALUES(?,?,?,?,?)",
    personId,
    platform,
    nickname,
    externalUid,
    url,
  );
  await record(actor.id, "social_account", id, "BIND", { person_id: personId });
  return one("SELECT * FROM social_accounts WHERE id=?", id);
}

export async function createCredentials(ctx: Ctx) {
  const actor = requireAdmin(ctx.user!);
  const personId = pathId(ctx.params.id);
  const person = await one("SELECT * FROM people WHERE id=?", personId);
  if (str(person.status) !== "ACTIVE") throw new ApiError(409, "不能为停用人员创建账号");
  const type = str(person.person_type);
  const username = textValue(ctx.body.username);
  const id = await createUser(username, textValue(ctx.body.password), type, personId);
  await record(actor.id, "user", id, "PROVISION", { person_id: personId });
  return { id, username, role: type, person_id: personId };
}
