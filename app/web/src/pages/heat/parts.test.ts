/** The parts on Heat Matching: Model or Calculation, the district's source, the demand column, the switches, the loop temperatures. */
import { describe, expect, test } from "vitest";
import type { DatasetConfig } from "../../dataset";
import { ALL_ON, asPartsOn, DEFAULT_WAYS, demandColumn, districtSource, LOOP_DT, loopTemps, recoveryOf, wayOf } from "./parts";

describe("Model or Calculation", () => {
  test("the picked way unless only the other can run; neither: the pick stays", () => {
    expect(wayOf("model", { model: null, calculation: null })).toBe("model");
    expect(wayOf("model", { model: "no trained model", calculation: null })).toBe("calculation");
    expect(wayOf("calculation", { model: null, calculation: "needs drivers" })).toBe("model");
    expect(wayOf("model", { model: "x", calculation: "y" })).toBe("model");
  });
  test("every part runs its Model by default", () => {
    expect(Object.values(DEFAULT_WAYS)).toEqual(["model", "model", "model"]);
  });
  test("the district's Model: its demand's profile (also before it is moved), or its measured column", () => {
    expect(districtSource(undefined, "Heat_Demand", [])).toEqual({ from: "profile" });
    expect(districtSource(undefined, "Heat_Demand", ["Heat_Demand"])).toEqual({ from: "measured", column: "Heat_Demand" }); // not moved: its measurement
    expect(districtSource("profile", "Heat_Demand", ["Heat_Demand"])).toEqual({ from: "profile" }); // moved to a profile: the profile
    expect(districtSource("off", "Heat_Demand", ["Heat_Demand"])).toEqual({ from: "measured", column: "Heat_Demand" });
    expect(districtSource("data", "Heat_Demand", ["Heat_Demand"])).toEqual({ from: "measured", column: "Heat_Demand" });
    expect(districtSource("off", "Q_houses", [])).toHaveProperty("why");
    expect(districtSource("physics", "Heat_Demand", ["Heat_Demand"])).toHaveProperty("why");
  });
});

describe("columns of the dataset", () => {
  const hex = { q: "HEX_Cond_Q", t: "HEX_Cond_T_in", t_in: "HEX_Cond_T_in", t_out: "HEX_Cond_T_out", m: "HEX_Cond_m" };
  const config: DatasetConfig = { actuators: [], heat: [], levers: [], heat_source: { condenser: hex, hall: { q: "Q2", t: "T2" } }, kpi: { heat_demand: "Heat_Demand" } };
  const columns = ["HEX_Cond_Q", "HEX_Cond_T_in", "HEX_Cond_T_out", "Q2", "T2", "Heat_Demand"];
  test("the demand column is kpi.heat_demand when it exists", () => {
    expect(demandColumn(config, columns)).toBe("Heat_Demand");
    expect(demandColumn(config, ["x"])).toBeNull();
    expect(demandColumn({ ...config, kpi: null }, columns)).toBeNull();
  });
});

describe("switches", () => {
  test("a missing or old site.json: everything on; booleans are kept", () => {
    expect(asPartsOn(undefined)).toEqual(ALL_ON);
    expect(asPartsOn({ hp: false, tank: "no" })).toEqual({ hex: true, hp: false, tank: true });
  });
  test("recovery: both = auto, one of them, or none", () => {
    expect(recoveryOf(ALL_ON)).toBe("auto");
    expect(recoveryOf({ ...ALL_ON, hp: false })).toBe("direct");
    expect(recoveryOf({ ...ALL_ON, hex: false })).toBe("heatpump");
    expect(recoveryOf({ hex: false, hp: false, tank: true })).toBe("none");
  });
});

test("loop temperatures: the measured return, else supply − ΔT marked as an assumption", () => {
  expect(loopTemps({ t: [40, 50, 60], tOut: [30, 35, 40] }, 1, 3)).toEqual({ supply: 55, ret: 37.5, approx: false });
  expect(loopTemps({ t: [40, 50] }, 0, 2)).toEqual({ supply: 45, ret: 45 - LOOP_DT, approx: true });
  expect(loopTemps({ t: [40, 50] }, 0, 2, 12).ret).toBe(33);
});
