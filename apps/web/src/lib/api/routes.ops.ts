import type { Route } from "./dispatch";
import { opsTick } from "./handlers/ops";

export const routes: Route[] = [
  { method: "POST", path: "ops/tick", handler: (ctx) => opsTick(ctx) },
];
