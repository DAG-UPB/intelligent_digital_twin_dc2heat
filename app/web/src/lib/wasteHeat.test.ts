import { expect, test } from "vitest";
import { wasteKw } from "./wasteHeat";

test("the data center's waste heat: its capacity times the power its utilization draws (idle 50 % to full)", () => {
  const dc = { power_kw: 1000 };
  expect(wasteKw(dc)).toBe(1000); // saved without a utilization: full load
  expect(wasteKw({ ...dc, utilization: 0 })).toBe(500);
  expect(wasteKw({ ...dc, utilization: 0.4 })).toBeCloseTo(700, 9);
  expect(wasteKw({ ...dc, utilization: 0.7 })).toBeCloseTo(850, 9);
  expect(wasteKw({ ...dc, utilization: 0.4, idle_share: 0.3 })).toBeCloseTo(580, 9);
  expect(wasteKw({ ...dc, utilization: 0.4, heat_used_share: 0.5 })).toBeCloseTo(350, 9); // half of it used
});
