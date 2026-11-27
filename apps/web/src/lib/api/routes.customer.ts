import type { Route } from "./dispatch";
import {
  addSegment,
  addTag,
  classifyCustomer,
  createCustomer,
  customerDetailRoute,
  customerDoNotContact,
  customerList,
  customerSegments,
  customerTags,
  customerTimeline,
  firstRound,
  updatePermission,
} from "./handlers/customer";

export const routes: Route[] = [
  { method: "GET", path: "customers", handler: (ctx) => customerList(ctx) },
  { method: "GET", path: "customers/segments", handler: (ctx) => customerSegments(ctx) },
  { method: "POST", path: "customers/segments", handler: (ctx) => addSegment(ctx) },
  { method: "GET", path: "customers/tags", handler: (ctx) => customerTags(ctx) },
  { method: "POST", path: "customers/tags", handler: (ctx) => addTag(ctx) },
  { method: "PUT", path: "customers/:id/classification", handler: (ctx) => classifyCustomer(ctx) },
  { method: "POST", path: "customers", handler: (ctx) => createCustomer(ctx) },
  { method: "GET", path: "customers/:id", handler: (ctx) => customerDetailRoute(ctx) },
  { method: "GET", path: "customers/:id/timeline", handler: (ctx) => customerTimeline(ctx) },
  { method: "POST", path: "customers/:id/contact-permission", handler: (ctx) => updatePermission(ctx) },
  { method: "POST", path: "customers/:id/do-not-contact", handler: (ctx) => customerDoNotContact(ctx) },
  { method: "POST", path: "customers/:id/contact-rounds", handler: (ctx) => firstRound(ctx) },
];
