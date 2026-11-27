import type { Route } from "./dispatch";
import {
  bulkImportPeople,
  createAccount,
  createCredentials,
  createGroup,
  createPerson,
  createTag,
  listAccounts,
  listAssignees,
  listGroups,
  listPeople,
  listTags,
  setPersonTags,
  updatePerson,
} from "./handlers/people";

/** /api/v1/people 相关路由（对应 Spring 的 PeopleController）。 */
export const routes: Route[] = [
  { method: "GET", path: "people", handler: (ctx) => listPeople(ctx) },
  { method: "GET", path: "people/groups", handler: (ctx) => listGroups(ctx) },
  { method: "POST", path: "people/groups", handler: (ctx) => createGroup(ctx) },
  { method: "GET", path: "people/tags", handler: (ctx) => listTags(ctx) },
  { method: "POST", path: "people/tags", handler: (ctx) => createTag(ctx) },
  { method: "GET", path: "people/assignees", handler: (ctx) => listAssignees(ctx) },
  { method: "POST", path: "people", handler: (ctx) => createPerson(ctx) },
  { method: "POST", path: "people/import", handler: (ctx) => bulkImportPeople(ctx) },
  { method: "PATCH", path: "people/:id", handler: (ctx) => updatePerson(ctx) },
  { method: "PUT", path: "people/:id/tags", handler: (ctx) => setPersonTags(ctx) },
  { method: "GET", path: "people/:id/accounts", handler: (ctx) => listAccounts(ctx) },
  { method: "POST", path: "people/:id/accounts", handler: (ctx) => createAccount(ctx) },
  { method: "POST", path: "people/:id/credentials", handler: (ctx) => createCredentials(ctx) },
];
