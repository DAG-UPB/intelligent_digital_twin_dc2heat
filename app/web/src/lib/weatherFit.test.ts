import { expect, test } from "vitest";
import { shiftOf, slopeOn, withWeather } from "./weatherFit";

test("slopeOn: the least-squares slope; 0 without spread or data", () => {
  expect(slopeOn([20, 18, 16, 14], [0, 1, 2, 3])).toBeCloseTo(-2, 9); // a demand falling 2 kW per K
  expect(slopeOn([1, 2, 3], [5, 5, 5])).toBe(0);
  expect(slopeOn([1, Number.NaN, 3, 5], [0, 1, 1, 2])).toBeCloseTo(2, 9); // the gap left out
});

test("withWeather: a warmer week lowers a heating demand by its slope, never below 0", () => {
  const out = [0, 1, 2, 3];
  expect(withWeather([20, 18, 16, 14], out, 2)).toEqual([16, 14, 12, 10]);
  expect(withWeather([20, 18, 16, 14], out, 20)).toEqual([0, 0, 0, 0]);
  expect(withWeather([20, 18], out, 0)).toEqual([20, 18]);
});

test("shiftOf: the shift in its season, and the coldest week colder still", () => {
  const day = 86400;
  const jan = Date.UTC(2024, 0, 1) / 1000;
  const jul = Date.UTC(2024, 6, 1) / 1000;
  const times = [...Array(20)].map((_, i) => jan + i * day).concat([...Array(20)].map((_, i) => jul + i * day));
  const outT = times.map((_, i) => (i >= 5 && i < 12 ? -8 : i < 20 ? 2 : 20)); // days 5..11: the coldest week
  expect(shiftOf(times, outT, 3, "year", 0, 24).every((d) => d === 3)).toBe(true);
  const winter = shiftOf(times, outT, 3, "winter", 0, 24);
  expect(winter.slice(0, 20).every((d) => d === 3) && winter.slice(20).every((d) => d === 0)).toBe(true);
  expect(shiftOf(times, outT, 3, "summer", 0, 24)[0]).toBe(0);
  const cold = shiftOf(times, outT, 0, "year", 10, 24);
  expect(cold.map((d, i) => (d ? i : -1)).filter((i) => i >= 0)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  expect(cold[5]).toBe(-10);
  expect(withWeather([10, 10], [0, 1], [0, 2])).toEqual([10, 10]); // no slope: nothing moves
});
