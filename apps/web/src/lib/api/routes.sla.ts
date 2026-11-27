import type { Route } from "./dispatch";
import { changePriority, createPolicy, listPolicies, pauseSla, resumeSla, slaView, updatePolicy } from "./handlers/sla";

/** /api/v1 下的 SLA 策略与任务 SLA 路由。 */
export const routes: Route[] = [
  { method: "GET", path: "sla/policies", handler: listPolicies },
  { method: "POST", path: "sla/policies", handler: createPolicy },
  { method: "PUT", path: "sla/policies/:id", handler: updatePolicy },
  { method: "GET", path: "tasks/:id/sla", handler: slaView },
  { method: "POST", path: "tasks/:id/sla/pause", handler: pauseSla },
  { method: "POST", path: "tasks/:id/sla/resume", handler: resumeSla },
  { method: "POST", path: "tasks/:id/priority", handler: changePriority },
];
