import { beforeEach, expect, test } from "vitest";
import { isStaleBuild, justReloaded, RELOAD_GAP_MS, reloadForNewBuild } from "./staleBuild";

beforeEach(() => sessionStorage.clear());

test("a page file of an older build is told from other errors, in every browser's words", () => {
  expect(isStaleBuild(new TypeError("Failed to fetch dynamically imported module: http://localhost:7600/assets/TrainPage-Bbucgt_t.js"))).toBe(true);
  expect(isStaleBuild(new TypeError("Importing a module script failed."))).toBe(true); // Safari
  expect(isStaleBuild(new TypeError("error loading dynamically imported module: http://x/a.js"))).toBe(true); // Firefox
  expect(isStaleBuild(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  expect(isStaleBuild(new Error("Cannot read properties of undefined"))).toBe(false);
  expect(isStaleBuild(null)).toBe(false);
});

test("it reloads once, not again within the gap (no loop when the file is missing for another reason)", () => {
  let reloads = 0;
  const reload = () => reloads++;
  expect(reloadForNewBuild(1_000_000, reload)).toBe(true);
  expect(reloadForNewBuild(1_000_000 + RELOAD_GAP_MS - 1, reload)).toBe(false);
  expect(reloads).toBe(1);
  expect(reloadForNewBuild(1_000_000 + RELOAD_GAP_MS, reload)).toBe(true); // a later rebuild: again
  expect(reloads).toBe(2);
  // right after it, a file still missing is not an older build's (the error box says so)
  expect(justReloaded(1_000_000 + RELOAD_GAP_MS + 10)).toBe(true);
  expect(justReloaded(1_000_000 + 2 * RELOAD_GAP_MS)).toBe(false);
});
