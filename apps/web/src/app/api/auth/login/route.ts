import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/api/handlers/auth";
import { errorResponse } from "@/lib/api/errors";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  try {
    const result = await login(body);
    const response = NextResponse.json({ user: result.user, expires_in: result.expires_in });
    response.cookies.set("socialtask_session", result.access_token, {
      httpOnly: true,
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      sameSite: "lax",
      path: "/",
      maxAge: result.expires_in || 43200,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
