/** Heat Matching's details for the assistant: KPIs with units, and set_part_way's names. */
import { expect, test } from "vitest";
import { matchingKpis, partWay } from "./matchingDetail";

test("the KPIs are numbers with units, rounded, the CO2 from the delivered heat and the heat pump's electricity", () => {
  const k = matchingKpis({
    demandMwh: 100,
    deliveredMwh: 80.04,
    coveragePct: 80.04,
    dcUsedPct: 50,
    hpElecMwh: 10,
    spf: 3.456,
    unmetMwh: 20,
    surplusMwh: 5,
    hoursCovered: 4000,
    demandHours: 8000,
    hours: 8760,
  });
  expect(k.map((x) => x.label)).toEqual(["Coverage", "Heat delivered", "HP electricity", "SPF", "Unmet", "Surplus", "CO₂ saved"]);
  expect(k[0]).toMatchObject({ value: 80, unit: "%", note: "4000 of 8000 h with demand fully met" });
  expect(k[3].value).toBe(3.46);
  expect(k[6].value).toBeGreaterThan(0);
});

test("set_part_way takes the parts and ways by their ids only", () => {
  expect(partWay("heat", "calculation")).toEqual({ part: "heat", way: "calculation" });
  expect(() => partWay("hp", "model")).toThrow(/dc, heat, district/);
  expect(() => partWay("dc", "Model")).toThrow(/model, calculation/);
});
