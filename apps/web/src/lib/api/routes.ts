import type { Route } from "./dispatch";
import { health, login, logout, me } from "./handlers/auth";
import { routes as peopleRoutes } from "./routes.people";
import { routes as settingsRoutes } from "./routes.settings";
import { routes as taskRoutes } from "./routes.task";
import { routes as slaRoutes } from "./routes.sla";
import { routes as customerRoutes } from "./routes.customer";
import { routes as contentRoutes } from "./routes.content";
import { routes as workRoutes } from "./routes.work";
import { routes as analyticsRoutes } from "./routes.analytics";
import { routes as reportRoutes } from "./routes.report";
import { routes as wecomRoutes } from "./routes.wecom";
import { routes as kfRoutes } from "./routes.kf";
import { routes as notificationRoutes } from "./routes.notification";
import { routes as storageRoutes } from "./routes.storage";
import { routes as opsRoutes } from "./routes.ops";

/** 所有 /api/v1 与 /api/proxy 共用的路由表。 */
export const routes: Route[] = [
  { method: "GET", path: "health", open: true, handler: () => health() },
  { method: "POST", path: "auth/login", open: true, handler: ({ body }) => login(body) },
  { method: "POST", path: "auth/logout", open: true, handler: (ctx) => logout(ctx) },
  { method: "GET", path: "me", handler: (ctx) => me(ctx) },
  ...peopleRoutes,
  ...settingsRoutes,
  ...taskRoutes,
  ...slaRoutes,
  ...customerRoutes,
  ...contentRoutes,
  ...workRoutes,
  ...analyticsRoutes,
  ...reportRoutes,
  ...wecomRoutes,
  ...kfRoutes,
  ...notificationRoutes,
  ...storageRoutes,
  ...opsRoutes,
];
