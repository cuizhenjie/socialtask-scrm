import { ApiError, errorResponse, jsonResponse } from "./errors";
import { requireUser, type RequestUser } from "./context";
import { routes } from "./routes";

export type Ctx = {
  request: Request;
  user: RequestUser | null;
  token: string | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
};

export type Route = {
  method: string;
  /** 例如 "tasks/:id/review" */
  path: string;
  /** true 表示无需登录 */
  open?: boolean;
  /** true 表示请求体是 multipart/二进制，dispatch 不解析 JSON */
  raw?: boolean;
  handler: (ctx: Ctx) => Promise<unknown> | unknown;
};

function match(method: string, segments: string[]) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const parts = route.path.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith(":")) params[part.slice(1)] = segments[i];
      else if (part !== segments[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export async function dispatch(
  request: Request,
  segments: string[],
  options: { token?: string | null } = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  const hit = match(method, segments);
  if (!hit) return jsonResponse({ error: "接口不存在" }, 404);
  const token = options.token ?? null;
  try {
    const user = hit.route.open ? null : await requireUser(request, token);
    let body: Record<string, unknown> = {};
    if (!hit.route.raw && method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      const text = await request.text();
      if (text) {
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new ApiError(400, "请求体不是合法 JSON");
        }
      }
    }
    const result = await hit.route.handler({
      request,
      user,
      token: token ?? null,
      params: hit.params,
      query: new URL(request.url).searchParams,
      body,
    });
    if (result instanceof Response) return result;
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
