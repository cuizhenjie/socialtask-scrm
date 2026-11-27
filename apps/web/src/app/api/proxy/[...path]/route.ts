import { NextRequest, NextResponse } from "next/server";
import { dispatch } from "@/lib/api/dispatch";

const ALLOWED = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const method = request.method;
  if (!ALLOWED.has(method)) return Response.json({ error: "不支持的请求方法" }, { status: 405 });
  const origin = request.headers.get("origin");
  if (method !== "GET" && origin && origin !== request.nextUrl.origin) {
    return Response.json({ error: "跨站请求已拦截" }, { status: 403 });
  }
  const token = request.cookies.get("socialtask_session")?.value ?? null;
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  const { path } = await context.params;
  if (!path || path.some((item) => item === ".." || item === "." || !/^[\w-]+$/.test(item))) {
    return Response.json({ error: "无效接口路径" }, { status: 400 });
  }
  // 认证接口只走 /api/auth/*，不经过通用代理。
  if (path[0] === "auth") return Response.json({ error: "不支持的接口路径" }, { status: 403 });
  return dispatch(request, path, { token });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
