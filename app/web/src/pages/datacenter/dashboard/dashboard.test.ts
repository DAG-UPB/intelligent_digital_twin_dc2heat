import { describe, expect, test } from "vitest";
import type { VariableSummary } from "../../../api";
import { compact, corrFill, corrInk, defaultShown, duration, resolution, similarityOrder, sortVariables } from "./dashboard";

const v = (name: string, mean: number | null, std = 1): VariableSummary => ({
  name,
  role: "measured",
  count: 10,
  missing: 0,
  mean,
  std,
  min: 0,
  p25: 0,
  median: 0,
  p75: 0,
  max: 0,
  histogram: { edges: [], counts: [] },
});

describe("formatting", () => {
  test("compact numbers, dash for none", () => {
    expect(compact(12345.678)).toBe("12.346");
    expect(compact(1005.3)).toBe("1.005"); // not "1,005K": K would read as kelvin
    expect(compact(12_345_678)).toBe("12,35\u00a0Mio."); // a non-breaking space before the unit
    expect(compact(25.7199)).toBe("25,72");
    expect(compact(0.012345)).toBe("0,01235");
    expect(compact(-3)).toBe("-3");
    expect(compact(null)).toBe("–");
    expect(compact(NaN)).toBe("–");
  });

  test("durations and resolutions in the largest fitting unit", () => {
    expect(duration(17495)).toBe("2,0 years");
    expect(duration(24 * 36)).toBe("36 days");
    expect(duration(5.5)).toBe("5,5 h");
    expect(duration(0.25)).toBe("15 min");
    expect(resolution(3600)).toBe("1 h");
    expect(resolution(300)).toBe("5 min");
    expect(resolution(5)).toBe("5 s");
    expect(resolution(null)).toBe("–");
  });
});

test("sorting: numbers, names, both directions, empty values last", () => {
  const vars = [v("b", 2), v("a", null), v("c", 1)];
  expect(sortVariables(vars, "mean", 1).map((x) => x.name)).toEqual(["c", "b", "a"]);
  expect(sortVariables(vars, "mean", -1).map((x) => x.name)).toEqual(["b", "c", "a"]);
  expect(sortVariables(vars, "name", 1).map((x) => x.name)).toEqual(["a", "b", "c"]);
  expect(vars.map((x) => x.name)).toEqual(["b", "a", "c"]); // not sorted in place
});

test("diverging colour scale: pole by sign, strength by |r|, surface for none", () => {
  expect(corrFill(1)).toBe("color-mix(in oklab, var(--corr-pos) 100%, var(--corr-mid))");
  expect(corrFill(-0.5)).toBe("color-mix(in oklab, var(--corr-neg) 50%, var(--corr-mid))");
  expect(corrFill(0)).toContain(" 0%");
  expect(corrFill(null)).toBe("var(--surface-2)");
  expect(corrInk(-0.9)).toBe("var(--corr-ink-strong)");
  expect(corrInk(0.2)).toBe("var(--foreground)");
  expect(corrInk(null)).toBe("var(--foreground)");
});

test("similarity order puts strongly correlated variables next to each other", () => {
  // a~c strongly, b~d strongly, the pairs weakly with each other
  const m = [
    [1, 0.1, 0.9, 0],
    [0.1, 1, 0, -0.95],
    [0.9, 0, 1, 0.2],
    [0, -0.95, 0.2, 1],
  ];
  const order = similarityOrder(m);
  expect([...order].sort()).toEqual([0, 1, 2, 3]);
  const pos = (i: number) => order.indexOf(i);
  expect(Math.abs(pos(0) - pos(2))).toBe(1);
  expect(Math.abs(pos(1) - pos(3))).toBe(1);
  expect(similarityOrder([])).toEqual([]);
  expect(similarityOrder([[null, null], [null, null]]).sort()).toEqual([0, 1]); // constant columns still placed
});

test("the charts start with the first variables that vary", () => {
  expect(defaultShown([v("flat", 1, 0), v("a", 1), v("b", 1), v("c", 1), v("d", 1), v("e", 1)])).toEqual(["a", "b", "c", "d"]);
});
