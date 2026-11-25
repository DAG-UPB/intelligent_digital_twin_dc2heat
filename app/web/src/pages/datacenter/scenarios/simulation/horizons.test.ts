/** Test-period simulation logic: horizons, the year label, date -> step in any time zone, rows -> interventions. */
import { expect, test } from "vitest";
import type { TrainedModel } from "../../../../api";
import { defaultColumns, horizonsFor, interventionsOf, isYear, mean, toStep, wallClockMs, wholeSteps } from "./horizons";

test("horizons keep those of at least 2 steps shorter than the test period, then the whole period", () => {
  const h = horizonsFor(3600, 3495);
  expect(h.map((x) => x.label)).toEqual(["6 h", "24 h", "7 d", "30 d", "3 mo", "Whole test period · 4.8 mo"]);
  expect(h.at(-1)!.steps).toBe(0);
});

test("a test period cut at MAX_STEPS is marked capped", () => {
  const whole = wholeSteps({ rows: 100000, split_index: 50000 } as TrainedModel);
  expect(whole).toBe(20000);
  expect(horizonsFor(3600, whole).at(-1)!.label).toBe("Whole test period · 2.3 y (capped)");
});

test("a year is 360 days or more", () => {
  expect(isYear(8640, 3600)).toBe(true);
  expect(isYear(8639, 3600)).toBe(false);
});

test("dates are wall-clock times, whatever the zone of the browser", () => {
  expect(wallClockMs("2023-07-01")).toBe(Date.UTC(2023, 6, 1));
  expect(wallClockMs("2023-07-01T06:30")).toBe(Date.UTC(2023, 6, 1, 6, 30));
  expect(wallClockMs("2023-07-01 06:30:00")).toBe(Date.UTC(2023, 6, 1, 6, 30));
  expect(wallClockMs("2023-07-01 06:30:00+02:00")).toBe(Date.UTC(2023, 6, 1, 6, 30));
});

test("a date input maps to the step after the split time", () => {
  const split = "2023-07-01 00:00:00";
  expect(toStep("2023-07-01", split, 3600)).toBe(0);
  expect(toStep("2023-07-02", split, 3600)).toBe(24);
  expect(toStep("2023-07-01T06:00", split, 3600)).toBe(6);
  expect(toStep("2023-06-01", split, 3600)).toBe(0); // before the split: from the start
  expect(toStep("", split, 3600)).toBeNull();
  expect(toStep("2023-07-02", null, 3600)).toBeNull();
});

test("rows become interventions; empty or non-numeric values are dropped", () => {
  const rows = [
    { variable: "Cool_Set", kind: "shift" as const, value: "1", from: "2023-07-02", to: "" },
    { variable: "IT_Load", kind: "set" as const, value: "", from: "", to: "" },
    { variable: "IT_Load", kind: "scale" as const, value: "x", from: "", to: "" },
  ];
  expect(interventionsOf(rows, "2023-07-01T00:00:00", 3600)).toEqual([{ variable: "Cool_Set", kind: "shift", value: 1, start: 24, end: null }]);
});

test("default plot: the model's heat variables first, at most 3", () => {
  expect(defaultColumns(["Q", "Other"], ["A", "B", "Q", "C"])).toEqual(["Q", "A", "B"]);
  expect(mean([])).toBe(0);
  expect(mean([10, null, 10, NaN])).toBe(10); // gaps left out, not counted as 0
});
