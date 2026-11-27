import type { Route } from "./dispatch";
import { kfConversations, kfMessages, kfState, kfSync } from "./handlers/kf";

/** /api/v1/kf 微信客服只读接口。 */
export const routes: Route[] = [
  { method: "GET", path: "kf/state", handler: (ctx) => kfState(ctx) },
  { method: "POST", path: "kf/sync", handler: (ctx) => kfSync(ctx, ctx.body.confirm === true) },
  { method: "GET", path: "kf/conversations", handler: (ctx) => kfConversations(ctx) },
  { method: "GET", path: "kf/conversations/:peer/messages", handler: (ctx) => kfMessages(ctx) },
];
