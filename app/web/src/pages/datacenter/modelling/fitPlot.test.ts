/** The fit dialog's geometry: pairs without gaps, even downsampling, padded ranges, nice ticks, histograms, known units. */
import { expect, test } from "vitest";
import { evenly, finitePairs, histogram, niceTicks, paddedRange, unitsOf } from "./fitPlot";

test("finitePairs keeps the rows where both values are finite", () => {
  expect(finitePairs([1, null, 3, NaN, 5], [10, 20, Infinity, 40, 50])).toEqual({ measured: [1, 5], predicted: [10, 50] });
  expect(finitePairs([1, 2, 3], [4])).toEqual({ measured: [1], predicted: [4] }); // the shorter one sets the length
});

test("evenly spreads at most `max` indices over all rows, ends included", () => {
  expect(evenly(4, 10)).toEqual([0, 1, 2, 3]);
  expect(evenly(11, 3)).toEqual([0, 5, 10]);
  expect(evenly(10_000, 3000)).toHaveLength(3000);
  expect(evenly(5, 1)).toEqual([0]);
  expect(evenly(5, 0)).toEqual([]);
});

test("paddedRange adds a share of the span, and a span to a single value", () => {
  expect(paddedRange([0, 10, 5])).toEqual([-0.5, 10.5]);
  expect(paddedRange([3, 3])).toEqual([2, 4]);
  expect(paddedRange([])).toEqual([-1, 1]);
  const many = Array.from({ length: 300_000 }, (_, i) => i); // no stack overflow
  expect(paddedRange(many, 0)).toEqual([0, 299_999]);
});

test("niceTicks steps by 1, 2 or 5 × 10^k inside the range", () => {
  expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
  expect(niceTicks(-0.5, 10.5)).toEqual([0, 5, 10]); // span 11: a step of 5, not 2
  expect(niceTicks(18.3, 26.9, 4)).toEqual([20, 25]);
  const small = niceTicks(0.01, 0.05, 4);
  expect(small).toHaveLength(5);
  small.forEach((t, i) => expect(t).toBeCloseTo(0.01 + i * 0.01));
  expect(niceTicks(0, 0.3, 3)).toHaveLength(4); // the end tick survives float error (3 × 0.1 > 0.3)
  expect(niceTicks(3, 3)).toEqual([3]);
});

test("histogram counts per equal bin, the top edge in the last bin, outside values left out", () => {
  expect(histogram([0, 0.5, 1, 1.5, 2, 5, -1], 0, 2, 2)).toEqual([2, 3]);
  expect(histogram([1, 1], 1, 1, 3)).toEqual([0, 0, 0]); // no width: nothing to count
});

test("unitsOf names the heat points' and the KPI powers' units, nothing else", () => {
  const units = unitsOf({
    actuators: [],
    heat: [],
    levers: [],
    heat_source: { hall: { q: "Q", t: "T_in", t_in: "T_in", t_out: "T_out", m: "m" } },
    kpi: { it_power: "IT", cooling_power: "HVAC", power_unit: "MW" } as { heat_demand?: string },
  });
  expect(units).toEqual({ Q: "kW", T_in: "°C", T_out: "°C", m: "kg/s", IT: "MW", HVAC: "MW" });
  expect(unitsOf({ actuators: [], heat: [], levers: [], kpi: { it_power: "IT" } as { heat_demand?: string } })).toEqual({}); // no power_unit: unknown
});
