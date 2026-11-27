import type { Route } from "./dispatch";
import { ticketReport } from "./handlers/report";

export const routes: Route[] = [
  { method: "GET", path: "reports/tickets", handler: (ctx) => ticketReport(ctx) },
];
