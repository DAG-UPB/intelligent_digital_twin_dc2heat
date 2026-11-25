/** Inputs from another dataset: which datasets give a demand or a weather, and a series put on the period's steps. */
import { expect, test } from "vitest";
import type { DatasetInfo } from "../api";
import { inputSources, onPeriod } from "./externalInputs";

const ds = (id: string, columns: string[], config?: Record<string, unknown>): DatasetInfo => ({
  id,
  name: id.toUpperCase(),
  files: [`df_${id}.parquet`],
  columns: ["time", ...columns],
  time_range: { start: "", end: "" },
  row_count: 0,
  resolution_seconds: 3600,
  config,
});

test("inputSources: a demand where kpi.heat_demand is a column, a weather where an outdoor temperature is, never itself", () => {
  const list = [
    ds("dc", ["Out_Temp", "Heat_Demand"], { kpi: { heat_demand: "Heat_Demand" } }),
    ds("district", ["Out_Temp", "Heat_Demand"], { name: "District · heat demand", kpi: { heat_demand: "Heat_Demand" } }),
    ds("named", ["temperature_2m", "Q"], { kpi: { heat_demand: "Missing" } }),
    ds("bare", ["x"]),
  ];
  expect(inputSources(list, "dc")).toEqual({
    demand: [{ id: "district", name: "District · heat demand", column: "Heat_Demand" }],
    weather: [
      { id: "district", name: "District · heat demand", column: "Out_Temp" },
      { id: "named", name: "NAMED", column: "temperature_2m" },
    ],
  });
});

test("onPeriod: on the period's steps by timestamp, gaps bridged, null when the period is not covered", () => {
  const iso = ["2024-01-01T00:00:00", "2024-01-01T01:00:00", "2024-01-01T02:00:00", "2024-01-01T03:00:00"];
  const t = (h: number) => Date.parse("2024-01-01T00:00:00Z") / 1000 + h * 3600;
  expect(onPeriod(iso, [0, 10, null, 30], [t(1), t(2), t(3)])).toEqual([10, 20, 30]);
  expect(onPeriod(iso, [0, 10, 20, 30], [t(2), t(5)])).toBeNull();
  expect(onPeriod([], [], [t(0)])).toBeNull();
});
