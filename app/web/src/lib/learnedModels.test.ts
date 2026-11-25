import { expect, test } from "vitest";
import { cetOffsetHours, clearSkyGhi, LEARNED_MODELS, learnedKw, type LearnedModelId } from "./learnedModels";

const aalborgKw = (times: number[], temps: number[], place?: { lat: number; lon: number }) => learnedKw("aalborg-residential", times, temps, place);

const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m, d, h) / 1000;

test.each(Object.keys(LEARNED_MODELS) as LearnedModelId[])("%s gives what its fitting script computed (its check series, across the switch to summer time)", (id) => {
  const { times, temperature, kw, lat, lon } = LEARNED_MODELS[id].check;
  const got = learnedKw(id, times, temperature, { lat, lon });
  got.forEach((v, i) => expect(v).toBeCloseTo(kw[i], 4));
});

test("the public buildings' model: weekdays above the weekend, the working day above the night", () => {
  const times = Array.from({ length: 24 * 28 }, (_, i) => Date.UTC(2025, 0, 6) / 1000 + i * 3600); // from a Monday
  const kw = learnedKw("helsinki-public", times, times.map(() => 0));
  const at = (day: number, hour: number) => kw[24 * (14 + day) + hour - 1]; // local = UTC + 1 in January, after the filters settled
  expect(at(1, 9)).toBeGreaterThan(at(6, 9)); // Tuesday 9 h vs Sunday 9 h
  expect(at(1, 9)).toBeGreaterThan(at(1, 2)); // 9 h vs 2 h
});

test("EU summer time: last Sunday of March to last Sunday of October, 01:00 UTC", () => {
  expect(cetOffsetHours(at(2024, 2, 31, 0))).toBe(1);
  expect(cetOffsetHours(at(2024, 2, 31, 1))).toBe(2);
  expect(cetOffsetHours(at(2024, 9, 27, 0))).toBe(2);
  expect(cetOffsetHours(at(2024, 9, 27, 1))).toBe(1);
  expect(cetOffsetHours(at(2024, 0, 15))).toBe(1);
});

test("clear sky: no sun at night, more at noon in June than in December", () => {
  expect(clearSkyGhi(at(2024, 5, 21, 23), 50, 8)).toBe(0);
  expect(clearSkyGhi(at(2024, 5, 21, 11), 50, 8)).toBeGreaterThan(2 * clearSkyGhi(at(2024, 11, 21, 11), 50, 8));
});

test("colder weeks need more heat, and the morning is above the night", () => {
  const times = Array.from({ length: 24 * 21 }, (_, i) => at(2024, 0, 1) + i * 3600);
  const cold = aalborgKw(times, times.map(() => -5));
  const mild = aalborgKw(times, times.map(() => 10));
  const sum = (xs: number[]) => xs.slice(24 * 14).reduce((a, b) => a + b, 0); // after the filters settled
  expect(sum(cold)).toBeGreaterThan(1.5 * sum(mild));
  const day = cold.slice(24 * 15, 24 * 16); // a Tuesday; local 7 h is 6 h UTC in winter
  expect(day[6]).toBeGreaterThan(day[2]);
});

test("any step: quarter-hours give the hourly curve's level", () => {
  const hourly = Array.from({ length: 24 * 14 }, (_, i) => at(2024, 1, 1) + i * 3600);
  const quarter = Array.from({ length: 24 * 14 * 4 }, (_, i) => at(2024, 1, 1) + i * 900);
  const temp = (t: number) => 3 + 4 * Math.sin((2 * Math.PI * t) / 86400);
  const h = aalborgKw(hourly, hourly.map(temp));
  const q = aalborgKw(quarter, quarter.map(temp));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  expect(mean(q) / mean(h)).toBeCloseTo(1, 2);
});
