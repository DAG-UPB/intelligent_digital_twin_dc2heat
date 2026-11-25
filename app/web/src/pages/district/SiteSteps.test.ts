/** The Site panel's steps: done by what the site has, the first one not done the current one, the result at the end. */
import { expect, test } from "vitest";
import type { Site } from "../../api";
import { stepsOf } from "./SiteSteps";

const point = { id: "x", name: "x", lat: 0, lon: 0, temp_c: 30, power_kw: 100 };
const states = (site: Site | null, planned = false) => stepsOf(site, planned).map((s) => s.state);

test("each step is done by what the site has, the first one not done is the current one", () => {
  expect(states(null)).toEqual(["todo", "todo", "todo", "todo"]); // not loaded yet: none current
  expect(states({ building: null, source: null, sinks: [] })).toEqual(["current", "todo", "todo", "todo"]);
  expect(states({ building: null, source: point, sinks: [] })).toEqual(["done", "current", "todo", "todo"]);
  expect(states({ building: null, source: point, sinks: [point] })).toEqual(["done", "done", "current", "todo"]);
  expect(states({ building: null, source: point, sinks: [point] }, true)).toEqual(["done", "done", "done", "current"]); // the result
  expect(states({ building: null, source: null, sinks: [point] })).toEqual(["current", "done", "todo", "todo"]); // done out of order
});
