import { describe, expect, test } from "vitest";
import type { SimulateResponse } from "../../../api";
import type { KpiColumns } from "../dashboard/whatIf";
import { kpiSources, runKpis } from "./kpiRun";

const cols: KpiColumns = { it_power: "IT", cooling_power: "HVAC", heat_demand: null, heat_power: ["Q"], reuse_point: null, power_unit: "kW" };
const derived = { Q: { m: "m", t_in: "Ti", t_out: "To", cp: 4.19 } };

describe("a Scenarios run's KPIs", () => {
  test("the twin gives its inputs, predictions and the Q of predicted parts; the rest is only measured", () => {
    expect(kpiSources(cols, { drivers: ["IT"], order: ["m", "Ti", "To"] }, derived)).toEqual({ twin: ["IT", "Q"], measured: ["HVAC"] });
    expect(kpiSources(cols, { drivers: [], order: ["IT", "HVAC"] }, null)).toEqual({ twin: ["IT", "HVAC"], measured: ["Q"] });
  });

  test("measured, the twin without and with the change; a column the twin lacks is measured at the run's steps", () => {
    const res: SimulateResponse = {
      start: 1,
      steps: 2,
      time: ["t1", "t2"],
      actual: { IT: [100, 100], Q: [10, 10] },
      baseline: { IT: [100, 100], Q: [20, 20] },
      scenario: { IT: [100, 100], Q: [40, 40] },
    };
    const rows = runKpis(res, cols, 1, { HVAC: [0, 50, 50, 0] }); // whole file: steps 1 and 2 are the run's
    const pue = rows.find((k) => k.label === "PUE (partial)")!;
    expect([pue.value, pue.without, pue.with]).toEqual([1.5, 1.5, 1.5]);
    const erf = rows.find((k) => k.label === "ERF")!;
    expect(erf.value).toBeCloseTo(20 / 300);
    expect(erf.without).toBeCloseTo(40 / 300);
    expect(erf.with).toBeCloseTo(80 / 300);
  });

  test("without a baseline the run is the twin and there is no change", () => {
    const res: SimulateResponse = { start: 0, steps: 1, time: ["t"], actual: { IT: [100], HVAC: [50] }, scenario: { IT: [100], HVAC: [25] } };
    const pue = runKpis(res, { ...cols, heat_power: [] }, 1).find((k) => k.label === "PUE (partial)")!;
    expect([pue.value, pue.without, pue.with]).toEqual([1.5, 1.25, null]);
  });
});
