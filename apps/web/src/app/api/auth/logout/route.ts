import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/lib/api/context";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("socialtask_session")?.value;
  try {
    await revokeSession(token);
  } catch {
    // 登出必须始终清理本地 Cookie，不受后端可用性影响。
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("socialtask_session");
  return response;
}
