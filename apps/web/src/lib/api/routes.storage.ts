import type { Route } from "./dispatch";
import { attachmentDownload, attachmentUpload } from "./handlers/storage";

/** /api/v1/attachments 附件接口。 */
export const routes: Route[] = [
  { method: "POST", path: "attachments", raw: true, handler: (ctx) => attachmentUpload(ctx) },
  { method: "GET", path: "attachments/:id", handler: (ctx) => attachmentDownload(ctx) },
];
