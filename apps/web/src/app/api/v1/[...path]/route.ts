import { NextRequest } from "next/server";
import { dispatch } from "@/lib/api/dispatch";
import { bearerToken } from "@/lib/api/context";

/**
 * 对外直连入口（机器调用 / 企业微信回调）。
 * 浏览器仍走 /api/proxy/*（带会话 Cookie + 同源校验）。
 */
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path || path.some((item) => item === ".." || item === "." || !/^[\w-]+$/.test(item))) {
    return Response.json({ error: "无效接口路径" }, { status: 400 });
  }
  const token = bearerToken(request);
  return dispatch(request, path, { token });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
