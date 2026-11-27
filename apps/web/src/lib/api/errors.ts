export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 唯一键冲突（对应 Java 的 DuplicateKeyException / 409）。 */
export class DbConflictError extends Error {}

/** 关联或约束冲突（对应 Java 的 DataIntegrityViolationException / 409）。 */
export class DbIntegrityError extends Error {}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof DbConflictError || error instanceof DbIntegrityError) {
    return Response.json({ error: "唯一性或关联约束冲突，请刷新后重试" }, { status: 409 });
  }
  if (error instanceof SyntaxError) {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (error instanceof Error && error.message.startsWith("SQL ")) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  console.error("[api] unexpected error", error);
  return Response.json({ error: "服务器内部错误" }, { status: 500 });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data === undefined ? {} : data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function readBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
