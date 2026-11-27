import type { Route } from "./dispatch";
import { auditLogs, notificationRetry, notificationsList } from "./handlers/notification";

/** /api/v1 通知与审计接口。 */
export const routes: Route[] = [
  { method: "GET", path: "notifications", handler: (ctx) => notificationsList(ctx) },
  { method: "POST", path: "notifications/:id/retry", handler: (ctx) => notificationRetry(ctx) },
  { method: "GET", path: "audit-logs", handler: (ctx) => auditLogs(ctx) },
];
