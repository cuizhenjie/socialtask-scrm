import type { Route } from "./dispatch";
import { addComment, commentList, createOfficialCommentTaskRoute, workComments, workList } from "./handlers/work";

export const routes: Route[] = [
  { method: "GET", path: "works", handler: (ctx) => workList(ctx) },
  { method: "GET", path: "comments", handler: (ctx) => commentList(ctx) },
  { method: "GET", path: "works/:id/comments", handler: (ctx) => workComments(ctx) },
  { method: "POST", path: "works/:id/comments", handler: (ctx) => addComment(ctx) },
  { method: "POST", path: "works/:id/comment-tasks", handler: (ctx) => createOfficialCommentTaskRoute(ctx) },
];
