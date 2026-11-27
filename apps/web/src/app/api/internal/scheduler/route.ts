import { createHash, timingSafeEqual } from "node:crypto";
import { runOpsTick } from "@/lib/api/handlers/ops";
import { errorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

const digest = (value: string) => createHash("sha256").update(value).digest();

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (process.env.SCHEDULER_ENABLED === "false" || !secret || secret.length < 32) {
    return Response.json({ error: "定时任务未启用" }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }
  try {
    const result = await runOpsTick();
    if (Array.isArray(result.failed) && result.failed.length) return Response.json(result, { status: 502 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
