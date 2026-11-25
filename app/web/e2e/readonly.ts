/**
 * The E2E specs run against the real app and its git-tracked sim data, so every spec calls `readOnly` first:
 * any /api request that is not a GET is aborted before it is sent, except the pure compute endpoints (POST, but
 * nothing is written) and the live link (the page reporting its screen, answering the assistant and connecting it
 * with Connect AI's code: no file is written). Evaluate goes through without its `store` (the page asks to store its
 * answer beside the models): a spec never writes it.
 * A spec that mocks a write (page.route) still gets it: page routes win over context routes.
 */
import type { BrowserContext } from "@playwright/test";
import { COMPUTE_ONLY } from "../src/api/http";

const LIVE = /\/api\/live\/(ui|answer\/[0-9a-f]+|pair-code|pair)(\?|$)/;
export const COMPUTE = { test: (url: string) => COMPUTE_ONLY.test(url) || LIVE.test(url) };

const EVALUATE = /\/models\/evaluate(\?|$)/;

export const readOnly = (context: BrowserContext) =>
  context.route("**/api/**", (r) => {
    const q = r.request();
    if (q.method() !== "GET" && !COMPUTE.test(q.url())) return r.abort();
    return EVALUATE.test(q.url()) ? r.fallback({ postData: JSON.stringify({ ...q.postDataJSON(), store: false }) }) : r.fallback();
  });
