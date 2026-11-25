import { expect, test } from "vitest";
import { toHours } from "./useFoundationDemand";

const t0 = Date.UTC(2024, 0, 1) / 1000;
const steps = (n: number, sec: number) => Array.from({ length: n }, (_, i) => t0 + i * sec);

test("step values become hours: 15-minute steps averaged, hourly kept, 3-hour steps held over their hours", () => {
  expect(toHours(steps(8, 900), [1, 2, 3, 4, 10, 10, 10, 10])).toEqual([2.5, 10]);
  expect(toHours(steps(3, 3600), [1, 2, 3])).toEqual([1, 2, 3]);
  expect(toHours(steps(2, 3 * 3600), [5, 7])).toEqual([5, 5, 5, 7, 7, 7]);
  expect(toHours([], [])).toEqual([]);
});
