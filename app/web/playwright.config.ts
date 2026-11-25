/** E2E smoke tests (npm run e2e) against a running app: E2E_BASE_URL, default the backend-served app on :7600. */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:7600",
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
  },
  // the app connects one agent at a time (a new pairing replaces the last): the assistant specs run one after another
  projects: [
    { name: "app", testIgnore: /assistant.*\.spec\.ts/ },
    { name: "assistant", testMatch: /assistant.*\.spec\.ts/, workers: 1 },
  ],
});
