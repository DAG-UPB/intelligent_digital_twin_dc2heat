/** The assistant page names the tools as the MCP server does (the route function) and marks what writes. */
import { expect, test } from "vitest";
import { toolsOf } from "./AssistantPage";

test("tool names are the route functions; GETs and compute-only POSTs read, other writes change things", () => {
  const spec = {
    paths: {
      "/api/live/ui-state": { get: { operationId: "ui_state_api_live_ui_state_get", summary: "What the user sees" } },
      "/api/live/command": { post: { operationId: "ui_do_api_live_command_post", summary: "Do something" } },
      "/api/components/check": { post: { operationId: "check_component_api_components_check_post", summary: "Check" } },
    },
  };
  expect(toolsOf(spec)).toEqual([
    { name: "ui_state", summary: "What the user sees", writes: false },
    { name: "ui_do", summary: "Do something", writes: true },
    { name: "check_component", summary: "Check", writes: false },
  ]);
});
