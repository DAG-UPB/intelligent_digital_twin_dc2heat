import { expect, test } from "vitest";
import { draftOf, feedsKpi, kpiFormulas, kpiUses, mappingToSave } from "./kpiVariables";

const cols = { it_power: "IT", cooling_power: "HVAC", heat_demand: null, heat_power: ["Q"], reuse_point: "condenser", power_unit: "kW" };

test("kpiFormulas: the formulas with the bound names, two reused heats summed", () => {
  const f = kpiFormulas({ ...draftOf(cols), heat_power: ["Q1", "Q2"] });
  expect(f.map((l) => l.formula)).toEqual(["(IT + HVAC) / IT", "(Q1 + Q2) / (IT + HVAC)", "(IT + HVAC − (Q1 + Q2)) / IT"]);
  for (const l of f) expect(l.about).toContain(l.label === "PUE" ? "Power Usage Effectiveness" : "Energy Reuse"); // its info mark
});

test("kpiFormulas: the facility's other power completes the total, and PUE is the full one", () => {
  const f = kpiFormulas({ ...draftOf({ ...cols, other_power: ["UPS", "L"] }), heat_power: ["Q"] });
  expect(f.map((l) => l.formula)).toEqual(["(IT + HVAC + UPS + L) / IT", "Q / (IT + HVAC + UPS + L)", "(IT + HVAC + UPS + L − Q) / IT"]);
  expect(f[0].about).toContain("Full here");
  expect(kpiFormulas(draftOf(cols))[0].about).toContain("Partial here"); // without it: as before
  expect(kpiUses({ it_power: "IT", cooling_power: "HVAC", other_power: ["UPS"] }).UPS).toBe("Other facility power · PUE");
  expect(kpiUses({ it_power: "IT", other_power: ["UPS"] }).UPS).toBe("Other facility power · no KPI yet"); // no cooling: no PUE
});

test("kpiFormulas: a KPI without its variables says what is missing", () => {
  const f = kpiFormulas({ cooling_power: "HVAC" });
  expect(f[0]).toMatchObject({ label: "PUE", formula: null, missing: ["IT power"] });
  expect(f[1].missing).toEqual(["IT power", "reused heat"]);
});

test("mappingToSave: a reused heat found among the alternative points stays that rule; one chosen is pinned", () => {
  const saved = { reuse: { hall: "QH", condenser: "Q" } };
  expect(mappingToSave(draftOf(cols), cols, saved)).toMatchObject({ it_power: "IT", heat_power: [], reuse: saved.reuse });
  expect(mappingToSave({ ...draftOf(cols), heat_power: ["QH"] }, cols, {}).heat_power).toEqual(["QH"]);
  expect(mappingToSave(draftOf(cols), { ...cols, reuse_point: null }, {}).heat_power).toEqual(["Q"]);
});

test("kpiUses: each bound variable's role and the KPIs it feeds now", () => {
  const uses = kpiUses({ it_power: "IT", cooling_power: "HVAC", heat_power: ["Q"], power_unit: "kW" });
  expect(uses).toEqual({
    IT: "IT power · PUE, ERF, ERE",
    HVAC: "Cooling power · PUE, ERF, ERE",
    Q: "Reused heat · ERF, ERE",
  });
  expect(kpiUses({ heat_power: ["Q"] })).toEqual({ Q: "Reused heat · no KPI yet" }); // no IT power: nothing computes
  // a calculated reused heat: the water it is calculated from
  const water = kpiUses({ it_power: "IT", cooling_power: "HVAC", heat_power: ["Q"] }, { Q: { m: "m", t_in: "Ts", t_out: "Tr", cp: 4.18 } });
  expect(Object.keys(water).sort()).toEqual(["HVAC", "IT", "Tr", "Ts", "m"]);
  expect(water.m).toBe("Reused heat (Q = ṁ·cₚ·ΔT) · ERF, ERE");
});

test("feedsKpi: a KPI clicked marks only the variables it uses", () => {
  const uses = kpiUses({ it_power: "IT", cooling_power: "HVAC", heat_power: ["Q"] });
  expect(Object.keys(uses).filter((v) => feedsKpi(uses[v], "ERF"))).toEqual(["IT", "HVAC", "Q"]);
  expect(feedsKpi("Cooling power · PUE, ERF, ERE", "PU")).toBe(false);
  expect(feedsKpi("Reused heat · no KPI yet", "ERF")).toBe(false);
});
