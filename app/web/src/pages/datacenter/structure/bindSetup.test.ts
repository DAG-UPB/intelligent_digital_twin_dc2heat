import { expect, test } from "vitest";
import { configOf } from "../../../dataset";
import { DISTRICT_SETUP } from "../../district/structure/districtSetup";
import { bindSetup, renameFor } from "./bindSetup";

const config = { actuators: [], heat: [], levers: [], kpi: { heat_demand: "Heat_Demand" } };

test("the weather's and the district demand's generic names become the data's own columns", () => {
  const columns = ["Hour", "Out_Temp", "Out_Hum", "Out_Wind", "Out_Wind_Dir", "Heat_Demand", "IT_Load"];
  expect(renameFor(columns, config)).toEqual({
    T_outdoor: "Out_Temp",
    humidity: "Out_Hum",
    wind_speed: "Out_Wind",
    wind_direction: "Out_Wind_Dir",
    hour: "Hour",
    IT_load: "IT_Load", // the data center's input
    Q_houses: "Heat_Demand",
    Q_demand: "Heat_Demand",
  });
  expect(renameFor(["T_outdoor", "x"], config)).toEqual({}); // the data already has the name; no demand column
});

test("the heat distribution starts on the heat exchanger the data center uses: its data-center side and its heat", () => {
  const heat = {
    ...config,
    heat_source: { hall: { q: "HQ", t: "HT", t_in: "HTi", t_out: "HTo", m: "Hm" }, condenser: { q: "CQ", t: "CT", t_in: "CTi", t_out: "CTo", m: "Cm" } },
  };
  const columns = ["HQ", "HTi", "HTo", "Hm", "CQ", "CTi", "CTo", "Cm", "Heat_Demand"];
  expect(renameFor(columns, heat, "condenser")).toEqual({
    Q_houses: "Heat_Demand",
    Q_demand: "Heat_Demand",
    Q_hex: "CQ",
    T_dc_supply: "CTi",
    T_dc_return: "CTo",
    m_dc: "Cm",
  });
  expect(renameFor(columns, heat).Q_hex).toBe("HQ"); // no choice made: the first
  // the loop's water on the HEX's cold side (sim_recovery_air): what goes to the heat distribution and comes back
  const loop = { ...heat, heat_source: { hall: { ...heat.heat_source.hall, t: "Warm", t_return: "Cold" } } };
  expect(renameFor([...columns, "Warm", "Cold"], loop, "hall")).toMatchObject({ T_dc_supply: "Warm", T_dc_return: "Cold" });
  expect(renameFor(columns, { ...heat, derived: { CQ: { m: "Cm", t_in: "CTi", t_out: "CTo", cp: 4.18 } } }, "condenser").Q_hex).toBeUndefined(); // calculated: not a node
});

test("a bound district starts with the data's columns everywhere: variables, positions, links, notes, taps", () => {
  const b = bindSetup(DISTRICT_SETUP, { T_outdoor: "Out_Temp", Q_houses: "Heat_Demand" });
  expect(b.starter).toContain("Heat_Demand");
  expect(b.starter).not.toContain("Q_houses");
  expect(b.defaults.Heat_Demand).toEqual(DISTRICT_SETUP.defaults.Q_houses);
  expect(b.starterLinks).toContainEqual({ from: "Out_Temp", to: "m_dh", lags: [1] });
  expect(b.starterLinks).toContainEqual({ from: "m_dh", to: "Heat_Demand", lags: [1] });
  expect(b.starterNotes.Out_Temp.kind).toBe("weather");
  expect(b.taps.measures).toHaveProperty("Heat_Demand", null);
  expect(bindSetup(DISTRICT_SETUP, {})).toBe(DISTRICT_SETUP);
});

test("renameFor: a column made the same as a generic name (dataset.json names) is bound to it, before the data's names", () => {
  const cols = ["it_load", "my_util", "Out_Temp"];
  expect(renameFor(cols, configOf(undefined)).IT_load).toBe("it_load");
  expect(renameFor(cols, { ...configOf(undefined), names: { my_util: "IT_load" } }).IT_load).toBe("my_util");
  expect(renameFor(cols, { ...configOf(undefined), names: { my_util: "Pump speed" } }).IT_load).toBe("it_load"); // a label only
});
