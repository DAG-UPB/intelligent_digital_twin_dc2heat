/** Replay windows: which spans are offered, the default one, and the visible range around the playhead. */
import { expect, test } from "vitest";
import { ALL, defaultWindow, viewRange, windowsFor } from "./windows";

test("hourly data drops spans under 10 steps (10 min, 1 h, 6 h) and keeps a week as 168 steps", () => {
  const w = windowsFor(3600, 10000);
  expect(w.map((x) => x.label)).toEqual(["24 h", "7 d", "30 d", "3 mo", "1 y"]);
  expect(w.find((x) => x.label === "7 d")?.steps).toBe(168);
  expect(defaultWindow(w)).toBe(168);
});

test("spans as long as the data are dropped; the default falls back to the longest, then All", () => {
  const w = windowsFor(3600, 100);
  expect(w.map((x) => x.steps)).toEqual([24]);
  expect(defaultWindow(w)).toBe(24);
  expect(defaultWindow([])).toBe(ALL);
});

test("the view starts half a window before the playhead and is clamped to the data", () => {
  expect(viewRange(100, 24, 1000)).toEqual([88, 112]);
  expect(viewRange(3, 24, 1000)).toEqual([0, 24]);
  expect(viewRange(990, 24, 1000)).toEqual([978, 999]);
});
