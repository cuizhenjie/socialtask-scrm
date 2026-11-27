import type { Route } from "./dispatch";
import {
  cancelTask,
  createBatch,
  createTicket,
  getTask,
  listBatches,
  listMyTasks,
  listTasks,
  listTicketTemplates,
  publishTicketTemplate,
  reviewTask,
  submitTask,
  transferTask,
} from "./handlers/task";

/** /api/v1 下的任务、发布批次、服务工单与工单模板路由。 */
export const routes: Route[] = [
  { method: "GET", path: "publish-batches", handler: listBatches },
  { method: "POST", path: "publish-batches", handler: createBatch },
  { method: "GET", path: "tasks", handler: listTasks },
  { method: "GET", path: "me/tasks", handler: listMyTasks },
  { method: "POST", path: "tickets", handler: createTicket },
  { method: "GET", path: "tasks/:id", handler: getTask },
  { method: "POST", path: "tasks/:id/submissions", handler: submitTask },
  { method: "POST", path: "tasks/:id/review", handler: reviewTask },
  { method: "POST", path: "tasks/:id/transfer", handler: transferTask },
  { method: "POST", path: "tasks/:id/cancel", handler: cancelTask },
  { method: "GET", path: "ticket-templates", handler: listTicketTemplates },
  { method: "POST", path: "ticket-templates", handler: publishTicketTemplate },
];
