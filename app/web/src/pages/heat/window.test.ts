/** windowOf (week / day / whole period, index clamping), meanOver, windowFlows and dateOf. */
import { describe, expect, test } from "vitest";
import { DEFAULT_OPTIONS, matchHeat } from "../../lib/matching";
import { dateOf, isoWeek, meanOver, whenOf, windowAt, windowFlows, windowOf } from "./window";

describe("windowOf", () => {
  test("a year of hourly data: weeks of 168 steps", () => {
    expect(windowOf(8760, 1, 2)).toEqual({ kind: "week", index: 2, count: 52, a: 336, b: 504 });
  });
  test("the index is clamped to the windows there are", () => {
    expect(windowOf(8760, 1, 99)).toMatchObject({ index: 51, a: 51 * 168 });
    expect(windowOf(8760, 1, -3)).toMatchObject({ index: 0, a: 0 });
  });
  test("3 days of 5-minute data: days of 288 steps", () => {
    expect(windowOf(3 * 288, 5 / 60, 2)).toEqual({ kind: "day", index: 2, count: 3, a: 576, b: 864 });
  });
  test("1 day: the whole period", () => {
    expect(windowOf(24, 1, 2)).toEqual({ kind: "period", index: 0, count: 1, a: 0, b: 24 });
  });
  test("no data: one empty window", () => {
    expect(windowOf(0, 1, 2)).toEqual({ kind: "period", index: 0, count: 1, a: 0, b: 0 });
  });
});

test("meanOver: mean of the range, an empty range is 0", () => {
  expect(meanOver([1, 2, 3, 4], 1, 3)).toBe(2.5);
  expect(meanOver([1, 2], 2, 2)).toBe(0);
});

describe("windowFlows", () => {
  const n = 48;
  const q = Array.from({ length: n }, () => 50);
  const t = Array.from({ length: n }, (_, i) => (i % 2 ? 80 : 30));
  const demand = Array.from({ length: n }, (_, i) => (i < 24 ? 20 : 60));
  const res = matchHeat(q, t, demand, 70, DEFAULT_OPTIONS);

  test("the district gets what the paths deliver: coverage = delivered / demand", () => {
    const f = windowFlows(res, q, t, demand, 24, 48);
    expect(f.demand).toBe(60);
    expect(f.coverage).toBeCloseTo((100 * (f.hexOut + f.hpOut + f.tankOut)) / 60);
    expect(f.srcQ).toBe(50);
    expect(f.srcT).toBe(55);
  });
  test("heat-pump input = its output and tank charge minus electricity", () => {
    const f = windowFlows(res, q, t, demand, 0, 48);
    expect(f.toHp).toBeCloseTo(f.hpOut + f.hpTank - f.elec);
    expect(f.cop).toBeGreaterThan(1);
  });
  test("coverage is 100 % when there is no demand", () => {
    const zero = demand.map(() => 0);
    expect(windowFlows(matchHeat(q, t, zero, 70, DEFAULT_OPTIONS), q, t, zero, 0, 48).coverage).toBe(100);
  });
});

test("dateOf: day and month, with the time on short data", () => {
  const s = Date.parse("2024-08-20T13:05:00Z") / 1000;
  expect(dateOf(s, 30 * 86400, "UTC")).toBe("20 Aug");
  expect(dateOf(s, 86400, "UTC")).toBe("20 Aug, 13:05");
  expect(dateOf(undefined, 86400)).toBe("");
});

test("windowAt: the week holding a time, clamped to the windows there are", () => {
  const x0 = 1_700_000_000;
  const week = 7 * 24; // hourly steps
  expect(windowAt(x0, x0, 3600, week, 52)).toBe(0);
  expect(windowAt(x0 + 7 * 86400 + 5, x0, 3600, week, 52)).toBe(1);
  expect(windowAt(x0 - 86400, x0, 3600, week, 52)).toBe(0);
  expect(windowAt(x0 + 400 * 86400, x0, 3600, week, 52)).toBe(51);
});

test("isoWeek and whenOf: the calendar week and the weekdays of a window", () => {
  const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000;
  expect(isoWeek(at(2024, 1, 1))).toBe(1); // a Monday
  expect(isoWeek(at(2024, 1, 21))).toBe(3); // a Sunday: the week from Monday 15 Jan
  expect(isoWeek(at(2021, 1, 1))).toBe(53); // a Friday: still 2020's last week
  expect(isoWeek(at(2024, 12, 30))).toBe(1); // a Monday: already 2025's first week
  expect(whenOf(at(2024, 1, 15), at(2024, 1, 21, 23))).toBe("week 3 · Mon–Sun");
  expect(whenOf(at(2024, 1, 15), at(2024, 1, 15, 23))).toBe("Mon · week 3");
  expect(whenOf(undefined, at(2024, 1, 15))).toBe("");
});
