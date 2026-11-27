import type { Route } from "./dispatch";
import { contentList, createContent, reviewContent } from "./handlers/content";

export const routes: Route[] = [
  { method: "GET", path: "content-packages", handler: (ctx) => contentList(ctx) },
  { method: "POST", path: "content-packages", handler: (ctx) => createContent(ctx) },
  { method: "POST", path: "content-packages/:id/review", handler: (ctx) => reviewContent(ctx) },
];
