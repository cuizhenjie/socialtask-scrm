import type { Route } from "./dispatch";
import { dashboard } from "./handlers/analytics";

export const routes: Route[] = [
  { method: "GET", path: "dashboard", handler: (ctx) => dashboard(ctx) },
];
