import { expect, test } from "vitest";
import { CAR_T, HOUSEHOLD_MWH, heatFacts, SHOWER_KWH, TREE_KG } from "./heatFacts";

test("a year of heat and CO₂ in households, showers, cars and trees", () => {
  const f = heatFacts(9000, 1900);
  expect(f.households).toBeCloseTo(9000 / HOUSEHOLD_MWH);
  expect(f.people).toBeCloseTo(2 * f.households);
  expect(f.showers).toBeCloseTo(9_000_000 / SHOWER_KWH);
  expect(f.showersPerDay * 365).toBeCloseTo(f.showers);
  expect(f.cars).toBeCloseTo(1900 / CAR_T);
  expect(f.trees).toBeCloseTo(1_900_000 / TREE_KG);
});

test("a shorter period counts as its share of a year", () => {
  const year = heatFacts(9000, 100);
  const week = heatFacts((9000 * 7) / 365, (100 * 7) / 365, 7);
  expect(week.households).toBeCloseTo(year.households, 0);
  expect(week.showersPerDay).toBeCloseTo(year.showersPerDay, 0);
  expect(week.showers).toBeCloseTo(year.showers, 0); // a year's showers, as the households (was the week's)
  expect(heatFacts(0, 0, 0).households).toBe(0);
});

// K17: more grid CO₂ than gas avoided gave "-7 cars off the road" and "-690 trees"
test("no CO₂ saved: no cars off the road and no trees, not negative ones", () => {
  const f = heatFacts(60, -13.8);
  expect(f.cars).toBe(0);
  expect(f.trees).toBe(0);
  expect(f.households).toBeCloseTo(60 / 9, 9); // the heat's figures stay
  expect(heatFacts(60, NaN).trees).toBe(0);
});
