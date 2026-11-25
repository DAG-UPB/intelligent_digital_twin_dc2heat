import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `npm run dev` proxies API calls (and /health, which e2e/api.spec.ts reads) to the backend; `npm run build` writes dist/ for FastAPI to serve.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 7601,
    proxy: { "/api": "http://localhost:7600", "/health": "http://localhost:7600" },
    fs: { allow: [".", "../../wiki"] }, // the agent wiki, shown on the AI assistant page (WikiCard.tsx)
  },
  // unit tests live next to the code; e2e/ is Playwright's (npm run e2e)
  test: { include: ["src/**/*.test.ts"] },
});
