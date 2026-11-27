import type { Route } from "./dispatch";
import { llmView, reviewLlm, saveLlm, settingsView } from "./handlers/settings";

/** /api/v1/settings 相关路由（对应 Spring 的 SettingsController 与 LlmSettingsController）。 */
export const routes: Route[] = [
  { method: "GET", path: "settings", handler: (ctx) => settingsView(ctx) },
  { method: "GET", path: "settings/llm", handler: (ctx) => llmView(ctx) },
  { method: "PUT", path: "settings/llm", handler: (ctx) => saveLlm(ctx) },
  { method: "POST", path: "settings/llm/review", handler: (ctx) => reviewLlm(ctx) },
];
