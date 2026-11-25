import { expect, test } from "vitest";
import { feedsKpi } from "../pages/datacenter/modelling/kpiVariables";
import { CO2, co2SavedT, co2Short, districtKpis, heatKpis } from "./partKpis";

test("heatKpis: three KPIs with the drawing's names, each variable's part", () => {
  const k = heatKpis((v) => (v === "Q_dc" ? "HEX_Cond_Q" : v));
  expect(k.lines.map((l) => l.label)).toEqual(["COP", "Waste heat used", "Electricity use"]);
  expect(k.lines[1].formula).toBe("Σ (Q_hex + Q_hp − P_el_hp) / Σ HEX_Cond_Q");
  expect(
    Object.keys(k.uses)
      .filter((v) => feedsKpi(k.uses[v], "COP"))
      .sort(),
  ).toEqual(["P_el_hp", "Q_hp"]);
  for (const l of k.lines) expect(l.about.length).toBeGreaterThan(40);
});

test("districtKpis: demand covered, energy used and the CO₂ saved against gas, with its factors", () => {
  const k = districtKpis();
  expect(k.lines.map((l) => l.label)).toEqual(["Demand covered", "Energy used", "CO₂ saved"]);
  expect(k.lines[2].formula).toContain(`${CO2.gas} / ${CO2.boiler}`);
  expect(k.lines[2].formula).toContain(`P_el_hp × Δt × ${CO2.grid}`);
  expect(feedsKpi(k.uses.Q_houses, "Energy used")).toBe(true);
});

test("co2SavedT: gas saved minus the heat pump's grid electricity", () => {
  expect(co2SavedT(900, 0)).toBeCloseTo(201, 6); // 900 MWh of heat: 1000 MWh of gas at 90 %, 0.201 t each
  expect(co2SavedT(900, 100)).toBeCloseTo(201 - 38, 6);
});

// 1b-10: the quick analysis's "?" texts wrote the factors raw ("0.201", "0.38"): not as the rest of the page (fmt)
test("the CO₂ factors in short for the quick analysis's \"?\" texts, through fmt", () => {
  expect(co2Short()).toBe("CO₂ 0,201 kg/kWh gas at 90 %, grid 0,38 kg/kWh in every hour");
});
