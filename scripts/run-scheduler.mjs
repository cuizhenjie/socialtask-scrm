import { setTimeout as delay } from "node:timers/promises";

if (process.env.SCHEDULER_ENABLED === "false") {
  console.info("Scheduler disabled");
  const keepAlive = setInterval(() => {}, 2 ** 30);
  await new Promise(resolve => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  clearInterval(keepAlive);
  process.exit(0);
}
const secret = process.env.CRON_SECRET?.trim() ?? "";
if (secret.length < 32) throw new Error("Set CRON_SECRET to a random secret of at least 32 characters");
const url = process.env.SOCIALTASK_SCHEDULER_URL ?? "http://127.0.0.1:3000/api/internal/scheduler";
if (!url.endsWith("/api/internal/scheduler")) throw new Error("Invalid scheduler URL");
for (;;) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "error",
      signal: AbortSignal.timeout(310_000),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      console.error("Scheduler HTTP", response.status, "failed jobs:", result.failed ?? []);
    }
  } catch {
    console.error("Scheduler could not reach Next.js");
  }
  await delay(60_000);
}
