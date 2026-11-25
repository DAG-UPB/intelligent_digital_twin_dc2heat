/** The evaluated period: its pure helpers (step length, duration labels, binning, energy) and testPeriod's shared load. */
import { describe, expect, test, vi } from "vitest";
import { binned, durationLabel, mwh, periodColumns, stepHoursOf, testPeriod } from "./period";

const api = vi.hoisted(() => ({
  fetchDatasets: vi.fn(async () => ({ datasets: [{ id: "d1", files: ["f.parquet"], columns: ["time", "x"] }] })),
  getModel: vi.fn(async () => {
    throw new Error("Model not found");
  }),
  fetchTimeSeriesData: vi.fn(async () => ({ time: ["2024-01-01T00:00:00", "2024-01-01T01:00:00", "2024-01-01T02:00:00", "2024-01-01T03:00:00"], columns: {} })),
  simulateModel: vi.fn(async () => ({ scenario: { q: [1, 2] } })),
}));
vi.mock("../api", () => api);

test("testPeriod: calls at the same time share one load, a later call loads again", async () => {
  const [a, b] = await Promise.all([testPeriod("d1"), testPeriod("d1")]);
  expect(a).toBe(b);
  expect(api.fetchTimeSeriesData).toHaveBeenCalledTimes(1);
  expect(a).toMatchObject({ dataset: "d1", start: 2, stepHours: 1, file: "f.parquet", model: null });
  expect(a.times).toEqual([Date.parse("2024-01-01T02:00:00Z") / 1000, Date.parse("2024-01-01T03:00:00Z") / 1000]);
  await testPeriod("d1");
  expect(api.fetchTimeSeriesData).toHaveBeenCalledTimes(2);
});

test("periodColumns loads from the period's own data center, not the selected one", async () => {
  const p = await testPeriod("d1");
  api.fetchTimeSeriesData.mockResolvedValueOnce({ time: [], columns: { x: [1, 2, 3, 4] } } as never);
  await expect(periodColumns(p, ["x"])).resolves.toEqual({ x: [3, 4] });
  expect(api.fetchTimeSeriesData).toHaveBeenLastCalledWith("d1", "f.parquet", ["x"]);
});

test("periodColumns: the chosen model's free run, with the series put in for its own drivers only", async () => {
  api.getModel.mockResolvedValueOnce({ name: "xgb", split_index: 2, drivers: ["Out_Temp"], file: "f.parquet" } as never);
  const p = await testPeriod("d1", "xgb");
  expect(api.getModel).toHaveBeenLastCalledWith("d1", "xgb");
  await expect(periodColumns(p, ["q"], "model", { Out_Temp: [5, 6], Heat_Demand: [1, 1] })).resolves.toEqual({ q: [1, 2] });
  expect(api.simulateModel).toHaveBeenLastCalledWith("d1", "xgb", { start: 2, steps: 2, columns: ["q"], drivers: { Out_Temp: [5, 6] } });
});

test("testPeriod: a failed load is not kept", async () => {
  api.fetchDatasets.mockRejectedValueOnce(new Error("offline"));
  await expect(testPeriod("d1")).rejects.toThrow("offline");
  await expect(testPeriod("d1")).resolves.toMatchObject({ start: 2 });
});

describe("stepHoursOf", () => {
  test("median spacing in hours", () => {
    expect(stepHoursOf([0, 3600, 7200, 10800])).toBe(1);
    expect(stepHoursOf([0, 5, 10, 15, 3600])).toBeCloseTo(5 / 3600);
  });
  test("1 when it cannot be told", () => {
    expect(stepHoursOf([])).toBe(1);
    expect(stepHoursOf([42])).toBe(1);
    expect(stepHoursOf([5, 5, 5])).toBe(1);
  });
});

test.each([
  [30, "30 s"],
  [5.5, "5.5 s"],
  [300, "5 min"],
  [6 * 3600, "6 h"],
  [36 * 3600, "36 h"],
  [2 * 86400, "2 d"],
  [91 * 86400, "3 mo"],
  [400 * 86400, "1.1 y"],
])("durationLabel(%d) = %s", (sec, want) => {
  expect(durationLabel(sec)).toBe(want);
});

test("mwh: kW per step x hours per step, in MWh", () => {
  expect(mwh([1000, 2000], 1)).toBe(3);
  expect(mwh([1000, 1000, 1000, 1000], 0.25)).toBe(1);
});

describe("binned", () => {
  const hourly = (days: number) => Array.from({ length: days * 24 }, (_, i) => i * 3600);

  test("short series: every step", () => {
    const t = hourly(1);
    expect(binned(t, t.map(() => 1))).toEqual({ xs: t, vs: t.map(() => 1), label: "every step" });
  });
  test("20 days or more: daily means", () => {
    const t = hourly(21);
    const r = binned(t, t.map((_, i) => i % 24));
    expect(r.label).toBe("daily mean");
    expect(r.xs).toHaveLength(21);
    expect(r.vs.every((v) => v === 11.5)).toBe(true);
  });
  test("2..20 days of 5-minute data: hourly means", () => {
    const t = Array.from({ length: 3 * 288 }, (_, i) => i * 300);
    const r = binned(t, t.map(() => 2));
    expect(r.label).toBe("hourly mean");
    expect(r.xs).toHaveLength(72);
  });
  test("hourly data over a few days is not binned again", () => {
    expect(binned(hourly(3), hourly(3)).label).toBe("every step");
  });
});
