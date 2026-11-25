import { expect, test } from "vitest";
import { countsIn, coverageOf, inPeriod, periodKpis, periodLabel, periodRows, monthsWithData, rangeOf, yearsOf } from "./seriesPeriod";

const hourly = (from: string, hours: number) => Array.from({ length: hours }, (_, i) => new Date(from).getTime() / 1000 + i * 3600);

test("the years from the first to the last timestamp", () => {
  expect(yearsOf("2023-01-01T00:00:00", "2024-12-29T23:00:00")).toEqual([2023, 2024]);
  expect(yearsOf(null, "2024-01-01T00:00:00")).toEqual([]);
});

test("a year, a month, or all the data", () => {
  const times = hourly("2023-12-31T00:00:00", 24 * 40); // 31 Dec 2023 to 8 Feb 2024
  const values = times.map((_, i) => i);
  expect(inPeriod(times, values, { year: null, month: null }, 1e6).rows).toBe(times.length);
  expect(inPeriod(times, values, { year: 2023, month: null }, 1e6).rows).toBe(24);
  const jan = inPeriod(times, values, { year: 2024, month: 0 }, 1e6);
  expect(jan.rows).toBe(31 * 24);
  expect(jan.ys[0]).toBe(24);
  expect(monthsWithData(times, 2024)).toEqual(new Set([0, 1]));
  const [from, to] = rangeOf({ year: 2024, month: 1 });
  expect((to - from) / 86400).toBe(29); // a leap year's February
});

test("thinned to means of consecutive points, gaps left out of a mean", () => {
  const times = [0, 1, 2, 3, 4, 5];
  const r = inPeriod(times, [1, 3, null, 5, null, null], { year: null, month: null }, 3);
  expect(r.xs).toEqual([0, 2, 4]);
  expect(r.ys).toEqual([2, 5, null]);
  expect(r.raw).toHaveLength(6);
});

test("counts in equal bins over a range, values beyond it left out", () => {
  expect(countsIn([0, 1, 2, 3, null, 4, 9], 0, 4, 4)).toEqual([1, 1, 1, 2]);
  expect(countsIn([1, 2], 3, 3, 4)).toEqual([0, 0, 0, 0]);
});

test("the period said, and its rows unthinned", () => {
  expect(periodLabel({ year: null, month: null }, [2023, 2024])).toBe("All years (2023–2024)");
  expect(periodLabel({ year: 2024, month: 2 }, [2023, 2024])).toBe("Mar 2024");
  const times = hourly("2023-12-31T00:00:00", 48);
  expect(periodRows(times, { a: times.map(() => 1) }, { year: 2024, month: null }).a).toHaveLength(24);
});

test("the KPI tiles take the period's values; the heat note its coverage", () => {
  const tiles = [
    { label: "PUE (partial)", value: 1.5, unit: null, note: "IT + cooling only" },
    { label: "IT energy, total", value: 100, unit: "MWh", note: "ITE × step, summed" },
    { label: "Heat reused, total", value: 9, unit: "MWh", note: "hall HEX · Q · 56 % of Heat_Demand covered" },
  ];
  const computed = [
    { label: "PUE (partial)", value: 1.2, unit: null, better: "lower" as const },
    { label: "IT energy", value: 40, unit: "MWh", better: "lower" as const },
    { label: "Heat reused", value: 3, unit: "MWh", better: "higher" as const },
  ];
  const out = periodKpis(tiles, computed, 0.25);
  expect(out.map((k) => k.value)).toEqual([1.2, 40, 3]);
  expect(out[2].note).toBe("hall HEX · Q · 25 % of Heat_Demand covered");
  expect(periodKpis(tiles, [], null).map((k) => [k.value, k.note])[2]).toEqual([null, "hall HEX · Q"]);
  expect(coverageOf({ q: [1, 2, null], d: [4, null, 4] }, ["q"], "d")).toBe(0.25);
  // a step's surplus covers nothing in another: 10 kW against 4, then 0 against 4 is half covered, not 125 %
  expect(coverageOf({ q: [10, 0], d: [4, 4] }, ["q"], "d")).toBe(0.5);
});
