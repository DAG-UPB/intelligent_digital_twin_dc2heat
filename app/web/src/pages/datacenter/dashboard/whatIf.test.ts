import { describe, expect, test } from "vitest";
import { changeOf, compareKpis, kpiInputs, kpisOf, runSeries, type KpiColumns } from "./whatIf";

const cols: KpiColumns = { it_power: "IT", cooling_power: "HVAC", heat_demand: null, heat_power: ["Q"], reuse_point: null, power_unit: "kW" };

describe("what-if KPIs", () => {
  test("PUE, ERF, ERE and the energies, over the steps where every column has a value", () => {
    const k = Object.fromEntries(kpisOf({ IT: [100, 100, null], HVAC: [50, 30, 10], Q: [20, 20, 20] }, cols, 1).map((x) => [x.label, x.value]));
    expect(k["PUE (partial)"]).toBeCloseTo(280 / 200);
    expect(k.ERF).toBeCloseTo(40 / 280);
    expect(k.ERE).toBeCloseTo((280 - 40) / 200);
    expect(k["IT energy"]).toBeCloseTo(0.2); // 200 kWh = 0.2 MWh
    expect(k["Heat reused"]).toBeCloseTo(0.04);
  });

  test("with the facility's other power: the full PUE, ERF and ERE on IT + cooling + other", () => {
    const full = { ...cols, other_power: ["UPS", "L"] };
    const series = { IT: [100, 100, 100], HVAC: [50, 30, 10], UPS: [8, 8, null], L: [2, 2, 2], Q: [20, 20, 20] };
    const k = Object.fromEntries(kpisOf(series, full, 1).map((x) => [x.label, x.value]));
    expect(k.PUE).toBeCloseTo(300 / 200); // the third step has no UPS: left out
    expect(k["PUE (partial)"]).toBeUndefined();
    expect(k.ERF).toBeCloseTo(40 / 300);
    expect(k.ERE).toBeCloseTo((300 - 40) / 200);
    expect(kpiInputs(full)).toEqual(["IT", "HVAC", "UPS", "L", "Q"]);
    // without the cooling the other power makes no PUE
    expect(kpisOf(series, { ...full, cooling_power: null, heat_power: [] }, 1).map((x) => x.label)).toEqual(["IT energy"]);
  });

  test("without cooling only the IT energy; without a power unit no energies", () => {
    expect(kpisOf({ IT: [1, 2] }, { ...cols, cooling_power: null, heat_power: [] }, 1).map((x) => x.label)).toEqual(["IT energy"]);
    expect(kpisOf({ IT: [1], HVAC: [1] }, { ...cols, heat_power: [], power_unit: null }, 1).map((x) => x.label)).toEqual(["PUE (partial)"]);
  });

  test("the change as a share of the base", () => {
    expect(changeOf(1.35, 1.5)).toBeCloseTo(-0.1);
    expect(changeOf(null, 1)).toBeNull();
    expect(changeOf(1, 0)).toBeNull();
  });

  test("a run's series: the twin's (a band's median) where it gives the column, else the measured one", () => {
    expect(kpiInputs(cols)).toEqual(["IT", "HVAC", "Q"]);
    const run = { IT: [1, 2], Q: { p05: [0, 0], p50: [5, 6], p95: [9, 9] } };
    expect(runSeries(kpiInputs(cols), { IT: [7, 7], HVAC: [3, 3], Q: [4, 4] }, run)).toEqual({ IT: [1, 2], HVAC: [3, 3], Q: [5, 6] });
  });

  test("measured, without and with side by side, by label", () => {
    const k = (label: string, value: number) => ({ label, value, unit: null, better: "lower" as const });
    expect(compareKpis([k("PUE", 1.5), k("ERF", 0.1)], [k("ERF", 0.2), k("PUE", 1.4)], null)).toEqual([
      { ...k("PUE", 1.5), without: 1.4, with: null },
      { ...k("ERF", 0.1), without: 0.2, with: null },
    ]);
  });
});
