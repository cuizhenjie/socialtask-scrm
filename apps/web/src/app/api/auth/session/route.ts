import { NextRequest, NextResponse } from "next/server";
import { authenticate, userView } from "@/lib/api/context";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("socialtask_session")?.value;
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const user = await authenticate(token);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const response = NextResponse.json(userView(user));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "后端连接失败" }, { status: 502 });
  }
}
