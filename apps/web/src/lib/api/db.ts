import { DbConflictError, DbIntegrityError, ApiError } from "./errors";

/**
 * Supabase PostgREST 数据访问层（与 services/api 的 Db.java 等价）。
 * 只允许在服务端 Route Handler 中调用：使用 SUPABASE_SERVICE_ROLE_KEY，绝不下发浏览器。
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || "").trim();
const RPC_PATH = (() => {
  let path = (process.env.SUPABASE_RPC_PATH || "/rest/v1/rpc").trim();
  if (!path.startsWith("/")) path = "/" + path;
  return path.replace(/\/+$/, "");
})();
const RPC_BASE = SUPABASE_URL ? `${SUPABASE_URL}${RPC_PATH}/` : "";

export type Row = Record<string, unknown>;

export function dbConfigured(): boolean {
  return Boolean(RPC_BASE && SERVICE_KEY);
}

function sqlState(body: string): string | null {
  try {
    const node = JSON.parse(body) as { code?: unknown };
    return typeof node.code === "string" ? node.code : null;
  } catch {
    return null;
  }
}

function abbreviate(text: string | null): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 300 ? flat : flat.slice(0, 300) + "…";
}

async function call(fn: "api_query" | "api_exec", sql: string): Promise<string> {
  if (!dbConfigured()) {
    throw new ApiError(503, "未配置 Supabase 数据网关：请设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY");
  }
  let response: Response;
  try {
    response = await fetch(`${RPC_BASE}${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_sql: sql }),
      cache: "no-store",
    });
  } catch (error) {
    throw new ApiError(502, `Supabase 数据网关不可用：${(error as Error).message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    const state = sqlState(body);
    if (state === "23505") throw new DbConflictError(abbreviate(body));
    if (state && state.startsWith("23")) throw new DbIntegrityError(abbreviate(body));
    throw new ApiError(502, `Supabase 数据网关返回 ${response.status}：${abbreviate(body)}`);
  }
  return body;
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("非法数值参数");
    return String(value);
  }
  if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`;
  if (value instanceof Uint8Array) {
    const hex = Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
    return `'\\x${hex}'::bytea`;
  }
  if (Array.isArray(value) || typeof value === "object") {
    throw new Error("请先用 json() 把集合转换为 JSON 字符串再作为参数传入");
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 将 `?` 占位符替换为转义后的 PostgreSQL 字面量，跳过字符串内部的问号。 */
export function bind(sql: string, params: unknown[] = []): string {
  let out = "";
  let index = 0;
  let quote = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) {
        if (sql[i + 1] === quote) {
          out += sql[++i];
        } else {
          quote = "";
        }
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    if (c === "?") {
      if (index >= params.length) throw new Error("SQL 占位符数量多于参数数量");
      out += literal(params[index++]);
      continue;
    }
    out += c;
  }
  if (index !== params.length) throw new Error("SQL 占位符数量与参数数量不一致");
  return out;
}

function normalize(row: Row): Row {
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && typeof value === "object") row[key] = JSON.stringify(value);
  }
  return row;
}

export async function list(sql: string, ...params: unknown[]): Promise<Row[]> {
  const body = await call("api_query", bind(sql, params));
  if (!body.trim()) return [];
  const rows = JSON.parse(body) as Row[];
  return (rows || []).map(normalize);
}

export async function optional(sql: string, ...params: unknown[]): Promise<Row | null> {
  const rows = await list(sql, ...params);
  return rows.length ? rows[0] : null;
}

export async function one(sql: string, ...params: unknown[]): Promise<Row> {
  const row = await optional(sql, ...params);
  if (!row) throw new ApiError(404, "记录不存在");
  return row;
}

export async function execute(sql: string, ...params: unknown[]): Promise<number> {
  const body = await call("api_exec", bind(sql, params));
  const value = Number.parseInt(body.trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

export async function insert(sql: string, ...params: unknown[]): Promise<number> {
  let statement = sql.trim();
  if (!statement.toUpperCase().includes("RETURNING")) statement = statement.replace(/;\s*$/, "") + " RETURNING id";
  const rows = await list(statement, ...params);
  const id = rows[0]?.id;
  if (id === undefined || id === null) throw new Error("INSERT 未返回主键");
  return Number(id);
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function object(value: unknown): Row {
  if (value === null || value === undefined) return {};
  if (typeof value === "object") return { ...(value as Row) };
  return JSON.parse(String(value)) as Row;
}

export const id = (row: Row): number => Number(row.id);
export const num = (value: unknown): number => Number(value);
export const bool = (value: unknown): boolean =>
  typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : value === "true";
export const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export function instant(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = String(value);
  let date = new Date(text);
  if (Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d(?:\.\d+)?$/.test(text)) {
    date = new Date(text + "Z");
  }
  if (Number.isNaN(date.getTime())) throw new Error(`非法时间：${text}`);
  return date;
}

export function stamp(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function required(value: unknown, label: string, max: number): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (!text || text.length > max) throw new ApiError(400, `${label}不能为空或过长`);
  return text;
}

export function ensure(condition: unknown, message: string): void {
  if (!condition) throw new ApiError(409, message);
}

export function badIf(condition: unknown, message: string): void {
  if (condition) throw new ApiError(400, message);
}
