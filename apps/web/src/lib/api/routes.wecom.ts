import type { Route } from "./dispatch";
import {
  wecomCallbackReceive,
  wecomCallbackVerify,
  wecomConfig,
  wecomConversationTickets,
  wecomCreateTicket,
  wecomDownloadMedia,
  wecomMarkRead,
  wecomMessages,
  wecomOAuthExchange,
  wecomOAuthStart,
  wecomReply,
  wecomReplyMedia,
  wecomThreads,
} from "./handlers/wecom";

/** /api/v1/wecom 与内部 /api/v1/auth/wecom 相关路由。 */
export const routes: Route[] = [
  { method: "GET", path: "wecom/config", handler: (ctx) => wecomConfig(ctx) },
  { method: "GET", path: "wecom/inbox/conversations", handler: (ctx) => wecomThreads(ctx) },
  { method: "GET", path: "wecom/inbox/conversations/:id/messages", handler: (ctx) => wecomMessages(ctx) },
  { method: "GET", path: "wecom/inbox/conversations/:conversationId/tickets", handler: (ctx) => wecomConversationTickets(ctx) },
  { method: "POST", path: "wecom/inbox/conversations/:conversationId/tickets", handler: (ctx) => wecomCreateTicket(ctx) },
  { method: "POST", path: "wecom/inbox/conversations/:id/read", handler: (ctx) => wecomMarkRead(ctx) },
  { method: "POST", path: "wecom/inbox/conversations/:id/reply", handler: (ctx) => wecomReply(ctx) },
  { method: "POST", path: "wecom/inbox/conversations/:id/reply-media", raw: true, handler: (ctx) => wecomReplyMedia(ctx) },
  { method: "GET", path: "wecom/inbox/messages/:id/media", handler: (ctx) => wecomDownloadMedia(ctx) },
  { method: "GET", path: "wecom/callback", open: true, handler: (ctx) => wecomCallbackVerify(ctx) },
  { method: "POST", path: "wecom/callback", open: true, raw: true, handler: (ctx) => wecomCallbackReceive(ctx) },
  { method: "POST", path: "auth/wecom/start", open: true, handler: ({ body }) => wecomOAuthStart(body) },
  { method: "POST", path: "auth/wecom/exchange", open: true, handler: ({ body }) => wecomOAuthExchange(body) },
];
